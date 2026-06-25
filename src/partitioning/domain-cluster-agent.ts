/**
 * DomainClusterAgent - 业务域划分 LLM Agent
 *
 * 使用 LangGraph 工具动态探索代码库，判断候选分区是否应该合并
 */

import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeConfig,
} from "../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import { logger } from "../shared/logger.js";
import { PromptLoader } from "../shared/prompt-loader.js";
import type {
  DomainClusterInput,
  DomainClusterResult,
  DomainDefinition,
  PartitionCandidate,
} from "./types.js";

/**
 * 加载提示词文件
 */
async function loadSystemPrompt(): Promise<string> {
  try {
    const content = PromptLoader.load("domain-cluster").raw;
    logger.info(`[DomainClusterAgent] Loaded prompt from PromptLoader`);
    return content;
  } catch (err) {
    logger.warn(
      `[DomainClusterAgent] Failed to load prompt file, using fallback: ${err}`,
    );
    return DOMAIN_CLUSTER_FALLBACK_PROMPT;
  }
}

/**
 * 备用提示词（文件加载失败时使用）
 */
const DOMAIN_CLUSTER_FALLBACK_PROMPT = `
# 业务域划分专家

你是一个业务域划分专家，专门负责分析代码库中的候选分区，判断它们是否属于同一个业务域，并做出合并决策。

请分析输入的候选分区，输出 JSON 数组格式的合并决策。
`;

// ========== Agent 类 ==========

/**
 * DomainClusterAgent - 业务域划分 LLM Agent
 */
export class DomainClusterAgent {
  private readonly workspacePath: string;
  private readonly agent: AgentRuntime;

  constructor(workspacePath: string, agent: AgentRuntime) {
    this.workspacePath = workspacePath;
    this.agent = agent;
  }

