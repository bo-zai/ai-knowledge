import path from 'path';
import cliProgress from 'cli-progress';
import { logger, setLogLevel, setLogFile, closeLogFile, flushLogFile } from '../shared/logger.js';
import { getEnvVar, getEnvVarOptional } from '../config/env.js';
import { DEFAULT_KNOWLEDGE_DIR, LLM_DEFAULTS } from '../config/defaults.js';
import {
  resolveModelConfig,
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
import { verifyConcept, recordFailure, type VerifyResult } from '../generation/concept-verifier.js';
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
import {
  collectProjectTypeEvidence,
  identifyProjectType,
  buildProjectContext,
  saveProjectContext,
  loadProjectContext,
  generateArchitectureOverview,
  loadGenerationMeta,
  saveGenerationMeta,
  getCurrentCommitHash,
  shouldReidentifyProjectType,
  analyzeAnalysisUnits,
  saveModuleTopology,
  loadModuleTopology,
  type ModuleTopology,
  type AnalysisUnitResult,
} from '../architecture/index.js';
import { needsSkillInitialization, initializeSkills } from '../skills/index.js';

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
  concurrency: number,
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

  const limit = pLimit(concurrency); // 使用配置的并发数
  const llmResults = new Map<string, LlmFilterResult>();
  let completedCount = 0;

  const filterTasks = allCandidates.map((candidate, idx) =>
    limit(async () => {
      try {
        logger.debug(`CONCEPT filter ${idx + 1}/${allCandidates.length}: ${candidate.className} (mark: ${candidate.suspiciousMark || 'none'})`);
        logger.debug(`CONCEPT codeSnippet: ${candidate.codeSnippet || 'none'}`);
        logger.debug(`CONCEPT enumValues: ${candidate.enumValues?.join(', ') || 'none'}`);
        const prompt = buildLlmFilterPrompt(candidate);
        logger.debug(`CONCEPT filter prompt for ${candidate.className}: ${prompt}`);

        // LLM调用（带超时控制）
        const filterTimeout = 60000; // 60秒超时
        const result = await Promise.race([
          claimsProvider('你是一个知识价值判断专家。', prompt),
          new Promise<{ rawText: string }>((_, reject) =>
            setTimeout(() => reject(new Error(`Layer 3 filter timeout after ${filterTimeout}ms`)), filterTimeout)
          )
        ]);
        logger.debug(`CONCEPT filter raw response for ${candidate.className}: ${result.rawText}`);

        // JSON解析
        try {
          const parsed = JSON.parse(result.rawText.trim().replace(/^```json\n?|\n?```$/g, '').trim());
          llmResults.set(candidate.className, parsed);
          logger.info(`CONCEPT filter result: ${candidate.className} -> keep=${parsed.keep}, concept=${parsed.businessConcept || 'N/A'}, reason=${parsed.reason || 'N/A'}`);
        } catch (parseError) {
          // JSON解析失败
          const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
          logger.warn(`CONCEPT filter parse failed for ${candidate.className}: ${errorMsg}`);
          llmResults.set(candidate.className, { keep: true, reason: 'parse_failed' });
        }
      } catch (llmError) {
        // LLM调用失败（网络/超时/API错误）
        const errorMsg = llmError instanceof Error ? llmError.message : String(llmError);
        logger.error(`CONCEPT filter LLM call failed for ${candidate.className}: ${errorMsg}`);
        // 使用保守策略：默认保留
        llmResults.set(candidate.className, { keep: true, reason: 'llm_call_failed' });
      } finally {
        // 无论成功还是失败，都更新进度条
        completedCount++;
        progressBar.update(completedCount, { lastCandidate: candidate.className.slice(0, 20) });
        flushLogFile();
      }
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
  const generateLimit = pLimit(concurrency);

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
        maxRetries: LLM_DEFAULTS.maxRetries,
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
        // LLM 返回格式：{ objects: [...], warnings: [...] } 或直接数组
        if (Array.isArray(llmResult.data)) {
          objects = llmResult.data;
        } else if (llmResult.data.objects && Array.isArray(llmResult.data.objects)) {
          // 提取 objects 数组
          objects = llmResult.data.objects as Record<string, unknown>[];
        } else {
          objects = [llmResult.data];
        }
        // DEBUG: 打印对象的 keys 检查字段名
        for (const obj of objects) {
          logger.debug(`CONCEPT object keys: ${Object.keys(obj).join(', ')}`);
        }
        logger.info(`CONCEPT generate "${group.conceptName}": ${objects.length} objects, fallback=${llmResult.fallbackUsed}`);
      } else {
        logger.error(`CONCEPT generate failed for "${group.conceptName}"`);
        objects = [];
      }

      // ========== 验证修正步骤 ==========
      // 对每个生成的对象进行验证修正
      let verifiedObjects: Record<string, unknown>[] = [];
      const verifyFailures: Array<{ conceptName: string; reason: string; ruleId?: string }> = [];

      for (const obj of objects) {
        // 调用验证修正
        const verifyResult = await verifyConcept({
          conceptContent: obj,
          className: String(obj.concept_name || group.conceptName),
          filePath: group.candidates[0]?.filePath || '',
          suspiciousMark: group.candidates[0]?.suspiciousMark,
          enumValues: obj.enumValues as string[] | undefined,
        }, claimsProvider);

        if (verifyResult.action === 'accept') {
          // 合格，直接使用
          verifiedObjects.push(obj);
        } else if (verifyResult.action === 'fix' && verifyResult.fixedContent) {
          // 需修正，使用修正内容
          verifiedObjects.push(verifyResult.fixedContent);
          logger.info(`CONCEPT verify: "${obj.concept_name}" fixed`);
        } else if (verifyResult.action === 'reject') {
          // 拒绝，不写入，记录失败
          verifyFailures.push({
            conceptName: String(obj.concept_name || group.conceptName),
            reason: verifyResult.reason,
            ruleId: verifyResult.ruleId,
          });
          recordFailure({
            conceptName: String(obj.concept_name || group.conceptName),
            reason: verifyResult.reason,
            ruleId: verifyResult.ruleId,
            candidates: group.candidates.map(c => ({
              className: c.className,
              filePath: c.filePath,
              suspiciousMark: c.suspiciousMark,
            })),
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 如果所有对象都被拒绝，记录整体失败
      if (verifiedObjects.length === 0 && objects.length > 0) {
        logger.warn(`CONCEPT: 所有对象被验证拒绝，概念 "${group.conceptName}" 不生成`);
      }

      // 提取英文 ID：优先使用 kebab-case 格式的业务英文别名
      const processedObjects = verifiedObjects.map((obj, objIdx) => {
        const aliasesRaw = obj.aliases;
        // 确保 aliases 是数组（LLM 可能返回字符串）
        const aliases = Array.isArray(aliasesRaw) ? aliasesRaw :
                        (typeof aliasesRaw === 'string' ? [aliasesRaw] : undefined);
        // 优先使用 kebab-case 格式的业务英文别名（如 "alipay-merchant-config"）
        const kebabAlias = aliases?.find(a => /^[a-z][a-z-]+$/.test(a));
        // 如果没有 kebab-case，使用其他英文命名（如 PascalCase 的代码类名）
        const otherEnglishId = aliases?.find(a => /^[a-zA-Z]/.test(a) && !/^[a-z][a-z-]+$/.test(a));
        const id = kebabAlias ?? (otherEnglishId ? toKebabCase(otherEnglishId) : `obj-${Date.now()}-${objIdx}`);
        logger.debug(`CONCEPT object: aliases=${aliases?.join(',')}, id=${id}, kebab=${kebabAlias}, other=${otherEnglishId}`);
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
      const aliasesRaw = obj.aliases;
      // 确保 aliases 是数组（LLM 可能返回字符串）
      const aliases = Array.isArray(aliasesRaw) ? aliasesRaw :
                      (typeof aliasesRaw === 'string' ? [aliasesRaw] : undefined);
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
  forceAnalyze?: boolean;
  initSkills?: boolean;  // 是否自动初始化 skills（默认 true，可通过 --no-init-skills 禁用）
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

  // ========== Skill 自动初始化检查 ==========
  // 默认启用，除非用户指定 --no-init-skills
  const shouldInitSkills = options.initSkills !== false;

  if (shouldInitSkills) {
    const needsInit = await needsSkillInitialization(repoPath);
    if (needsInit) {
      logger.info('Skills not initialized, initializing automatically...');
      const summary = await initializeSkills({
        repoPath,
        updateAgentsMd: true,
        verbose: options.verbose,
      });
      if (summary.succeeded > 0) {
        logger.info(`Skills initialized for ${summary.succeeded} agents`);
      }
    } else {
      logger.debug('Skills already initialized, skipping');
    }
  }

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
    : undefined;

  const modelConfig = resolveModelConfig({ fileConfig });

  const apiKey = modelConfig.apiKey || (modelConfig.apiKeyEnv ? getEnvVarOptional(modelConfig.apiKeyEnv) : undefined) || '';
  const finalConfig: ModelConfig = {
    ...modelConfig,
    apiKey,
  };

  const mockMode = isMockModel(finalConfig.model);

  logger.info(`Generating ai-knowledge for ${repoPath}`);
  logger.info(`Knowledge types: ${scope.types.join(', ')}`);
  if (scope.target) {
    logger.info(`Target: ${scope.target.kind}:${scope.target.value}`);
  }
  logger.info(`Using LLM config: model=${finalConfig.model}, concurrency=${finalConfig.concurrency}, timeout=${finalConfig.timeoutMs}ms`);

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

  // ========== 项目类型识别和架构概览生成（阶段 0） ==========

  // 尝试加载已有的模块拓扑（无论是否生成 ARCHITECTURE）
  let moduleTopology: ModuleTopology | undefined = await loadModuleTopology(outputRoot) ?? undefined;

  // 只在需要生成 ARCHITECTURE 时执行
  if (scope.types.includes('ARCHITECTURE')) {
    // 创建 LLM claims provider
    const archClient = createOpenAiClient(finalConfig);
    const archClaimsProvider: LlmClaimsProvider = async (systemPrompt, userPrompt) => {
      const result = await generateWithClient(archClient, finalConfig.model, systemPrompt, userPrompt);
      return {
        rawText: result.text,
        model: finalConfig.model,
        usage: { promptTokens: 0, completionTokens: result.chunks },
      };
    };

    // ========== 项目类型识别 ==========
    // 检查是否已有项目上下文
    let projectContext = await loadProjectContext(outputRoot);
    const existingMeta = await loadGenerationMeta(outputRoot);
    const commitHash = await getCurrentCommitHash(repoPath);

    // 判断是否需要重新识别项目类型
    const needsReidentification = shouldReidentifyProjectType(existingMeta, false);

    if (!projectContext || needsReidentification) {
      logger.info('Identifying project type...');

      // 收集识别证据
      const evidence = await collectProjectTypeEvidence(repoPath);

      // LLM 识别项目类型
      const identificationResult = await identifyProjectType(evidence, archClaimsProvider);

      // 构建并保存项目上下文
      projectContext = buildProjectContext(identificationResult);
      await saveProjectContext(projectContext, outputRoot);

      logger.info(`Project type identified: ${projectContext.projectType} (confidence: ${projectContext.confidence})`);
    } else {
      logger.info(`Using existing project context: ${projectContext.projectType}`);
    }

    // ========== 分析单元划分 ==========
    // 如果没有模块拓扑或项目类型重新识别了，执行分析单元划分
    if (!moduleTopology || needsReidentification) {
      logger.info('Analyzing analysis units...');

      // 执行分析单元划分
      const analysisResult = await analyzeAnalysisUnits(repoPath, projectContext);

      // 保存模块拓扑
      moduleTopology = analysisResult.moduleTopology;
      await saveModuleTopology(moduleTopology, outputRoot);

      logger.info(`Analysis units: ${analysisResult.couplingMode}, ${moduleTopology.moduleCount} modules`);
      for (const module of moduleTopology.modules) {
        logger.debug(`  - ${module.name} (${module.role}): ${module.path}`);
      }
    } else {
      logger.info(`Using existing module topology: ${moduleTopology.moduleCount} modules, ${moduleTopology.couplingMode}`);
    }

    // ========== 架构概览生成 ==========
    logger.info('Generating architecture overview...');
    await generateArchitectureOverview(repoPath, projectContext, archClaimsProvider, outputRoot, moduleTopology);

    // 保存生成元信息
    await saveGenerationMeta(outputRoot, commitHash, projectContext.identifiedAt);
  }

  // ========== 构建编排依赖 ==========

  // Build deps for orchestration
  const deps: GenerateOrchestrationDeps = {
    runGeneratorForType: async (input: GenerateTypeInput): Promise<KnowledgePackageContribution[]> => {
      const { type, target, verbose, preparedEvidenceGroups } = input;

      // Create LLM client using OpenAI-compatible format
      const clientConfig: ModelConfig = {
        baseUrl: input.llm.baseUrl || finalConfig.baseUrl,
        apiKey: apiKey,
        model: input.llm.model || finalConfig.model,
        apiKeyEnv: input.llm.apiKeyEnv || finalConfig.apiKeyEnv,
        concurrency: finalConfig.concurrency,
        timeoutMs: finalConfig.timeoutMs,
        maxRetries: finalConfig.maxRetries,
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

        return await runConceptFiveLayerGeneration(input, evidenceGroups, claimsProvider, finalConfig.concurrency);
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
      llmConfig: options.llmConfig,
    },
    moduleTopology,
  };

  await runGenerateOrchestration({
    input: orchestrationInput,
    deps,
  });

  logger.info(`ai-knowledge generated at ${path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR)}`);
  closeLogFile();
}