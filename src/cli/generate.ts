import path from 'path';
import cliProgress from 'cli-progress';
import { logger, setLogLevel, setLogFile, closeLogFile, flushLogFile } from '../shared/logger.js';
import { getEnvVar, getEnvVarOptional } from '../config/env.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';
import {
  resolveModelConfig,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
} from '../config/model-config.js';
import type { ModelConfig } from '../config/model-config.js';
import { resolveTargetRepo } from '../shared/resolve-target-repo.js';
import { resolveGenerateScope } from '../knowledge/generate-scope.js';
import {
  runGenerateOrchestration,
  type GenerateOrchestrationInput,
  type GenerateOrchestrationDeps,
  type GenerateTypeInput,
} from '../knowledge/generate-orchestrator.js';
import { runKnowledgeGeneratorForGroups, type LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { callLlmForJson, generateBatchStatsReport, type LlmJsonCallResult } from '../generation/llm-json-client.js';
import { buildEvidenceBundlesByPackage, type EvidenceGroup } from '../evidence/type-evidence-builder.js';
import { writeKnowledgePackage } from '../packaging/knowledge-package-writer.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';
import { initGraphData } from '../query/prepare-generation.js';
import { initDirectoryStructure } from '../knowledge/init-directory.js';
import { createOpenAiClient, generateWithClient } from '../generation/llm-client.js';
import {
  groupBoundaryConfigs,
  buildBoundaryGenerationPrompt,
  type ConfigFileInfo,
} from '../evidence/boundary-grouping.js';
import {
  buildLlmFilterPrompt,
  groupCandidates,
  type FilteredCandidate,
  type LlmFilterResult,
  type ConceptGroup,
  type SuspiciousMark,
} from '../evidence/concept-filter.js';
import { buildPromptFramework, type PromptConfig } from '../generation/prompt-framework.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';
import { withReadOnlyLbug } from '../engine/lbug/read-only-session.js';
import { toKebabCase } from '../knowledge/type-directory-map.js';
import pLimit from 'p-limit';

function isMockModel(model: string): boolean {
  return model.startsWith('test-');
}

/**
 * 概念知识五层生成流程：
 * 第一层：硬过滤（已在证据查询中完成）
 * 第二层：软标记（已在证据查询中完成）
 * 第三层：LLM 筛选（判断是否值得生成）
 * 第四层：概念分组（合并同一业务概念）
 * 第五层：LLM 生成（生成完整知识）
 */
async function runConceptFiveLayerGeneration(
  input: GenerateTypeInput,
  evidenceGroups: EvidenceGroup[],
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution[]> {
  const { repoPath, verbose } = input;
  const { lbugPath } = getStoragePaths(repoPath);

  logger.info('CONCEPT: Starting five-layer generation process');

  // 从 EvidenceGroup 中提取候选（第一、二层已完成）
  const allCandidates: FilteredCandidate[] = [];
  for (const group of evidenceGroups) {
    logger.debug(`CONCEPT: Processing group ${group.groupId} with ${group.bundle.dataContracts?.length || 0} contracts`);
    for (const contract of group.bundle.dataContracts || []) {
      const customData = contract.customData || {};
      const suspiciousMark = customData.suspiciousMark as SuspiciousMark | undefined;
      const codeSnippet = customData.codeSnippet as string | undefined;
      const enumValues = customData.enumValues as string[] | undefined;

      allCandidates.push({
        className: contract.name || '',
        filePath: contract.location || '',
        suspiciousMark,
        codeSnippet,
        enumValues,
      });
      logger.debug(`CONCEPT: Extracted candidate ${contract.name}, mark=${suspiciousMark || 'none'}, snippet=${codeSnippet ? 'yes' : 'no'}`);
    }
  }

  if (allCandidates.length === 0) {
    logger.warn('CONCEPT: No candidates after layer 1 & 2 filtering');
    return [{
      stage: 'concept',
      files: [],
      objects: [],
      report: {
        stage: 'concept',
        ran: true,
        succeeded: 0,
        failed: 1,
        details: { error: 'no_candidates' },
      },
      warnings: ['no_candidates'],
    }];
  }

  logger.info(`CONCEPT: ${allCandidates.length} candidates for layer 3 LLM filtering`);

  // 第三层：LLM 筛选（并行调用，限制并发）
  logger.info(`CONCEPT: Layer 3 - LLM filtering for ${allCandidates.length} candidates`);

  // 创建进度条（stderr 输出，不影响 stdout 数据）
  const progressBar = new cliProgress.SingleBar({
    format: 'Layer 3 过滤 |{bar}| {percentage}% | {value}/{total} 候选 | {lastCandidate}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barsize: 30,
  }, cliProgress.Presets.shades_classic);

  progressBar.start(allCandidates.length, 0, { lastCandidate: '启动中...' });

  const limit = pLimit(2); // 降低并发避免速率限制
  const llmResults = new Map<string, LlmFilterResult>();
  let completedCount = 0;

  const filterTasks = allCandidates.map((candidate, idx) =>
    limit(async () => {
      logger.debug(`CONCEPT filter ${idx + 1}/${allCandidates.length}: ${candidate.className} (mark: ${candidate.suspiciousMark || 'none'})`);
      logger.debug(`CONCEPT codeSnippet: ${candidate.codeSnippet || 'none'}`);
      logger.debug(`CONCEPT enumValues: ${candidate.enumValues?.join(', ') || 'none'}`);
      const prompt = buildLlmFilterPrompt(candidate);
      logger.debug(`CONCEPT filter prompt for ${candidate.className}: ${prompt}`);
      const result = await claimsProvider('你是一个知识价值判断专家。', prompt);
      logger.debug(`CONCEPT filter raw response for ${candidate.className}: ${result.rawText}`);

      try {
        const parsed = JSON.parse(result.rawText.trim().replace(/^```json\n?|\n?```$/g, '').trim());
        llmResults.set(candidate.className, parsed);
        logger.info(`CONCEPT filter result: ${candidate.className} -> keep=${parsed.keep}, concept=${parsed.businessConcept || 'N/A'}, reason=${parsed.reason || 'N/A'}`);
      } catch (e) {
        // 解析失败，默认保留（保守策略）
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.warn(`CONCEPT filter parse failed for ${candidate.className}: ${errorMsg}`);
        llmResults.set(candidate.className, { keep: true, reason: 'parse_failed' });
      }

      // 更新进度条
      completedCount++;
      progressBar.update(completedCount, { lastCandidate: candidate.className.slice(0, 20) });
      flushLogFile(); // 实时刷新日志
    })
  );

  await Promise.all(filterTasks);
  progressBar.stop();
  process.stderr.write('\n'); // 进度条结束后换行，避免日志混在一起

  // 统计筛选结果
  const keptCount = Array.from(llmResults.values()).filter(r => r.keep).length;
  const filteredCount = allCandidates.length - keptCount;
  logger.info(`CONCEPT: Layer 3 complete - ${keptCount} kept, ${filteredCount} filtered`);

  // 第四层：概念分组
  logger.info('CONCEPT: Layer 4 - Grouping candidates by business concept');
  const conceptGroups = groupCandidates(allCandidates, llmResults);
  logger.info(`CONCEPT: Layer 4 complete - ${conceptGroups.length} concept groups formed`);

  // 详细记录每个分组
  for (const group of conceptGroups) {
    logger.info(`CONCEPT group: "${group.conceptName}" with ${group.candidates.length} candidates, merge=${group.shouldMerge}`);
    for (const c of group.candidates) {
      logger.debug(`  - ${c.className} (${c.filePath})`);
    }
  }

  if (conceptGroups.length === 0) {
    return [{
      stage: 'concept',
      files: [],
      objects: [],
      report: {
        stage: 'concept',
        ran: true,
        succeeded: 0,
        failed: 0,
        details: { filtered_count: allCandidates.length, kept_count: keptCount },
      },
      warnings: [],
    }];
  }

  // 第五层：LLM 生成（每组生成一条概念知识）
  logger.info('CONCEPT: Layer 5 - Generating knowledge for each concept groups');
  const contributions: KnowledgePackageContribution[] = [];
  const generateLimit = pLimit(3);

  // 创建 Layer 5 进度条
  const genProgressBar = new cliProgress.SingleBar({
    format: 'Layer 5 生成 |{bar}| {percentage}% | {value}/{total} 概念组 | {lastGroup}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barsize: 30,
  }, cliProgress.Presets.shades_classic);

  genProgressBar.start(conceptGroups.length, 0, { lastGroup: '启动中...' });
  let genCompletedCount = 0;

  const generateTasks = conceptGroups.map((group, idx) =>
    generateLimit(async () => {
      logger.info(`CONCEPT generate ${idx + 1}/${conceptGroups.length}: "${group.conceptName}"`);

      // 构建生成提示词
      const promptConfig: PromptConfig = {
        objectType: 'CONCEPT',
        strategy: 'bootstrap',
        phase: 'concept',
        evidence: {
          bundleId: `BUNDLE-CONCEPT-${group.conceptName}`,
          candidateId: `CAND-CONCEPT-${idx}`,
          repoProfile: { name: repoPath.split('/').pop() || 'unknown' },
          confidence: 0.7,
          dataContracts: group.candidates.map((c, i) => ({
            ref: `evidence://contract/CON-${String(i + 1).padStart(3, '0')}`,
            kind: 'type',
            location: c.filePath,
            name: c.className,
            fields: [],
            customData: c.suspiciousMark ? { suspiciousMark: c.suspiciousMark } : undefined,
          })),
        },
      };

      const { system, user } = buildPromptFramework(promptConfig);
      logger.debug(`CONCEPT generate prompt: system=${system.length} chars, user=${user.length} chars`);

      // 使用新的 LLM JSON 调用工具
      const llmResult = await callLlmForJson<Record<string, unknown> | Record<string, unknown>[]>({
        systemPrompt: system,
        userPrompt: user,
        claimsProvider,
        knowledgeType: 'CONCEPT',
        repairContext: {
          conceptName: group.conceptName,
          codeSnippet: group.candidates[0]?.codeSnippet,
        },
        maxRetries: 3,
        timeout: 120000,
        fallbackContext: {
          conceptName: group.conceptName,
          kebabId: toKebabCase(group.conceptName),
        },
        logLabel: `CONCEPT generate "${group.conceptName}"`,
      });

      logger.debug(`CONCEPT generate response: ${llmResult.rawOutput.length} chars, source=${llmResult.successSource}`);

      // 解析生成结果（已由工具处理）
      let objects: Record<string, unknown>[] = [];
      if (llmResult.success && llmResult.data) {
        if (Array.isArray(llmResult.data)) {
          objects = llmResult.data;
        } else {
          objects = [llmResult.data];
        }
        logger.info(`CONCEPT generate "${group.conceptName}": ${objects.length} objects, fallback=${llmResult.fallbackUsed}`);
      } else {
        logger.error(`CONCEPT generate failed for "${group.conceptName}"`);
        objects = [];
      }

      // 提取英文 ID
      const processedObjects = objects.map((obj, objIdx) => {
        const aliases = obj.aliases as string[] | undefined;
        const englishId = aliases?.find(a => /^[a-zA-Z]/.test(a));
        const id = englishId ? toKebabCase(englishId) : toKebabCase(group.conceptName) + (objIdx > 0 ? `-${objIdx}` : '');
        logger.debug(`CONCEPT object: aliases=${aliases?.join(',')}, id=${id}`);
        return { id, type: 'CONCEPT', ...obj };
      });

      // 更新进度条并刷新日志
      genCompletedCount++;
      genProgressBar.update(genCompletedCount, { lastGroup: group.conceptName.slice(0, 15) });
      flushLogFile();

      const files = processedObjects.map(obj => ({
        path: `objects/concept/${obj.id}.yaml`,
        content: objectToYaml(obj),
      }));

      return {
        stage: 'concept',
        objects: processedObjects.map(o => ({
          id: o.id,
          type: 'CONCEPT',
          path: `objects/concept/${o.id}.yaml`,
        })),
        files,
        llmResult, // 保存 LLM 结果用于统计
        report: {
          stage: 'concept',
          ran: true,
          succeeded: processedObjects.length,
          failed: objects.length === 0 ? 1 : 0,
          details: {
            conceptName: group.conceptName,
            candidateCount: group.candidates.length,
            successSource: llmResult.successSource,
            fallbackUsed: llmResult.fallbackUsed,
            retryCount: llmResult.llmStats.totalCalls,
          },
        },
        warnings: [],
      };
    })
  );

  const generateResults = await Promise.all(generateTasks);
  genProgressBar.stop();
  process.stderr.write('\n'); // 进度条结束后换行
  contributions.push(...generateResults);

  // 生成统计报告
  const layer5Results = generateResults.map(r => (r as any).llmResult as LlmJsonCallResult);
  generateBatchStatsReport(layer5Results, 'CONCEPT Layer 5');

  logger.info(`CONCEPT: Five-layer generation complete - ${contributions.length} contributions, ${contributions.reduce((sum, c) => sum + c.report.succeeded, 0)} objects generated`);

  return contributions;
}

/**
 * 边界知识两阶段生成：
 * 阶段1：LLM 分组配置文件
 * 阶段2：每组独立生成边界知识
 */
async function runBoundaryTwoStageGeneration(
  input: GenerateTypeInput,
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution[]> {
  const { repoPath, verbose } = input;
  const { lbugPath } = getStoragePaths(repoPath);

  // 查询配置文件列表
  const configFiles = await withReadOnlyLbug(lbugPath, async (query) => {
    const configCypher = `
      MATCH (f:File) WHERE f.name =~ '(?i).*(config|properties|yaml|yml)$'
      RETURN f.name as name, f.filePath as filePath
      LIMIT 20
    `;
    const results = await query(configCypher);
    return results.map(row => ({
      name: row.name as string,
      path: row.filePath as string,
    })) as ConfigFileInfo[];
  });

  if (configFiles.length === 0) {
    logger.warn('No config files found for BOUNDARY');
    return [{
      stage: 'boundary',
      files: [],
      objects: [],
      report: {
        stage: 'boundary',
        ran: true,
        succeeded: 0,
        failed: 1,
        details: { error: 'no_config_files' },
      },
      warnings: ['no_config_files'],
    }];
  }

  if (verbose) {
    logger.info(`Found ${configFiles.length} config files for BOUNDARY`);
  }

  // 阶段1：LLM 分组
  const groups = await groupBoundaryConfigs(configFiles, claimsProvider);
  logger.info(`BOUNDARY grouped into ${groups.length} groups`);

  // 阶段2：每组生成边界知识
  const contributions: KnowledgePackageContribution[] = [];

  for (const group of groups) {
    const { system, user } = buildBoundaryGenerationPrompt(group);
    const result = await claimsProvider(system, user);

    // 解析 LLM 输出
    const parsed = parseBoundaryOutput(result.rawText);

    // 构建 contribution，从 aliases 中提取英文 ID
    const objects = parsed.objects.map((obj, index) => {
      const aliases = obj.aliases as string[] | undefined;
      const englishId = aliases?.find(a => /^[a-zA-Z]/.test(a));
      const id = englishId ? toKebabCase(englishId) : `boundary-${Date.now()}-${index}`;

      return {
        id,
        type: 'BOUNDARY',
        ...obj,
      };
    });

    const files = objects.map(obj => ({
      path: `objects/boundary/${obj.id}.yaml`,
      content: objectToYaml(obj),
    }));

    contributions.push({
      stage: 'boundary',
      objects: objects.map(o => ({
        id: o.id,
        type: 'BOUNDARY',
        path: `objects/boundary/${o.id}.yaml`,
      })),
      files,
      report: {
        stage: 'boundary',
        ran: true,
        succeeded: objects.length,
        failed: parsed.warnings.length > 0 ? 1 : 0,
        details: {
          group_name: group.group_name,
          file_count: group.files.length,
          model: result.model,
        },
      },
      warnings: parsed.warnings,
    });
  }

  return contributions;
}

/**
 * 解析边界知识 LLM 输出
 */
function parseBoundaryOutput(rawText: string): { objects: Record<string, unknown>[]; warnings: string[] } {
  const warnings: string[] = [];
  let jsonText = rawText.trim();

  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      return { objects: parsed, warnings };
    }
    if (parsed.objects && Array.isArray(parsed.objects)) {
      return { objects: parsed.objects, warnings: parsed.warnings || [] };
    }
    return { objects: [parsed], warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to parse boundary output: ${msg}`);
    return { objects: [], warnings };
  }
}

/**
 * 对象转 YAML
 */
function objectToYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(v => JSON.stringify(v)).join(', ')}]`);
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n') + '\n';
}

interface GenerateOptions {
  repo?: string;
  path?: string;
  knowledge?: string;
  target?: string;
  out?: string;
  llmConfig?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  forceAnalyze?: boolean;
  verbose?: boolean;
  logFile?: string;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  if (options.verbose) {
    setLogLevel('debug');
  }

  // 设置日志文件
  if (options.logFile) {
    const logPath = path.resolve(options.logFile);
    setLogFile(logPath);
    logger.info(`Logging to file: ${logPath}`);
  }

  // Resolve target repo path
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;
  logger.debug(`Resolved repo path from ${resolved.source}: ${repoPath}`);

  // Resolve generation scope
  const scope = resolveGenerateScope({
    knowledge: options.knowledge,
    target: options.target,
  });

  for (const warning of scope.warnings) {
    logger.warn(warning);
  }

  // Load model config
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile(repoPath);

  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });

  const apiKey = resolvedConfig.apiKey || getEnvVarOptional(resolvedConfig.apiKeyEnv) || '';
  const modelConfig: ModelConfig = {
    baseUrl: resolvedConfig.baseUrl,
    apiKey,
    apiKeyEnv: resolvedConfig.apiKeyEnv,
    model: resolvedConfig.model,
  };
  const mockMode = isMockModel(modelConfig.model);

  logger.info(`Generating ai-knowledge for ${repoPath}`);
  logger.info(`Knowledge types: ${scope.types.join(', ')}`);
  if (scope.target) {
    logger.info(`Target: ${scope.target.kind}:${scope.target.value}`);
  }

  const outputRoot = options.out ? path.resolve(options.out) : repoPath;

  // Initialize graph data
  const graphStatus = await initGraphData({
    repoPath,
    forceAnalyze: options.forceAnalyze,
    mockMode,
  });
  logger.info(`Graph status: ${graphStatus.status}, nodes: ${graphStatus.nodeCount}`);

  // Initialize directory structure
  const layout = await initDirectoryStructure(outputRoot);

  // Build deps for orchestration
  const deps: GenerateOrchestrationDeps = {
    runGeneratorForType: async (input: GenerateTypeInput): Promise<KnowledgePackageContribution[]> => {
      const { type, target, verbose, preparedEvidenceGroups } = input;

      // Create LLM client using OpenAI-compatible format
      const clientConfig: ModelConfig = {
        baseUrl: input.llm.baseUrl || modelConfig.baseUrl,
        apiKey: apiKey,
        model: input.llm.model || modelConfig.model,
        apiKeyEnv: input.llm.apiKeyEnv || modelConfig.apiKeyEnv,
      };
      const client = createOpenAiClient(clientConfig);

      // Create claims provider using llm-client
      const claimsProvider: LlmClaimsProvider = async (systemPrompt, userPrompt) => {
        const result = await generateWithClient(client, clientConfig.model, systemPrompt, userPrompt);
        return {
          rawText: result.text,
          model: clientConfig.model,
          usage: {
            promptTokens: 0,
            completionTokens: result.chunks,
          },
        };
      };

      // BOUNDARY 类型：两阶段生成（分组 + 每组生成）
      if (type === 'BOUNDARY') {
        return await runBoundaryTwoStageGeneration(input, claimsProvider);
      }

      // CONCEPT 类型：五层生成（硬过滤 + 软标记 + LLM筛选 + 分组 + LLM生成）
      if (type === 'CONCEPT') {
        let evidenceGroups = preparedEvidenceGroups;

        if (!evidenceGroups) {
          evidenceGroups = await buildEvidenceBundlesByPackage({
            repoPath: input.repoPath,
            type,
            target,
            graphStatus: input.graphStatus,
          });
        }

        if (evidenceGroups.length === 0) {
          logger.warn('No evidence found for CONCEPT');
          return [{
            stage: 'concept',
            files: [],
            objects: [],
            report: {
              stage: 'concept',
              ran: true,
              succeeded: 0,
              failed: 1,
              details: { error: 'no_evidence_found' },
            },
            warnings: ['no_evidence_found'],
          }];
        }

        return await runConceptFiveLayerGeneration(input, evidenceGroups, claimsProvider);
      }

      // Use prepared evidence groups if provided (avoids database access)
      let evidenceGroups = preparedEvidenceGroups;

      if (!evidenceGroups) {
        // Build evidence bundles grouped by package (opens database)
        evidenceGroups = await buildEvidenceBundlesByPackage({
          repoPath: input.repoPath,
          type,
          target,
          graphStatus: input.graphStatus,
        });
      }

      if (evidenceGroups.length === 0) {
        logger.warn(`No evidence found for ${type}`);
        return [{
          stage: type.toLowerCase(),
          files: [],
          objects: [],
          report: {
            stage: type.toLowerCase(),
            ran: true,
            succeeded: 0,
            failed: 1,
            details: { error: 'no_evidence_found' },
          },
          warnings: ['no_evidence_found'],
        }];
      }

      // Run generator for all evidence groups (parallel)
      return runKnowledgeGeneratorForGroups(input, evidenceGroups, claimsProvider);
    },

    writePackage: async (input) => {
      await writeKnowledgePackage({
        layout: input.layout,
        knowledge: input.knowledge,
        target: input.target,
        contributions: input.contributions,
      });
    },
  };

  const orchestrationInput: GenerateOrchestrationInput = {
    repoPath,
    outputRoot,
    scope,
    graphStatus,
    layout,
    forceAnalyze: options.forceAnalyze,
    verbose: options.verbose,
    llm: {
      model: options.model,
      baseUrl: options.baseUrl,
      apiKeyEnv: options.apiKeyEnv,
      llmConfig: options.llmConfig,
    },
  };

  await runGenerateOrchestration({
    input: orchestrationInput,
    deps,
  });

  logger.info(`ai-knowledge generated at ${path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR)}`);
  closeLogFile();
}