  /**
   * 分析候选分区，输出合并决策
   */
  async analyze(input: DomainClusterInput): Promise<DomainClusterResult> {
    const startTime = Date.now();

    try {
      // 加载提示词
      const systemPrompt = await loadSystemPrompt();

      // 构建输入消息
      const inputMessage = this.buildInputMessage(input);

      // 调用 Agent
      // recursionLimit 控制 Agent 执行循环次数（每次工具调用算一次递归）
      // 默认值 25 对于复杂分析任务可能不足，增加到 100 允许完成完整分析流程
      // 防止 GraphRecursionError: Recursion limit reached without hitting a stop condition
      const response = await this.agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: inputMessage },
          ],
        },
        {
          recursionLimit: 100,
        },
      );

      // 解析响应
      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      const decisions = this.parseDecisions(content);

      // 验证决策完整性
      const validation = this.validateDecisions(decisions, input.candidates);
      if (!validation.valid) {
        logger.warn(`Decision validation failed: ${validation.error}`);
        // 尝试修复
        const fixedDecisions = this.fixDecisions(decisions, input.candidates);
        return {
          decisions: fixedDecisions,
          success: true,
          executionTimeMs: Date.now() - startTime,
        };
      }

      return {
        decisions,
        success: true,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      logger.error("DomainClusterAgent failed:", err);
      return {
        decisions: [],
        success: false,
        error: String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 构建输入消息
   */
  private buildInputMessage(input: DomainClusterInput): string {
    const compactCandidates = input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      anchorQuality: candidate.anchorQuality,
      isInfrastructureCandidate: candidate.isInfrastructureCandidate,
      isAggregatorCandidate: candidate.isAggregatorCandidate,
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
      entryPoints: candidate.entryPoints.map((entryPoint) => ({
        className: entryPoint.className,
        methodName: entryPoint.methodName,
        module: entryPoint.module,
        apiBasePath: entryPoint.apiInfo?.basePath,
      })),
      services: candidate.services.map((service) => service.className),
      mappers: candidate.mappers.map((mapper) => ({
        className: mapper.className,
        tablesOperated: mapper.tablesOperated,
      })),
      callChainSummary: candidate.callChainSummary,
    }));
    const compactSchemaRelations = input.schemaRelationGraph.relations
      .slice(0, 80)
      .map((relation) => ({
        sourceTable: relation.sourceTable,
        targetTable: relation.targetTable,
        relationType: relation.relationType,
        strength: relation.strength,
        evidence: relation.evidence,
      }));

    // 构建 commit 历史部分
    let commitHistorySection = "";
    if (input.commitHistory && input.commitHistory.candidateCommits.size > 0) {
      commitHistorySection = `
## Git Commit 历史

以下是每个候选的入口点文件的 commit 历史（最近 20 条），可以帮助理解业务语义：

`;
      for (const [candidateId, commits] of input.commitHistory
        .candidateCommits) {
        if (commits.length > 0) {
          commitHistorySection += `### ${candidateId}\n`;
          for (const commit of commits) {
            commitHistorySection += `- ${commit.hash.slice(0, 7)}: ${commit.message}\n`;
          }
          commitHistorySection += "\n";
        }
      }
    }

    return `
请分析以下候选分区，判断是否需要合并。

## 项目上下文
- 项目路径: ${input.projectContext.repoPath}
- 模块列表: ${input.projectContext.moduleNames?.join(", ") ?? "未知"}
- 是否有领域文档: ${input.projectContext.hasDomainDocs ? "是" : "否"}

## 候选列表
${JSON.stringify(compactCandidates, null, 2)}

## 候选关系
${JSON.stringify(input.candidateRelations.slice(0, 120), null, 2)}

## 预分组
${JSON.stringify(input.candidateGroups.slice(0, 80), null, 2)}

## Schema 关系图
${JSON.stringify(compactSchemaRelations, null, 2)}
${input.analysisEvidence ? `\n## 精简证据视图\n${JSON.stringify(input.analysisEvidence, null, 2)}\n` : ""}
${commitHistorySection}
请输出 JSON 数组格式的业务域定义结果。
`;
  }

  /**
   * 解析决策
   */
  private parseDecisions(content: string): DomainDefinition[] {
    try {
      // 尝试直接解析 JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return this.normalizeDecisions(JSON.parse(jsonMatch[0]));
      }

      // 尝试解析 markdown 代码块中的 JSON
      const codeBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        return this.normalizeDecisions(JSON.parse(codeBlockMatch[1]));
      }

      // 尝试解析 markdown 代码块（无语言标记）
      const plainCodeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
      if (plainCodeBlockMatch) {
        return this.normalizeDecisions(JSON.parse(plainCodeBlockMatch[1]));
      }

      logger.warn("No valid JSON found in response");
      return [];
    } catch (err) {
      logger.error("Failed to parse decisions:", err);
      return [];
    }
  }

  private normalizeDecisions(value: unknown): DomainDefinition[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item, index) => this.normalizeDecision(item, index));
  }

  private normalizeDecision(value: unknown, index: number): DomainDefinition {
    const item = isRecord(value) ? value : {};
    const coreTables = toStringArray(item.coreTables);
    const supportingTables = toStringArray(item.supportingTables);
    const coreCandidateIds = toStringArray(item.coreCandidateIds);
    const supportingCandidateIds = toStringArray(item.supportingCandidateIds);

    return {
      domainName:
        typeof item.domainName === "string" && item.domainName.trim()
          ? item.domainName.trim()
          : `未命名域_${index + 1}`,
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5,
      coreCandidateIds,
      supportingCandidateIds,
      excludedCandidateIds: toStringArray(item.excludedCandidateIds),
      coreTables,
      supportingTables,
      crossDomainDependencies: normalizeCrossDomainDependencies(
        item.crossDomainDependencies,
      ),
      reasoning:
        typeof item.reasoning === "string" && item.reasoning.trim()
          ? item.reasoning.trim()
          : "LLM 未提供完整判断依据，已做结构归一化处理",
    };
  }

  /**
   * 验证决策完整性
   */
  private validateDecisions(
    decisions: DomainDefinition[],
    candidates: PartitionCandidate[],
  ): { valid: boolean; error?: string } {
    const allCandidateIds = candidates.map((c) => c.candidateId);
    const decisionIds = decisions.flatMap((decision) => [
      ...decision.coreCandidateIds,
      ...decision.supportingCandidateIds,
    ]);

    // 检查是否有遗漏
    const missing = allCandidateIds.filter((id) => !decisionIds.includes(id));
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing candidates: ${missing.join(", ")}`,
      };
    }

    // 检查是否有重复
    const duplicates = decisionIds.filter(
      (id, idx) => decisionIds.indexOf(id) !== idx,
    );
    if (duplicates.length > 0) {
      return {
        valid: false,
        error: `Duplicate candidates: ${duplicates.join(", ")}`,
      };
    }

    // 检查置信度范围
    for (const decision of decisions) {
      if (decision.confidence < 0 || decision.confidence > 1) {
        return {
          valid: false,
          error: `Invalid confidence for ${decision.domainName}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * 修复决策（添加遗漏的候选）
   */
  private fixDecisions(
    decisions: DomainDefinition[],
    candidates: PartitionCandidate[],
  ): DomainDefinition[] {
    const decisionIds = decisions.flatMap((decision) => [
      ...decision.coreCandidateIds,
      ...decision.supportingCandidateIds,
    ]);
    const missing = candidates.filter(
      (c) => !decisionIds.includes(c.candidateId),
    );

    // 为每个遗漏的候选创建单独决策
    for (const candidate of missing) {
      decisions.push({
        domainName: candidate.anchorTable,
        confidence: 0.3,
        coreCandidateIds: [candidate.candidateId],
        supportingCandidateIds: [],
        excludedCandidateIds: [],
        coreTables: candidate.coreTableNames,
        supportingTables: candidate.supportingTableNames,
        crossDomainDependencies: [],
        reasoning: "无法判断，Agent 未输出决策，自动生成独立决策",
      });
    }

    return decisions;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeCrossDomainDependencies(
  value: unknown,
): DomainDefinition["crossDomainDependencies"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }

      const targetDomainHint =
        typeof item.targetDomainHint === "string" ? item.targetDomainHint : "";
      const relationType =
        typeof item.relationType === "string" ? item.relationType : "";
      const normalizedRelationType =
        normalizeDependencyRelationType(relationType);

      if (!targetDomainHint || !normalizedRelationType) {
        return undefined;
      }

      return {
        targetDomainHint,
        relationType: normalizedRelationType,
        evidence: toStringArray(item.evidence),
      };
    })
    .filter(
      (item): item is DomainDefinition["crossDomainDependencies"][number] =>
        Boolean(item),
    );
}

function normalizeDependencyRelationType(
  value: string,
):
  | DomainDefinition["crossDomainDependencies"][number]["relationType"]
  | undefined {
  switch (value) {
    case "service_call":
    case "frontend_component":
    case "shared_table":
    case "shared_table_reference":
    case "aggregate_dependency":
    case "junction_dependency":
    case "weak_identity_reference":
      return value;
    case "reference":
    case "weak_reference":
      return "weak_identity_reference";
    default:
      return undefined;
  }
}

// ========== 工厂函数 ==========

/**
 * 创建 DomainClusterAgent 实例
 */
export async function createDomainClusterAgent(
  workspacePath: string,
  modelConfig?: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  },
): Promise<DomainClusterAgent> {
  // 使用默认配置或自定义配置
  const config = {
    model: modelConfig?.model ?? LLM_DEFAULTS.model,
    baseUrl: modelConfig?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    apiKey:
      modelConfig?.apiKey ??
      process.env[LLM_DEFAULTS.apiKeyEnv] ??
      LLM_DEFAULTS.apiKey,
    maxTokens: 128_000,
  };

  // 创建工具集（从统一的工具类导入）
  const tools = createDomainClusterTools(workspacePath);

  // 加载提示词
  const systemPrompt = await loadSystemPrompt();

  // 创建 Agent Runtime
  const agent = createAgentRuntime({
    model: {
      id: "domain-cluster-agent",
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxTokens: config.maxTokens,
      temperature: 0,
    },
    workspacePath,
    tools,
    extraSystemPrompt: systemPrompt,
    enableSummarization: false, // 禁用摘要，保持完整上下文
    enableTodoList: false,
  });

  return new DomainClusterAgent(workspacePath, agent);
}

/**
 * 同步版本：创建 DomainClusterAgent（不等待初始化）
 */
export function createDomainClusterAgentSync(
  workspacePath: string,
  agent: AgentRuntime,
): DomainClusterAgent {
  return new DomainClusterAgent(workspacePath, agent);
}
