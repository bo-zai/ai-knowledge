/**
 * DATA_MODEL 知识生成管线
 *
 * 聚合级别的数据模型知识生成，从仓库中：
 * 1. 识别实体关联关系
 * 2. 判断聚合边界
 * 3. 调用 LLM 生成聚合知识
 * 4. 写入 data-model/ 目录
 */

import path from "path";
import { logger } from "../shared/logger.js";
import { callLlmForJson } from "../generation/llm-json-client.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import {
  buildAllAggregateBundles,
  type DataModelAggregateBundle,
} from "../evidence/data-model-bundle-builder.js";
import { buildDataModelPrompt } from "../generation/object-generators/data-model-generator.js";
import {
  dataModelObjectSchema,
  type DataModelObject,
} from "../schemas/data-model.js";
import { getRepoBasename } from "../shared/path-utils.js";
import { generateObjectId } from "../shared/ids.js";
import { TYPE_TO_DIR } from "../knowledge/type-directory-map.js";
import type {
  KnowledgePackageContribution,
  KnowledgePackageStageReport,
} from "../packaging/knowledge-package-contribution.js";

export interface RunDataModelPipelineInput {
  repoPath: string;
  modelConfig: { model: string };
  claimsProvider: LlmClaimsProvider;
  outputRoot: string;
  /** 关联仓库路径（如核心库仓库） */
  companionRepoPath?: string;
  /** 已生成的概念名称列表（用于引用） */
  conceptNames?: string[];
  /** 超时时间（毫秒） */
  timeout?: number;
}

export interface DataModelGenerationResult {
  aggregateName: string;
  success: boolean;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 构建 DATA_MODEL 阶段报告
 */
export function buildDataModelStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: "data_model",
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 DATA_MODEL 知识生成管线
 */
export async function runDataModelKnowledgePipeline(
  input: RunDataModelPipelineInput,
): Promise<KnowledgePackageContribution> {
  const {
    repoPath,
    modelConfig,
    claimsProvider,
    outputRoot,
    companionRepoPath,
    conceptNames,
    timeout,
  } = input;

  logger.info("Starting DATA_MODEL knowledge pipeline...");

  // 1. 构建聚合证据包
  logger.info("Building aggregate evidence bundles...");
  const aggregateBundles = await buildAllAggregateBundles(
    repoPath,
    companionRepoPath,
  );
  logger.info(`Built ${aggregateBundles.length} aggregate bundles`);

  if (aggregateBundles.length === 0) {
    logger.warn("No aggregates found in repository");
    return {
      stage: "data_model",
      files: [],
      objects: [],
      report: buildDataModelStageReport({ succeeded: 0, failed: 0 }),
      warnings: ["No aggregates found in repository"],
    };
  }

  // 2. 为每个聚合生成知识
  const results: DataModelGenerationResult[] = [];
  const knowledgeDir = path.join(
    outputRoot,
    "ai-knowledge",
    TYPE_TO_DIR["DATA_MODEL"],
  );

  for (const [index, bundle] of aggregateBundles.entries()) {
    const aggregateName = bundle.suggested_aggregate_name;
    logger.info(
      `Generating DATA_MODEL for ${aggregateName} (${index + 1}/${aggregateBundles.length})`,
    );

    try {
      const result = await generateAggregateKnowledge(
        bundle,
        modelConfig,
        claimsProvider,
        knowledgeDir,
        repoPath,
        conceptNames,
        timeout,
      );
      results.push(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate ${aggregateName}: ${errorMsg}`);
      results.push({
        aggregateName,
        success: false,
        error: errorMsg,
      });
    }
  }

  // 3. 统计结果
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(
    `DATA_MODEL pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`,
  );

  // 4. 构建返回结果
  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: generateObjectId("DATA_MODEL", r.aggregateName),
    type: "DATA_MODEL",
    path: path.join(
      TYPE_TO_DIR["DATA_MODEL"],
      `${toFileName(r.aggregateName)}.md`,
    ),
    sliceIds: [],
  }));

  return {
    stage: "data_model",
    files,
    objects,
    report: buildDataModelStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[DATA_MODEL] ${r.aggregateName}: ${r.error}`),
  };
}

/**
 * 为单个聚合生成知识
 */
async function generateAggregateKnowledge(
  bundle: DataModelAggregateBundle,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  timeout?: number,
): Promise<DataModelGenerationResult> {
  const aggregateName = bundle.suggested_aggregate_name;
  const filePath = path.join(knowledgeDir, `${toFileName(aggregateName)}.md`);

  // 构建 prompt
  const { system, user } = buildDataModelPrompt({
    aggregate_bundle: bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
  });

  // 调用 LLM
  const result = await callLlmForJson<DataModelObject>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: "DATA_MODEL",
    fallbackContext: { aggregateName },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      aggregateName,
      aggregateRoot: bundle.aggregate_root,
      entities: bundle.entities.map((e) => e.entity_name),
    },
    logLabel: `DATA_MODEL: ${aggregateName}`,
  });

  if (!result.success || !result.data) {
    // 使用降级模板
    const fallbackContent = generateFallbackDataModel(bundle);
    await writeFile(filePath, fallbackContent);
    return { aggregateName, success: true, filePath, content: fallbackContent };
  }

  // 验证 schema
  try {
    dataModelObjectSchema.parse(result.data);
  } catch {
    logger.warn(
      `Schema validation failed for ${aggregateName}, using fallback`,
    );
    const fallbackContent = generateFallbackDataModel(bundle);
    await writeFile(filePath, fallbackContent);
    return { aggregateName, success: true, filePath, content: fallbackContent };
  }

  // 转换为 Markdown
  const mdContent = dataModelToMarkdown(result.data, bundle);

  // 写入文件
  await writeFile(filePath, mdContent);

  return { aggregateName, success: true, filePath, content: mdContent };
}

