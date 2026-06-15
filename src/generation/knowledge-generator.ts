import type { KnowledgeType } from '../schemas/knowledge-type.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';
import { buildPromptFramework, type PromptConfig } from './prompt-framework.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';
import { deriveDomainKey } from '../packaging/domain-registry.js';
import type { PackageLayout } from '../knowledge/init-directory.js';
import type { GraphStatus } from '../query/prepare-generation.js';
import type { GenerateTarget } from '../knowledge/generate-scope.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import pLimit from 'p-limit';
import { logger } from '../shared/logger.js';
import type { LlmCallInput, LlmCallResult } from './llm-types.js';

/**
 * LLM Claims Provider Interface
 *
 * 统一接口，支持两种调用方式：
 * - Legacy: (systemPrompt, userPrompt) - 现有代码继续使用
 * - Messages: ({ messages }) - 多轮对话场景
 *
 * Provider 实现时内部根据参数类型自动处理
 */
export interface LlmClaimsProvider {
  /** Legacy 调用 */
  (systemPrompt: string, userPrompt: string): Promise<{
    rawText: string;
    model: string;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  /** Message 数组调用（可选） */
  (input: LlmCallInput): Promise<LlmCallResult>;
}

/**
 * Knowledge Generator Input
 */
export interface KnowledgeGeneratorInput {
  repoPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  layout: PackageLayout;
  graphStatus: GraphStatus;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
  dependencies?: {
    conceptNames?: string[];
    dataModelNames?: string[];
    capabilityNames?: string[];
    tagPool?: string[];
  };
}

/**
 * Knowledge Generator Result
 */
export interface KnowledgeGeneratorResult {
  objects: KnowledgeObject[];
  files: Array<{ path: string; content: string }>;
  warnings: string[];
}

export interface KnowledgeObject {
  id: string;
  type: KnowledgeType;
  [key: string]: unknown;
}

function enrichObjectForType(type: KnowledgeType, obj: Record<string, unknown>, id: string): Record<string, unknown> {
  if (type === 'CONCEPT') {
    const aliases = Array.isArray(obj.aliases)
      ? obj.aliases.filter((item): item is string => typeof item === 'string')
      : [];
    const kebabAlias = aliases.find(alias => /^[a-z][a-z0-9-]*$/.test(alias));
    const domainName = typeof obj.concept_name === 'string'
      ? obj.concept_name
      : typeof obj.name_zh === 'string'
        ? obj.name_zh
        : id;

    return {
      ...obj,
      domain_key: deriveDomainKey({
        domainKey: kebabAlias,
        domainName,
        conceptId: id,
      }),
      domain_name: domainName,
      capability_refs: Array.isArray(obj.capability_refs) ? obj.capability_refs : [],
    };
  }

  if (type === 'CAPABILITY') {
    const domainName = typeof obj.domain_name === 'string'
      ? obj.domain_name
      : typeof obj.capability_name === 'string'
        ? obj.capability_name
        : id;

    return {
      ...obj,
      domain_key: deriveDomainKey({
        domainKey: typeof obj.domain_key === 'string' ? obj.domain_key : undefined,
        domainName,
        capabilityId: id,
      }),
      domain_name: domainName,
    };
  }

  return obj;
}

/**
 * Run knowledge generation for a single type
 */
export async function runKnowledgeGenerator(
  input: KnowledgeGeneratorInput,
  evidenceBundle: EvidenceBundle,
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution> {
  const { type, dependencies, verbose } = input;

  // Build prompt using framework
  const promptConfig: PromptConfig = {
    objectType: type,
    strategy: 'bootstrap',
    phase: getPhaseForType(type),
    dependencies,
    evidence: evidenceBundle,
  };

  const { system, user } = buildPromptFramework(promptConfig);

  if (verbose) {
    console.log(`Generating ${type} knowledge...`);
    console.log(`  System prompt length: ${system.length}`);
    console.log(`  User prompt length: ${user.length}`);
  }

  // Call LLM
  const llmResult = await claimsProvider(system, user);
  const rawText = llmResult.rawText;

  if (verbose) {
    console.log(`  LLM response length: ${rawText.length}`);
    console.log(`  LLM response preview: ${rawText.slice(0, 200)}...`);
  }

  // Parse LLM response
  const parsed = parseLlmResponse(rawText);

  // Convert to contribution
  // ID 优先级：1. 显式 id 字段（英文） 2. aliases 中的英文名 3. name 字段 4. 时间戳备用
  const objects: KnowledgeObject[] = parsed.objects.map((obj: Record<string, unknown>) => {
    // 尝试从 aliases 中提取英文名（ASCII字符）
    // 确保 aliases 是数组（LLM 可能返回字符串）
    const aliasesRaw = obj.aliases;
    const aliases = Array.isArray(aliasesRaw) ? aliasesRaw :
                    (typeof aliasesRaw === 'string' ? [aliasesRaw] : undefined);
    const englishAlias = aliases?.find(a => /^[\w\-]+$/.test(a));

    const id = extractEnglishId(obj.id as string) ||
               englishAlias ||
               extractEnglishId(obj[getNameField(type)] as string) ||
               `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    return {
      id,
      type,
      ...enrichObjectForType(type, obj, id),
    };
  });

  const files: Array<{ path: string; content: string }> = [];
  const dirName = TYPE_TO_DIR[type] || type.toLowerCase();
  for (const obj of objects) {
    const filePath = `${dirName}/${obj.id}.md`;
    const content = objectToMarkdown(obj);
    files.push({ path: filePath, content });
  }

  const stageName = type.toLowerCase();
  return {
    stage: stageName,
    objects: objects.map(o => ({
      id: o.id,
      type: o.type,
      path: `${dirName}/${o.id}.md`,
    })),
    files,
    report: {
      stage: stageName,
      ran: true,
      succeeded: objects.length,
      failed: parsed.warnings.length > 0 ? 1 : 0,
      details: {
        model: llmResult.model,
        objectCount: objects.length,
        warnings: parsed.warnings,
      },
    },
    warnings: parsed.warnings,
  };
}

/**
 * Run knowledge generation for multiple evidence groups in parallel.
 * Each group is processed by a separate LLM call.
 * Uses concurrency limit to avoid rate limiting.
 */
export async function runKnowledgeGeneratorForGroups(
  input: KnowledgeGeneratorInput,
  evidenceGroups: EvidenceGroup[],
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution[]> {
  const { type, verbose } = input;

  if (evidenceGroups.length === 0) {
    return [];
  }

  // Use all evidence groups (debug limit removed)
  const groupsToProcess = evidenceGroups;

  if (verbose) {
    console.log(`Generating ${type} knowledge for ${groupsToProcess.length} groups...`);
  }

  // 限制并发数为 3，避免速率限制
  const limit = pLimit(3);
  const contributions: KnowledgePackageContribution[] = [];

  // 使用 p-limit 控制并发
  const tasks = groupsToProcess.map((group, idx) =>
    limit(async () => {
      logger.debug(`Processing group ${idx + 1}/${groupsToProcess.length}: ${group.groupId}`);
      const result = await runKnowledgeGenerator(
        input,
        group.bundle,
        claimsProvider,
      );
      // Add groupId to report details
      result.report.details = {
        ...result.report.details,
        groupId: group.groupId,
        packagePath: group.packagePath,
      };
      logger.debug(`Completed group ${idx + 1}/${groupsToProcess.length}: ${result.report.succeeded} succeeded`);
      return result;
    }),
  );

  // 执行所有任务（受并发限制）
  // Add timeout protection - if tasks don't complete in reasonable time, continue
  const TASK_TIMEOUT_MS = 180_000; // 3 minutes per group

  const results = await Promise.allSettled(
    tasks.map(task =>
      Promise.race([
        task,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Task timeout')), TASK_TIMEOUT_MS)
        )
      ])
    )
  );

  logger.debug(`All ${results.length} tasks completed`);

  for (const [idx, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      contributions.push(result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      const group = evidenceGroups[idx];
      logger.error(`Group ${group.groupId} failed: ${msg}`);
      contributions.push({
        stage: type.toLowerCase(),
        files: [],
        objects: [],
        report: {
          stage: type.toLowerCase(),
          ran: true,
          succeeded: 0,
          failed: 1,
          details: {
            groupId: group.groupId,
            packagePath: group.packagePath,
            error: msg,
          },
        },
        warnings: [msg],
      });
    }
  }

  return contributions;
}

function getPhaseForType(type: KnowledgeType): PromptConfig['phase'] {
  if (type === 'CONCEPT') return 'concept';
  if (type === 'DATA_MODEL') return 'data_model';
  if (type === 'CAPABILITY') return 'capability';
  return 'parallel';
}

function getNameField(type: KnowledgeType): string {
  const nameFields: Record<KnowledgeType, string> = {
    ARCHITECTURE: 'architecture_overview_name',
    CAPABILITY: 'domain_name',
    CONCEPT: 'concept_name',
    BOUNDARY: 'boundary_title',
    EXTERNAL: 'external_system_name',
    CONSTRAINT: 'constraint_name',
    RELATION: 'relation_name',
    DATA_MODEL: 'aggregate_name',
    WORKFLOW: 'workflow_name',
  };
  return nameFields[type];
}

/**
 * 提取英文标识符（仅ASCII字符）作为有效的文件名ID。
 * 如果输入包含非ASCII字符（如中文），返回空字符串。
 */
function extractEnglishId(name: string | undefined): string {
  if (!name) return '';
  // 仅保留ASCII字符
  const asciiPart = name.replace(/[^\w\-]/g, '');
  return asciiPart.toLowerCase();
}

interface ParsedLlmResponse {
  objects: Record<string, unknown>[];
  warnings: string[];
}

function parseLlmResponse(rawText: string): ParsedLlmResponse {
  const warnings: string[] = [];

  // Extract JSON from response
  let jsonText = rawText.trim();

  // Remove markdown code blocks if present
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

    // Single object
    return { objects: [parsed], warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to parse LLM response: ${msg}`);
    warnings.push(`Raw response (first 500 chars): ${rawText.slice(0, 500)}`);
    return { objects: [], warnings };
  }
}

function objectToYaml(obj: KnowledgeObject): string {
  const lines: string[] = [];
  lines.push(`id: ${obj.id}`);
  lines.push(`type: ${obj.type}`);

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id' || key === 'type') continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (typeof value[0] === 'object') {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      } else {
        lines.push(`${key}: [${value.map(v => JSON.stringify(v)).join(', ')}]`);
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join('\n') + '\n';
}

function objectToMarkdown(obj: KnowledgeObject): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 标题行
  const nameZh = (obj as any).name_zh || (obj as any).summary_zh || obj.id;
  lines.push(`# ${nameZh}`);
  lines.push('');
  lines.push(`> 类型：${obj.type}`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push('');

  // 一句话定位
  if ((obj as any).summary_zh) {
    lines.push(`## 一句话定位`);
    lines.push('');
    lines.push((obj as any).summary_zh);
    lines.push('');
  }

  // 别名
  const aliases = (obj as any).aliases;
  if (aliases && (Array.isArray(aliases) ? aliases.length > 0 : aliases)) {
    lines.push(`## 别名`);
    lines.push('');
    lines.push('代码中的英文命名和业务术语中的其他叫法：');
    lines.push('');
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    for (const alias of aliasList) {
      lines.push(`- ${alias}`);
    }
    lines.push('');
  }

  // 详细描述
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id' || key === 'type' || key === 'name_zh' || key === 'summary_zh' || key === 'aliases' || key === 'tags') continue;

    if (key.endsWith('_zh') && typeof value === 'string') {
      const sectionName = key.replace(/_zh$/, '').replace(/_/g, ' ');
      lines.push(`## ${sectionName}`);
      lines.push('');
      lines.push(value);
      lines.push('');
    } else if (Array.isArray(value) && value.length > 0) {
      const sectionName = key.replace(/_/g, ' ');
      lines.push(`## ${sectionName}`);
      lines.push('');
      if (typeof value[0] === 'object') {
        lines.push('| 字段 | 值 |');
        lines.push('|------|------|');
        for (const item of value) {
          if (typeof item === 'object') {
            const itemEntries = Object.entries(item).slice(0, 4);
            for (const [k, v] of itemEntries) {
              lines.push(`| ${k} | ${typeof v === 'string' ? v : JSON.stringify(v)} |`);
            }
            lines.push('');
          }
        }
      } else {
        for (const item of value) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }
  }

  // 标签
  const tags = (obj as any).tags;
  if (tags && Array.isArray(tags) && tags.length > 0) {
    lines.push(`## 标签`);
    lines.push('');
    lines.push(tags.join('、'));
  }

  return lines.join('\n');
}
