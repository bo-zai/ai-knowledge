/**
 * WORKFLOW 知识生成管线
 *
 * 跨域业务流程知识生成，从仓库中：
 * 1. 提取 Controller-Service 调用链证据
 * 2. 调用 LLM 生成跨域业务流程知识
 * 3. 写入 workflows/ 目录
 */

import path from "path";
import { logger } from "../shared/logger.js";
import { callLlmForJson } from "../generation/llm-json-client.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import { buildWorkflowPrompt } from "../generation/object-generators/workflow-generator.js";
import { workflowSchema, type WorkflowKnowledge } from "../schemas/workflow.js";
import { getRepoBasename } from "../shared/path-utils.js";
import { generateObjectId } from "../shared/ids.js";
import { TYPE_TO_DIR } from "../knowledge/type-directory-map.js";
import type {
  KnowledgePackageContribution,
  KnowledgePackageStageReport,
} from "../packaging/knowledge-package-contribution.js";
import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";

export interface RunWorkflowPipelineInput {
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
 * 构建 WORKFLOW 阶段报告
 */
export function buildWorkflowStageReport(input: {
  succeeded: number;
  failed: number;
}): KnowledgePackageStageReport {
  return {
    stage: "workflow",
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: {},
  };
}

/**
 * 运行 WORKFLOW 知识生成管线
 */
export async function runWorkflowKnowledgePipeline(
  input: RunWorkflowPipelineInput,
): Promise<KnowledgePackageContribution> {
  const {
    repoPath,
    modelConfig,
    claimsProvider,
    outputRoot,
    conceptNames,
    capabilityNames,
    timeout,
    evidenceGroups,
  } = input;

  logger.info("Starting WORKFLOW knowledge pipeline...");

  if (!evidenceGroups || evidenceGroups.length === 0) {
    logger.warn("No workflow evidence found in repository");
    return {
      stage: "workflow",
      files: [],
      objects: [],
      report: buildWorkflowStageReport({ succeeded: 0, failed: 0 }),
      warnings: ["No workflow evidence found"],
    };
  }

  const knowledgeDir = path.join(
    outputRoot,
    "ai-knowledge",
    TYPE_TO_DIR["WORKFLOW"],
  );
  const results: WorkflowGenerationResult[] = [];

  for (const [index, group] of evidenceGroups.entries()) {
    const groupId = group.groupId;
    logger.info(
      `Generating WORKFLOW for ${groupId} (${index + 1}/${evidenceGroups.length})`,
    );

    try {
      const result = await generateWorkflowKnowledge(
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
      logger.error(`Failed to generate WORKFLOW ${groupId}: ${errorMsg}`);
      results.push({
        groupId,
        success: false,
        error: errorMsg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  logger.info(
    `WORKFLOW pipeline completed: ${succeeded.length} succeeded, ${failed.length} failed`,
  );

  const files = succeeded
    .filter((r) => r.filePath && r.content)
    .map((r) => ({ path: r.filePath!, content: r.content! }));

  const objects = succeeded.map((r) => ({
    id: r.objectId ?? generateObjectId("WORKFLOW", r.groupId),
    type: "WORKFLOW",
    path: r.filePath ? path.relative(outputRoot, r.filePath) : "",
    sliceIds: [],
  }));

  return {
    stage: "workflow",
    files,
    objects,
    report: buildWorkflowStageReport({
      succeeded: succeeded.length,
      failed: failed.length,
    }),
    warnings: failed.map((r) => `[WORKFLOW] ${r.groupId}: ${r.error}`),
  };
}

interface WorkflowGenerationResult {
  groupId: string;
  success: boolean;
  objectId?: string;
  filePath?: string;
  content?: string;
  error?: string;
}

/**
 * 为单个证据组生成跨域业务流程知识
 */
async function generateWorkflowKnowledge(
  group: EvidenceGroup,
  modelConfig: { model: string },
  claimsProvider: LlmClaimsProvider,
  knowledgeDir: string,
  repoPath: string,
  conceptNames?: string[],
  capabilityNames?: string[],
  timeout?: number,
): Promise<WorkflowGenerationResult> {
  const groupId = group.groupId;
  const fileName = toFileName(groupId);
  const filePath = path.join(knowledgeDir, `${fileName}.md`);

  const { system, user } = buildWorkflowPrompt({
    evidence_bundle: group.bundle,
    repoName: getRepoBasename(repoPath),
    concept_names: conceptNames,
    capability_names: capabilityNames,
  });

  const result = await callLlmForJson<WorkflowKnowledge>({
    systemPrompt: system,
    userPrompt: user,
    claimsProvider,
    knowledgeType: "WORKFLOW",
    fallbackContext: { groupId },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      groupId,
    },
    logLabel: `WORKFLOW: ${groupId}`,
  });

  if (!result.success || !result.data) {
    const fallbackContent = generateFallbackWorkflow(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  try {
    workflowSchema.parse(result.data);
  } catch {
    logger.warn(
      `Schema validation failed for WORKFLOW ${groupId}, using fallback`,
    );
    const fallbackContent = generateFallbackWorkflow(group);
    await writeFile(filePath, fallbackContent);
    return { groupId, success: true, filePath, content: fallbackContent };
  }

  const mdContent = workflowToMarkdown(result.data, group);

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
 * 跨域业务流程知识转 Markdown
 */
function workflowToMarkdown(
  data: WorkflowKnowledge,
  group: EvidenceGroup,
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`# ${data.name_zh || data.workflow_name}`);
  lines.push("");
  lines.push(`> 类型：WORKFLOW`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：${data.tags.join("、")}`);
  lines.push("");

  lines.push(`## 流程名称`);
  lines.push("");
  lines.push(data.workflow_name);
  lines.push("");

  lines.push(`## 业务目标`);
  lines.push("");
  lines.push(data.business_goal);
  lines.push("");

  lines.push(`## 涉及域`);
  lines.push("");
  for (const domain of data.involved_domains) {
    lines.push(`- ${domain}`);
  }
  lines.push("");

  lines.push(`## 流程步骤`);
  lines.push("");
  lines.push("| 序号 | 所属域 | 操作 | 描述 |");
  lines.push("|------|---------|------|------|");
  for (const step of data.steps) {
    lines.push(
      `| ${step.order} | ${step.domain} | ${step.action} | ${step.description} |`,
    );
  }
  lines.push("");

  lines.push(`## 触发条件`);
  lines.push("");
  lines.push(data.trigger_condition);
  lines.push("");

  lines.push(`## 完成标志`);
  lines.push("");
  lines.push(data.completion_flag);
  lines.push("");

  if (data.key_branches && data.key_branches.length > 0) {
    lines.push(`## 关键分支`);
    lines.push("");
    for (const branch of data.key_branches) {
      lines.push(`- ${branch}`);
    }
    lines.push("");
  }

  lines.push(`## 适用范围`);
  lines.push("");
  lines.push(data.applicable_scope);
  lines.push("");

  lines.push(`## 证据`);
  lines.push("");
  for (const trace of group.bundle.flowTraces?.slice(0, 5) ?? []) {
    if (trace.steps[0]?.location) {
      lines.push(`- ${trace.steps[0].location}`);
    }
  }
  for (const ev of data.evidence.slice(0, 5)) {
    lines.push(`- ${ev}`);
  }
  lines.push("");

  lines.push(`## 标签`);
  lines.push("");
  lines.push(data.tags.join("、"));

  return lines.join("\n");
}

/**
 * 生成降级模板
 */
function generateFallbackWorkflow(group: EvidenceGroup): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 从 flowTraces 提取服务名称作为域
  const domains = new Set<string>();
  for (const trace of group.bundle.flowTraces ?? []) {
    if (trace.steps[0]?.action) {
      const parts = trace.steps[0].action.split(".");
      if (parts[0]) domains.add(parts[0]);
    }
    if (trace.steps[1]?.action) {
      const parts = trace.steps[1].action.split(".");
      if (parts[0]) domains.add(parts[0]);
    }
  }

  lines.push(`# 跨域业务流程`);
  lines.push("");
  lines.push(`> 类型：WORKFLOW`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 标签：流程、跨域`);
  lines.push("");

  lines.push(`## 流程名称`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 业务目标`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 涉及域`);
  lines.push("");
  for (const domain of domains) {
    lines.push(`- ${domain}`);
  }
  lines.push("");

  lines.push(`## 流程步骤`);
  lines.push("");
  lines.push("| 序号 | 所属域 | 操作 | 描述 |");
  lines.push("|------|---------|------|------|");
  let order = 1;
  for (const trace of group.bundle.flowTraces?.slice(0, 5) ?? []) {
    for (const step of trace.steps) {
      const parts = step.action.split(".");
      const domain = parts[0] || "";
      const action = parts[1] || step.action;
      lines.push(`| ${order} | ${domain} | ${action} | （待补充） |`);
      order++;
    }
  }
  lines.push("");

  lines.push(`## 触发条件`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 完成标志`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 适用范围`);
  lines.push("");
  lines.push("（待人工补充）");
  lines.push("");

  lines.push(`## 证据`);
  lines.push("");
  for (const trace of group.bundle.flowTraces?.slice(0, 5) ?? []) {
    if (trace.steps[0]?.location) {
      lines.push(`- ${trace.steps[0].location}`);
    }
  }
  lines.push("");

  lines.push(`## 标签`);
  lines.push("");
  lines.push("流程、跨域");

  return lines.join("\n");
}

/**
 * 写入文件
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const fs = await import("fs/promises");
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * groupId 转 kebab-case 文件名
 */
function toFileName(groupId: string): string {
  return groupId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