/**
 * 聚合知识转 Markdown
 */
function dataModelToMarkdown(
  data: DataModelObject,
  bundle: DataModelAggregateBundle,
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 头部
  lines.push(`# ${data.aggregate_name_zh || data.aggregate_name}`);
  lines.push("");
  lines.push(`> 类型：DATA_MODEL`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 来源文件：${bundle.mapper_files.slice(0, 5).join(", ")}`);
  if (data.module) {
    lines.push(`> 所属模块：${data.module}`);
  }
  lines.push(
    `> 标签：${data.aggregate_name_zh?.replace("聚合", "") || "数据模型"}、聚合、数据模型`,
  );
  lines.push("");

  // 聚合名称
  lines.push(`## 聚合名称`);
  lines.push("");
  lines.push(data.aggregate_name_zh || data.aggregate_name);
  lines.push("");

  // 聚合描述
  lines.push(`## 聚合描述`);
  lines.push("");
  lines.push(data.aggregate_description_zh || "（待补充）");
  lines.push("");

  // 核心实体表格
  lines.push(`## 核心实体`);
  lines.push("");
  lines.push("| 实体 | 描述 | 聚合角色 |");
  lines.push("|------|------|---------|");
  for (const entity of data.entities) {
    const roleZh =
      {
        aggregate_root: "聚合根",
        sub_entity: "子实体",
        associated_entity: "关联实体",
        relation_table: "关联表",
      }[entity.role] || entity.role;
    lines.push(
      `| ${entity.entity_name} | ${entity.description_zh} | ${roleZh} |`,
    );
  }
  lines.push("");

  // 实体关系
  if (data.entity_relations.length > 0) {
    lines.push(`## 实体关系`);
    lines.push("");
    for (const relation of data.entity_relations) {
      const typeZh =
        {
          one_to_one: "一对一",
          one_to_many: "一对多",
          many_to_one: "多对一",
          many_to_many: "多对多",
          composition: "组合",
          aggregation: "聚合",
        }[relation.relation_type] || relation.relation_type;
      lines.push(
        `- **${relation.source_entity} → ${relation.target_entity}**：${typeZh}（关联字段：${relation.relation_field}）`,
      );
    }
    lines.push("");
  }

  // 关联其他聚合
  if (data.cross_references && data.cross_references.length > 0) {
    lines.push(`## 关联其他聚合`);
    lines.push("");
    for (const ref of data.cross_references) {
      lines.push(
        `- 引用「${ref.aggregate_name}」中的 ${ref.entity_name}（通过 ${ref.reference_field}）`,
      );
    }
    lines.push("");
  }

  // 适用范围
  lines.push(`## 适用范围`);
  lines.push("");
  lines.push(data.scope_zh || "（待补充）");
  lines.push("");

  // 证据
  lines.push(`## 证据`);
  lines.push("");
  for (const mapperFile of bundle.mapper_files.slice(0, 5)) {
    lines.push(`- ${mapperFile}`);
  }
  lines.push("");

  // 标签
  lines.push(`## 标签`);
  lines.push("");
  lines.push(
    `${data.aggregate_name_zh?.replace("聚合", "") || "数据模型"}、聚合、数据模型`,
  );

  return lines.join("\n");
}

/**
 * 生成降级模板（LLM 失败时使用）
 */
function generateFallbackDataModel(bundle: DataModelAggregateBundle): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${bundle.suggested_aggregate_name}`);
  lines.push("");
  lines.push(`> 类型：DATA_MODEL`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 来源文件：${bundle.mapper_files.slice(0, 5).join(", ")}`);
  lines.push(`> 标签：${bundle.aggregate_root}、聚合、数据模型`);
  lines.push("");

  lines.push(`## 聚合名称`);
  lines.push("");
  lines.push(bundle.suggested_aggregate_name);
  lines.push("");

  lines.push(`## 聚合描述`);
  lines.push("");
  lines.push(`${bundle.aggregate_root} 及其关联实体组成的业务聚合。`);
  lines.push("");

  lines.push(`## 核心实体`);
  lines.push("");
  lines.push("| 实体 | 描述 | 聚合角色 |");
  lines.push("|------|------|---------|");
  for (const entity of bundle.entities) {
    const roleZh =
      {
        aggregate_root: "聚合根",
        sub_entity: "子实体",
        associated_entity: "关联实体",
        relation_table: "关联表",
      }[entity.role] || entity.role;
    lines.push(
      `| ${entity.entity_name} | ${entity.entity_name_zh} | ${roleZh} |`,
    );
  }
  lines.push("");

  if (bundle.entity_relations.length > 0) {
    lines.push(`## 实体关系`);
    lines.push("");
    for (const relation of bundle.entity_relations) {
      const typeZh =
        {
          one_to_one: "一对一",
          one_to_many: "一对多",
          many_to_one: "多对一",
          many_to_many: "多对多",
          composition: "组合",
          aggregation: "聚合",
        }[relation.relation_type] || relation.relation_type;
      lines.push(
        `- **${relation.source_entity} → ${relation.target_entity}**：${typeZh}，关联字段：${relation.relation_field}`,
      );
    }
    lines.push("");
  }

  if (bundle.cross_references.length > 0) {
    lines.push(`## 关联其他聚合`);
    lines.push("");
    for (const ref of bundle.cross_references) {
      lines.push(
        `- 引用「${ref.aggregate_name}」中的 ${ref.entity_name}（通过 ${ref.reference_field}）`,
      );
    }
    lines.push("");
  }

  lines.push(`## 适用范围`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 证据`);
  lines.push("");
  for (const mapperFile of bundle.mapper_files.slice(0, 5)) {
    lines.push(`- ${mapperFile}`);
  }
  lines.push("");

  lines.push(`## 标签`);
  lines.push("");
  lines.push(`${bundle.aggregate_root}、聚合、数据模型`);

  return lines.join("\n");
}

/**
 * 写入文件（确保目录存在）
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const fs = await import("fs/promises");
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * 聚合名称转文件名
 *
 * 例如：订单聚合 → order-aggregate.md
 */
function toFileName(aggregateName: string): string {
  // 移除"聚合"后缀
  const cleaned = aggregateName.replace(/聚合$/, "");
  // 转换为 kebab-case
  return (
    cleaned
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") + "-aggregate"
  );
}
