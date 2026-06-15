/**
 * CONSTRAINT 知识生成管线
 *
 * 约束知识生成，从仓库中：
 * 1. 提取异常和约束证据
 * 2. 调用 LLM 生成约束知识
 * 3. 写入 constraints/ 目录
 */

import path from 'path';
import { logger } from '../shared/logger.js';
import { callLlmForJson } from '../generation/llm-json-client.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { buildConstraintPrompt } from '../generation/object-generators/constraint-generator.js';
import { constraintSchema, type ConstraintKnowledge } from '../schemas/constraint.js';
import { getRepoBasename } from '../shared/path-utils.js';
import { generateObjectId } from '../shared/ids.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import type { KnowledgePackageContribution, KnowledgePackageStageReport } from '../packaging/knowledge-package-contribution.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';

export interface RunConstraintPipelineInput {
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
 * 构建 CONSTRAINT 阶段报告
 */
export function buildConstraintStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: 'constraint',
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 CONSTRAINT 知识生成管线
 */
export async function runConstraintKnowledgePipeline(
  input: RunConstraintPipelineInput,
): Promise<KnowledgePackageContribution> {
  const { repoPath, modelConfig, claimsProvider, outputRoot, conceptNames, capabilityNames, timeout, evidenceGroups } = input;

  logger.info('Starting CONSTRAINT knowledge pipeline...');

  if (!evidenceGroups || evidenceGroups.length === 0) {
    logger.warn('No constraint evidence found in repository');
    return {
      stage: 'constraint',
      files: [],
      objects: [],
      report: buildConstraintStageReport({ succeeded: 0, failed: 0 }),
      warnings: ['No constraint evidence found'],
    };
  }

  const knowledgeDir = path.join(outputRoot, 'ai-knowledge', TYPE_TO_DIR['CONSTRAINT']);
  const results: ConstraintGenerationResult[] = [];

  for (const [index, group] of evidenceGroups.entries()) {
    const groupId = group.groupId;
    logger.info(`Generating CONSTRAINT for ${groupId} (${index + 1}/${evidenceGroups.length})`);

    try {
      const result = await generateConstraintKnowledge(
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
      logger.error(`Failed to generate CONSTRAINT ${groupId}: ${errorMsg}`);
      results.push({
        groupId,
        success: false,
        error: errorMsg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(`CONSTRAINT pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`);

  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: r.objectId ?? generateObjectId('CONSTRAINT', r.groupId),
    type: 'CONSTRAINT',
    path: r.filePath ? path.relative(outputRoot, r.filePath) : '',
    sliceIds: [],
  }));

  return {
    stage: 'constraint',
    files,
    objects,
    report: buildConstraintStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[CONSTRAINT] ${r.groupId}: ${r.error}`),
  };
}

interface ConstraintGenerationResult {
  groupId: string;
  success: boolean;
  objectId?: string;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 为单个证据组生成约束知识
 */
async function generateConstraintKnowledge(
  group: EvidenceGroup,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  capabilityNames?: string[],
  timeout?: number,
): Promise<ConstraintGenerationResult> {
  const groupId = group.groupId;
  const fileName = toFileName(groupId);
  const filePath = path.join(knowledgeDir, `${fileName}.md`);

  const { system, user } = buildConstraintPrompt({
    evidence_bundle: group.bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
    capability_names: capabilityNames,
  });

  const result = await callLlmForJson<ConstraintKnowledge>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: 'CONSTRAINT',
    fallbackContext: { groupId },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      groupId,
    },
    logLabel: `CONSTRAINT: ${groupId}`,
  });

  if (!result.success || !result.data) {
    const fallbackContent = generateFallbackConstraint(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  try {
    constraintSchema.parse(result.data);
  } catch {
    logger.warn(`Schema validation failed for CONSTRAINT ${groupId}, using fallback`);
    const fallbackContent = generateFallbackConstraint(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  const mdContent = constraintToMarkdown(result.data, group);

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
 * 约束知识转 Markdown
 */
function constraintToMarkdown(data: ConstraintKnowledge, group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${data.name_zh || data.constraint_name}`);
  lines.push('');
  lines.push(`> 类型：CONSTRAINT`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：${data.tags.join('、')}`);
  lines.push('');

  lines.push(`## 约束名称`);
  lines.push('');
  lines.push(data.constraint_name);
  lines.push('');

  lines.push(`## 约束类型`);
  lines.push('');
  const typeZh = {
    business_rule: '业务规则',
    technical: '技术约束',
    data: '数据约束',
  }[data.constraint_type] || data.constraint_type;
  lines.push(typeZh);
  lines.push('');

  lines.push(`## 约束描述`);
  lines.push('');
  lines.push(data.constraint_description_zh);
  lines.push('');

  lines.push(`## 触发条件`);
  lines.push('');
  lines.push(data.trigger_condition);
  lines.push('');

  lines.push(`## 作用范围`);
  lines.push('');
  for (const scope of data.impact_scope) {
    lines.push(`- ${scope}`);
  }
  lines.push('');

  if (data.violation_consequence) {
    lines.push(`## 违反后果`);
    lines.push('');
    lines.push(data.violation_consequence);
    lines.push('');
  }

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
function generateFallbackConstraint(group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# 约束知识`);
  lines.push('');
  lines.push(`> 类型：CONSTRAINT`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：约束、规则`);
  lines.push('');

  lines.push(`## 约束名称`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 约束类型`);
  lines.push('');
  lines.push('业务规则');
  lines.push('');

  lines.push(`## 约束描述`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 触发条件`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 作用范围`);
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
  lines.push('约束、规则');

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