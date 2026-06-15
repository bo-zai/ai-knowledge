/**
 * EXTERNAL 知识生成管线
 *
 * 外部系统交互知识生成，从仓库中：
 * 1. 提取外部依赖证据
 * 2. 调用 LLM 生成外部系统交互知识
 * 3. 写入 external-systems/ 目录
 */

import path from 'path';
import { logger } from '../shared/logger.js';
import { callLlmForJson } from '../generation/llm-json-client.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { buildExternalPrompt } from '../generation/object-generators/external-generator.js';
import { externalSchema, type ExternalKnowledge } from '../schemas/external.js';
import { getRepoBasename } from '../shared/path-utils.js';
import { generateObjectId } from '../shared/ids.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import type { KnowledgePackageContribution, KnowledgePackageStageReport } from '../packaging/knowledge-package-contribution.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';

export interface RunExternalPipelineInput {
  repoPath: string;
  modelConfig: { model: string };
  claimsProvider: LlmClaimsProvider;
  outputRoot: string;
  /** 已生成的概念名称列表 */
  conceptNames?: string[];
  /** 已生成的能力名称列表 */
  capabilityNames?: string[];
  /** 超时时间（毫秒） */
  timeout?: number;
  /** Pre-built evidence groups */
  evidenceGroups?: EvidenceGroup[];
}

/**
 * 构建 EXTERNAL 阶段报告
 */
export function buildExternalStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: 'external',
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 EXTERNAL 知识生成管线
 */
export async function runExternalKnowledgePipeline(
  input: RunExternalPipelineInput,
): Promise<KnowledgePackageContribution> {
  const { repoPath, modelConfig, claimsProvider, outputRoot, conceptNames, capabilityNames, timeout, evidenceGroups } = input;

  logger.info('Starting EXTERNAL knowledge pipeline...');

  if (!evidenceGroups || evidenceGroups.length === 0) {
    logger.warn('No external dependency evidence found in repository');
    return {
      stage: 'external',
      files: [],
      objects: [],
      report: buildExternalStageReport({ succeeded: 0, failed: 0 }),
      warnings: ['No external dependency evidence found'],
    };
  }

  const knowledgeDir = path.join(outputRoot, 'ai-knowledge', TYPE_TO_DIR['EXTERNAL']);
  const results: ExternalGenerationResult[] = [];

  for (const [index, group] of evidenceGroups.entries()) {
    const groupId = group.groupId;
    logger.info(`Generating EXTERNAL for ${groupId} (${index + 1}/${evidenceGroups.length})`);

    try {
      const result = await generateExternalKnowledge(
        group,
        modelConfig,
        claimsProvider,
        knowledgeDir,
        repoPath,
        conceptNames,
        capabilityNames,
        timeout,
      );
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate EXTERNAL ${groupId}: ${errorMsg}`);
      results.push({
        groupId,
        success: false,
        error: errorMsg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(`EXTERNAL pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`);

  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: r.objectId ?? generateObjectId('EXTERNAL', r.groupId),
    type: 'EXTERNAL',
    path: r.filePath ? path.relative(outputRoot, r.filePath) : '',
    sliceIds: [],
  }));

  return {
    stage: 'external',
    files,
    objects,
    report: buildExternalStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[EXTERNAL] ${r.groupId}: ${r.error}`),
  };
}

interface ExternalGenerationResult {
  groupId: string;
  success: boolean;
  objectId?: string;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 为单个证据组生成外部系统交互知识
 */
async function generateExternalKnowledge(
  group: EvidenceGroup,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  capabilityNames?: string[],
  timeout?: number,
): Promise<ExternalGenerationResult> {
  const groupId = group.groupId;
  const fileName = toFileName(groupId);
  const filePath = path.join(knowledgeDir, `${fileName}.md`);

  const { system, user } = buildExternalPrompt({
    evidence_bundle: group.bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
    capability_names: capabilityNames,
  });

  const result = await callLlmForJson<ExternalKnowledge>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: 'EXTERNAL',
    fallbackContext: { groupId },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      groupId,
    },
    logLabel: `EXTERNAL: ${groupId}`,
  });

  if (!result.success || !result.data) {
    const fallbackContent = generateFallbackExternal(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  try {
    externalSchema.parse(result.data);
  } catch {
    logger.warn(`Schema validation failed for EXTERNAL ${groupId}, using fallback`);
    const fallbackContent = generateFallbackExternal(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  const mdContent = externalToMarkdown(result.data, group);

  await writeFile(filePath, mdContent);

  return {
    groupId,
    success: true,
    objectId: result.data.id,
    filePath,
    content: mdContent,
  };
}

/**
 * 外部系统交互知识转 Markdown
 */
function externalToMarkdown(data: ExternalKnowledge, group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${data.name_zh || data.external_system_name}`);
  lines.push('');
  lines.push(`> 类型：EXTERNAL`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：${data.tags.join('、')}`);
  lines.push('');

  lines.push(`## 外部系统名称`);
  lines.push('');
  lines.push(data.external_system_name);
  lines.push('');

  lines.push(`## 交互目的`);
  lines.push('');
  lines.push(data.interaction_purpose_zh);
  lines.push('');

  lines.push(`## 交互方式`);
  lines.push('');
  const methodZh = {
    sdk: 'SDK 调用',
    http_api: 'HTTP API',
    callback: '回调',
    data_exchange: '数据交换',
    rpc: 'RPC 调用',
  }[data.interaction_method] || data.interaction_method;
  lines.push(methodZh);
  lines.push('');

  lines.push(`## 当前仓库角色`);
  lines.push('');
  const roleZh = {
    caller: '调用方',
    callee: '被调用方',
    data_producer: '数据生产方',
    data_consumer: '数据消费方',
  }[data.repository_role] || data.repository_role;
  lines.push(roleZh);
  lines.push('');

  if (data.interaction_entry) {
    lines.push(`## 交互入口`);
    lines.push('');
    lines.push(data.interaction_entry);
    lines.push('');
  }

  lines.push(`## 可见交互范围`);
  lines.push('');
  for (const scope of data.visible_interaction_scope) {
    lines.push(`- ${scope}`);
  }
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push(data.applicable_scope);
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const slice of group.bundle.behaviorSlices?.slice(0, 5) ?? []) {
    lines.push(`- ${slice.location}`);
  }
  for (const ev of data.evidence.slice(0, 5)) {
    lines.push(`- ${ev}`);
  }
  lines.push('');

  lines.push(`## 标签`);
  lines.push('');
  lines.push(data.tags.join('、'));

  return lines.join('\n');
}

/**
 * 生成降级模板
 */
function generateFallbackExternal(group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# 外部系统交互`);
  lines.push('');
  lines.push(`> 类型：EXTERNAL`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：外部系统、集成`);
  lines.push('');

  lines.push(`## 外部系统名称`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 交互目的`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 交互方式`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 当前仓库角色`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 可见交互范围`);
  lines.push('');
  for (const slice of group.bundle.behaviorSlices?.slice(0, 5) ?? []) {
    lines.push(`- ${slice.object}`);
  }
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const slice of group.bundle.behaviorSlices?.slice(0, 5) ?? []) {
    lines.push(`- ${slice.location}`);
  }
  lines.push('');

  lines.push(`## 标签`);
  lines.push('');
  lines.push('外部系统、集成');

  return lines.join('\n');
}

/**
 * 写入文件
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const fs = await import('fs/promises');
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * groupId 转 kebab-case 文件名
 */
function toFileName(groupId: string): string {
  return groupId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}