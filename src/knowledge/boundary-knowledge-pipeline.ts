/**
 * BOUNDARY 知识生成管线
 *
 * 边界知识生成，从仓库中：
 * 1. 提取配置文件证据
 * 2. 调用 LLM 生成边界知识
 * 3. 写入 boundaries/ 目录
 */

import path from 'path';
import { logger } from '../shared/logger.js';
import { callLlmForJson } from '../generation/llm-json-client.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { buildBoundaryPrompt } from '../generation/object-generators/boundary-generator.js';
import { boundarySchema, type BoundaryKnowledge } from '../schemas/boundary.js';
import { getRepoBasename } from '../shared/path-utils.js';
import { generateObjectId } from '../shared/ids.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import type { KnowledgePackageContribution, KnowledgePackageStageReport } from '../packaging/knowledge-package-contribution.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';

export interface RunBoundaryPipelineInput {
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
 * 构建 BOUNDARY 阶段报告
 */
export function buildBoundaryStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: 'boundary',
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 BOUNDARY 知识生成管线
 */
export async function runBoundaryKnowledgePipeline(
  input: RunBoundaryPipelineInput,
): Promise<KnowledgePackageContribution> {
  const { repoPath, modelConfig, claimsProvider, outputRoot, conceptNames, capabilityNames, timeout, evidenceGroups } = input;

  logger.info('Starting BOUNDARY knowledge pipeline...');

  if (!evidenceGroups || evidenceGroups.length === 0) {
    logger.warn('No boundary evidence found in repository');
    return {
      stage: 'boundary',
      files: [],
      objects: [],
      report: buildBoundaryStageReport({ succeeded: 0, failed: 0 }),
      warnings: ['No boundary evidence found'],
    };
  }

  const knowledgeDir = path.join(outputRoot, 'ai-knowledge', TYPE_TO_DIR['BOUNDARY']);
  const results: BoundaryGenerationResult[] = [];

  for (const [index, group] of evidenceGroups.entries()) {
    const groupId = group.groupId;
    logger.info(`Generating BOUNDARY for ${groupId} (${index + 1}/${evidenceGroups.length})`);

    try {
      const result = await generateBoundaryKnowledge(
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
      logger.error(`Failed to generate BOUNDARY ${groupId}: ${errorMsg}`);
      results.push({
        groupId,
        success: false,
        error: errorMsg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(`BOUNDARY pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`);

  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: r.objectId ?? generateObjectId('BOUNDARY', r.groupId),
    type: 'BOUNDARY',
    path: r.filePath ? path.relative(outputRoot, r.filePath) : '',
    sliceIds: [],
  }));

  return {
    stage: 'boundary',
    files,
    objects,
    report: buildBoundaryStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[BOUNDARY] ${r.groupId}: ${r.error}`),
  };
}

interface BoundaryGenerationResult {
  groupId: string;
  success: boolean;
  objectId?: string;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 为单个证据组生成边界知识
 */
async function generateBoundaryKnowledge(
  group: EvidenceGroup,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  capabilityNames?: string[],
  timeout?: number,
): Promise<BoundaryGenerationResult> {
  const groupId = group.groupId;
  const fileName = toFileName(groupId);
  const filePath = path.join(knowledgeDir, `${fileName}.md`);

  const { system, user } = buildBoundaryPrompt({
    evidence_bundle: group.bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
    capability_names: capabilityNames,
  });

  const result = await callLlmForJson<BoundaryKnowledge>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: 'BOUNDARY',
    fallbackContext: { groupId },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      groupId,
    },
    logLabel: `BOUNDARY: ${groupId}`,
  });

  if (!result.success || !result.data) {
    const fallbackContent = generateFallbackBoundary(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  try {
    boundarySchema.parse(result.data);
  } catch {
    logger.warn(`Schema validation failed for BOUNDARY ${groupId}, using fallback`);
    const fallbackContent = generateFallbackBoundary(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  const mdContent = boundaryToMarkdown(result.data, group);

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
 * 边界知识转 Markdown
 */
function boundaryToMarkdown(data: BoundaryKnowledge, group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${data.name_zh || data.boundary_title}`);
  lines.push('');
  lines.push(`> 类型：BOUNDARY`);
  lines.push(`> 生成时间：${timestamp}`);
  if (data.related_capability) {
    lines.push(`> 关联能力：${data.related_capability}`);
  }
  lines.push(`> 标签：${data.tags.join('、')}`);
  lines.push('');

  lines.push(`## 边界标题`);
  lines.push('');
  lines.push(data.boundary_title);
  lines.push('');

  lines.push(`## 边界类型`);
  lines.push('');
  const typeZh = data.boundary_type === 'limitation' ? '局限性' : '禁用功能';
  lines.push(typeZh);
  lines.push('');

  lines.push(`## 详细说明`);
  lines.push('');
  lines.push(data.detailed_description_zh);
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push(data.applicable_scope);
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const doc of group.bundle.docs?.slice(0, 5) ?? []) {
    lines.push(`- ${doc.location}`);
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
function generateFallbackBoundary(group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  const configType = group.bundle.capabilityHints?.relatedTerms?.[0] || '通用';

  lines.push(`# ${configType}边界配置`);
  lines.push('');
  lines.push(`> 类型：BOUNDARY`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：${configType}、边界、配置`);
  lines.push('');

  lines.push(`## 边界标题`);
  lines.push('');
  lines.push(`${configType}功能边界`);
  lines.push('');

  lines.push(`## 边界类型`);
  lines.push('');
  lines.push('局限性');
  lines.push('');

  lines.push(`## 详细说明`);
  lines.push('');
  lines.push(`（待人工补充：描述${configType}相关的功能边界和限制）`);
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const doc of group.bundle.docs?.slice(0, 5) ?? []) {
    lines.push(`- ${doc.location}`);
  }
  lines.push('');

  lines.push(`## 标签`);
  lines.push('');
  lines.push(`${configType}、边界、配置`);

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