/**
 * RELATION 知识生成管线
 *
 * 能力关系知识生成，从仓库中：
 * 1. 提取 Service 调用关系证据
 * 2. 调用 LLM 生成能力关系知识
 * 3. 写入 relations/ 目录
 */

import path from 'path';
import { logger } from '../shared/logger.js';
import { callLlmForJson } from '../generation/llm-json-client.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { buildRelationPrompt } from '../generation/object-generators/relation-generator.js';
import { relationSchema, type RelationKnowledge } from '../schemas/relation.js';
import { getRepoBasename } from '../shared/path-utils.js';
import { generateObjectId } from '../shared/ids.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import type { KnowledgePackageContribution, KnowledgePackageStageReport } from '../packaging/knowledge-package-contribution.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';

export interface RunRelationPipelineInput {
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
 * 构建 RELATION 阶段报告
 */
export function buildRelationStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: 'relation',
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 RELATION 知识生成管线
 */
export async function runRelationKnowledgePipeline(
  input: RunRelationPipelineInput,
): Promise<KnowledgePackageContribution> {
  const { repoPath, modelConfig, claimsProvider, outputRoot, conceptNames, capabilityNames, timeout, evidenceGroups } = input;

  logger.info('Starting RELATION knowledge pipeline...');

  if (!evidenceGroups || evidenceGroups.length === 0) {
    logger.warn('No relation evidence found in repository');
    return {
      stage: 'relation',
      files: [],
      objects: [],
      report: buildRelationStageReport({ succeeded: 0, failed: 0 }),
      warnings: ['No relation evidence found'],
    };
  }

  const knowledgeDir = path.join(outputRoot, 'ai-knowledge', TYPE_TO_DIR['RELATION']);
  const results: RelationGenerationResult[] = [];

  for (const [index, group] of evidenceGroups.entries()) {
    const groupId = group.groupId;
    logger.info(`Generating RELATION for ${groupId} (${index + 1}/${evidenceGroups.length})`);

    try {
      const result = await generateRelationKnowledge(
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
      logger.error(`Failed to generate RELATION ${groupId}: ${errorMsg}`);
      results.push({
        groupId,
        success: false,
        error: errorMsg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(`RELATION pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`);

  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: r.objectId ?? generateObjectId('RELATION', r.groupId),
    type: 'RELATION',
    path: r.filePath ? path.relative(outputRoot, r.filePath) : '',
    sliceIds: [],
  }));

  return {
    stage: 'relation',
    files,
    objects,
    report: buildRelationStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[RELATION] ${r.groupId}: ${r.error}`),
  };
}

interface RelationGenerationResult {
  groupId: string;
  success: boolean;
  objectId?: string;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 为单个证据组生成能力关系知识
 */
async function generateRelationKnowledge(
  group: EvidenceGroup,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  capabilityNames?: string[],
  timeout?: number,
): Promise<RelationGenerationResult> {
  const groupId = group.groupId;
  const fileName = toFileName(groupId);
  const filePath = path.join(knowledgeDir, `${fileName}.md`);

  const { system, user } = buildRelationPrompt({
    evidence_bundle: group.bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
    capability_names: capabilityNames,
  });

  const result = await callLlmForJson<RelationKnowledge>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: 'RELATION',
    fallbackContext: { groupId },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      groupId,
    },
    logLabel: `RELATION: ${groupId}`,
  });

  if (!result.success || !result.data) {
    const fallbackContent = generateFallbackRelation(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  try {
    relationSchema.parse(result.data);
  } catch {
    logger.warn(`Schema validation failed for RELATION ${groupId}, using fallback`);
    const fallbackContent = generateFallbackRelation(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  const mdContent = relationToMarkdown(result.data, group);

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
 * 能力关系知识转 Markdown
 */
function relationToMarkdown(data: RelationKnowledge, group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${data.name_zh || data.relation_name}`);
  lines.push('');
  lines.push(`> 类型：RELATION`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：${data.tags.join('、')}`);
  lines.push('');

  lines.push(`## 关系名称`);
  lines.push('');
  lines.push(data.relation_name);
  lines.push('');

  lines.push(`## 关系类型`);
  lines.push('');
  const typeZh = {
    call_dependency: '调用依赖',
    trigger_chain: '触发链',
    async_trigger: '异步触发',
    shared_entity: '共享实体',
    composition: '组合',
  }[data.relation_type] || data.relation_type;
  lines.push(typeZh);
  lines.push('');

  lines.push(`## 参与能力`);
  lines.push('');
  for (const cap of data.participating_capabilities) {
    lines.push(`- ${cap}`);
  }
  lines.push('');

  lines.push(`## 关系描述`);
  lines.push('');
  lines.push(data.relation_description_zh);
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push(data.applicable_scope);
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const trace of group.bundle.flowTraces?.slice(0, 5) ?? []) {
    if (trace.steps[0]?.location) {
      lines.push(`- ${trace.steps[0].location}`);
    }
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
function generateFallbackRelation(group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 从 flowTraces 提取服务名称
  const services = new Set<string>();
  for (const trace of group.bundle.flowTraces ?? []) {
    if (trace.steps[0]?.action) {
      const parts = trace.steps[0].action.split('.');
      if (parts[0]) services.add(parts[0]);
    }
    if (trace.steps[1]?.action) {
      const parts = trace.steps[1].action.split('.');
      if (parts[0]) services.add(parts[0]);
    }
  }

  lines.push(`# 服务调用关系`);
  lines.push('');
  lines.push(`> 类型：RELATION`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：关系、依赖`);
  lines.push('');

  lines.push(`## 关系名称`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 关系类型`);
  lines.push('');
  lines.push('调用依赖');
  lines.push('');

  lines.push(`## 参与能力`);
  lines.push('');
  for (const service of services) {
    lines.push(`- ${service}`);
  }
  lines.push('');

  lines.push(`## 关系描述`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 适用范围`);
  lines.push('');
  lines.push('（待人工补充）');
  lines.push('');

  lines.push(`## 证据`);
  lines.push('');
  for (const trace of group.bundle.flowTraces?.slice(0, 5) ?? []) {
    if (trace.steps[0]?.location) {
      lines.push(`- ${trace.steps[0].location}`);
    }
  }
  lines.push('');

  lines.push(`## 标签`);
  lines.push('');
  lines.push('关系、依赖');

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