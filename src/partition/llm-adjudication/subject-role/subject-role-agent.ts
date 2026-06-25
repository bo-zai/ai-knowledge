import {
  createAgentRuntime,
  type AgentRuntime,
} from "../../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../../config/defaults.js";
import { logger } from "../../../shared/logger.js";
import { PromptLoader } from "../../../shared/prompt-loader.js";
import type { SubjectCandidateType } from "../../../domain-analysis/types.js";
import type {
  SubjectRoleAdjudicationInput,
  SubjectRoleAdjudicationOutput,
  SubjectRoleDecision,
} from "./types.js";

export class SubjectRoleAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: SubjectRoleAdjudicationInput,
  ): Promise<SubjectRoleAdjudicationOutput> {
    try {
      const systemPrompt = PromptLoader.load("subject-candidate-analysis").raw;
      const response = await this.agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildInputMessage(input) },
          ],
        },
        { recursionLimit: 80 },
      );
      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      const decisions = parseSubjectRoleOutput(content);
      return {
        decisions:
          decisions.length > 0 ? decisions : buildFallbackDecisions(input),
        success: decisions.length > 0,
        error: decisions.length > 0 ? undefined : "No valid JSON returned",
      };
    } catch (error) {
      logger.error("[SubjectRoleAgent] failed:", error);
      return {
        decisions: buildFallbackDecisions(input),
        success: false,
        error: String(error),
      };
    }
  }
}

export function createSubjectRoleAgent(repoPath: string): SubjectRoleAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "subject-role-agent",
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKey: process.env[LLM_DEFAULTS.apiKeyEnv] ?? LLM_DEFAULTS.apiKey,
      maxTokens: 96_000,
      temperature: 0,
    },
    workspacePath: repoPath,
    tools,
    enableSummarization: false,
    enableTodoList: false,
  });
  return new SubjectRoleAgent(agent);
}

function buildInputMessage(input: SubjectRoleAdjudicationInput): string {
  return `
请基于候选主体事实证据，识别每个主体的业务角色。

输入候选:
${JSON.stringify(input.candidates, null, 2)}

只输出 JSON 数组，格式:
[
  {
    "subjectId": "candidate_xxx",
    "subjectType": "business-root | business-support | cross-domain-reference | noise-or-aggregation",
    "suggestedDomainName": "domain-name",
    "businessTerms": ["term"],
    "ownedTableHints": ["table_a"],
    "dependencyTableHints": ["table_b"],
    "riskFlags": ["flag"],
    "reasoning": "reason",
    "confidence": 0.8
  }
]

判定约束:
- 如果一个候选同时满足以下多个特征，默认不要判为 business-root：
  1. uncertaintyFlags 包含 aggregator-shape 或 high-neighbor-count
  2. dependencyTables 明显多于 ownedTables
  3. joinedTables 很多，但 writeTables 很少
- business-root 必须优先体现“拥有自己的生命周期和主从表结构”，不是“能查到很多外部表”
- 被多个主体共享、主要作为资料/权限/字典/归属引用的候选，优先判为 cross-domain-reference
- 主要用于聚合查询、日志、审计、运营拼装的候选，优先判为 noise-or-aggregation
`;
}

function parseSubjectRoleOutput(content: string): SubjectRoleDecision[] {
  const candidates = [
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/\[[\s\S]*\]/)?.[0],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }
      return parsed.map(normalizeDecision);
    } catch {
      continue;
    }
  }
  return [];
}

function normalizeDecision(value: unknown): SubjectRoleDecision {
  const item = isRecord(value) ? value : {};
  return {
    subjectId: readString(item.subjectId) ?? "unknown",
    subjectType: normalizeSubjectType(item.subjectType),
    suggestedDomainName: readString(item.suggestedDomainName) ?? "",
    businessTerms: readStringArray(item.businessTerms),
    ownedTableHints: readStringArray(item.ownedTableHints),
    dependencyTableHints: readStringArray(item.dependencyTableHints),
    riskFlags: readStringArray(item.riskFlags),
    reasoning: readString(item.reasoning) ?? "未提供明确理由",
    confidence: normalizeConfidence(item.confidence),
  };
}

function buildFallbackDecisions(
  input: SubjectRoleAdjudicationInput,
): SubjectRoleDecision[] {
  return input.candidates.map((candidate) => {
    const hasAggregatorRisk =
      candidate.uncertaintyFlags.includes("aggregator-shape") ||
      candidate.uncertaintyFlags.includes("high-neighbor-count");
    const hasReferenceShape =
      candidate.dependencyTables.length > candidate.ownedTables.length ||
      candidate.joinedTables.length > candidate.writeTables.length + 2;
    const subjectType: SubjectCandidateType =
      candidate.anchorQuality === "low"
        ? "cross-domain-reference"
        : hasAggregatorRisk && hasReferenceShape
          ? "noise-or-aggregation"
          : hasReferenceShape
            ? "cross-domain-reference"
            : candidate.entryPoints.length > 0 &&
                candidate.ownedTables.length > 0
              ? "business-root"
              : "business-support";
    return {
      subjectId: candidate.subjectId,
      subjectType,
      suggestedDomainName: candidate.anchorTable,
      businessTerms: splitBusinessTerms(candidate.anchorTable),
      ownedTableHints: candidate.ownedTables,
      dependencyTableHints: candidate.dependencyTables,
      riskFlags: candidate.uncertaintyFlags,
      reasoning: "基于锚点质量、入口面和拥有表的保守回退判定",
      confidence: 0.35,
    };
  });
}

function normalizeSubjectType(value: unknown): SubjectCandidateType {
  switch (value) {
    case "business-root":
    case "business-support":
    case "cross-domain-reference":
    case "noise-or-aggregation":
      return value;
    default:
      return "cross-domain-reference";
  }
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function splitBusinessTerms(value: string): string[] {
  return value.split(/[_\W]+/).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
