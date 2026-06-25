import {
  createAgentRuntime,
  type AgentRuntime,
} from "../../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../../config/defaults.js";
import { logger } from "../../../shared/logger.js";
import { PromptLoader } from "../../../shared/prompt-loader.js";
import type { DomainDefinition } from "../../../partitioning/types.js";
import type { DomainAssemblyInput, DomainAssemblyOutput } from "./types.js";

export class DomainAssemblyAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(input: DomainAssemblyInput): Promise<DomainAssemblyOutput> {
    try {
      const systemPrompt = PromptLoader.load("domain-main-analysis").raw;
      const response = await this.agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildInputMessage(input) },
          ],
        },
        { recursionLimit: 100 },
      );
      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      const parseResult = parseDecisions(content);
      if (parseResult.warnings.length > 0) {
        logger.warn(
          `[DomainAssemblyAgent] filtered ${parseResult.warnings.length} output issues:\n${parseResult.warnings.join("\n")}`,
        );
      }
      return {
        decisions: parseResult.decisions,
        success: parseResult.decisions.length > 0,
        error:
          parseResult.decisions.length > 0
            ? parseResult.warnings.length > 0
              ? parseResult.warnings.join(" | ")
              : undefined
            : "No valid domain decision returned",
        rawResponse: content,
      };
    } catch (error) {
      logger.error("[DomainAssemblyAgent] failed:", error);
      return {
        decisions: [],
        success: false,
        error: String(error),
      };
    }
  }
}

export function createDomainAssemblyAgent(
  repoPath: string,
): DomainAssemblyAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "domain-assembly-agent",
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKey: process.env[LLM_DEFAULTS.apiKeyEnv] ?? LLM_DEFAULTS.apiKey,
      maxTokens: 128_000,
      temperature: 0,
    },
    workspacePath: repoPath,
    tools,
    enableSummarization: false,
    enableTodoList: false,
  });
  return new DomainAssemblyAgent(agent);
}

function buildInputMessage(input: DomainAssemblyInput): string {
  return `
请基于已经完成的主体角色判定与关系判定，输出最终业务域装配结果。

输入:
${JSON.stringify(input, null, 2)}

硬性输出要求:
1. 只能输出一个 JSON 数组
2. 数组中的每个元素都必须是一个完整的业务域对象
3. 禁止输出额外对象、汇总对象、excludedCandidates 汇总块、说明文字、Markdown 标题
4. 禁止把同一个 candidateId 放进多个元素的 coreCandidateIds
5. 如果某个候选不应该进入某个域，只能写进该域的 excludedCandidateIds，不能单独输出排除说明对象
6. 如果证据不足，优先少合并，改用 crossDomainDependencies 表达关系
7. 每个业务域都必须至少有一个 coreCandidateIds
8. coreCandidateIds 只能从 coreCandidatePool 中选择
9. nonCoreCandidatePool 中的候选不能出现在任何元素的 coreCandidateIds，只能进入 supportingCandidateIds 或 excludedCandidateIds
10. 如果你认为某些表应该成为独立业务域，但输入里没有对应的 coreCandidatePool 候选，则不要凭空创建该域

只输出 JSON 数组，每项严格使用以下格式:
{
  "domainName": "业务域名称",
  "confidence": 0.86,
  "coreCandidateIds": ["candidate:a"],
  "supportingCandidateIds": ["candidate:b"],
  "excludedCandidateIds": ["candidate:c"],
  "coreTables": ["table_a"],
  "supportingTables": ["table_b"],
  "crossDomainDependencies": [
    {
      "targetDomainHint": "other-domain",
      "relationType": "weak_reference",
      "evidence": ["reason"]
    }
  ],
  "reasoning": "reason"
}

错误示例 1:
[
  { "domainName": "订单", "coreCandidateIds": ["candidate:a"] },
  { "excludedCandidates": { "candidate:x": "噪声" } }
]
上面错误，因为第二个元素不是业务域对象。

错误示例 2:
[
  { "domainName": "订单", "coreCandidateIds": ["candidate:a"] },
  { "domainName": "会员", "coreCandidateIds": ["candidate:a"] }
]
上面错误，因为同一个 candidateId 同时作为多个域的核心。

正确示例:
[
  {
    "domainName": "订单履约",
    "confidence": 0.92,
    "coreCandidateIds": ["candidate:order"],
    "supportingCandidateIds": ["candidate:order_item", "candidate:shipment"],
    "excludedCandidateIds": ["candidate:member_profile"],
    "coreTables": ["t_order"],
    "supportingTables": ["t_order_item", "t_shipment"],
    "crossDomainDependencies": [
      {
        "targetDomainHint": "会员",
        "relationType": "weak_reference",
        "evidence": ["订单只保存 member_id 用于归属和查询"]
      }
    ],
    "reasoning": "订单主体具有独立生命周期，配送与明细围绕订单演化；会员仅作为被引用主体。"
  }
]

分析提醒:
- 先从 coreCandidatePool 中判断哪些 root 候选应保留为独立域核心
- 再决定 nonCoreCandidatePool 中哪些候选是 support/reference/noise
- 不要仅根据 coreTables 脑补一个不存在的核心候选
`;
}

function parseDecisions(content: string): {
  decisions: DomainDefinition[];
  warnings: string[];
} {
  const candidates = [
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
    ...extractJsonArrayCandidates(content),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }
      return normalizeDecisions(parsed);
    } catch {
      continue;
    }
  }

  return {
    decisions: [],
    warnings: ["未解析到有效的 JSON 数组输出"],
  };
}

function extractJsonArrayCandidates(content: string): string[] {
  const candidates: string[] = [];
  const stack: string[] = [];
  let startIndex = -1;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[") {
      if (stack.length === 0) {
        startIndex = index;
      }
      stack.push(char);
      continue;
    }

    if (char === "]" && stack.length > 0) {
      stack.pop();
      if (stack.length === 0 && startIndex >= 0) {
        candidates.push(content.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates.reverse();
}

function normalizeDecisions(values: unknown[]): {
  decisions: DomainDefinition[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const assignedCoreCandidates = new Map<string, string>();
  const decisions: DomainDefinition[] = [];

  for (const [index, value] of values.entries()) {
    const decision = normalizeDecision(value, index);
    if (!decision) {
      warnings.push(
        `已丢弃第 ${index + 1} 个数组元素，因为它不是有效的业务域对象`,
      );
      continue;
    }

    const uniqueCoreCandidateIds: string[] = [];
    for (const candidateId of decision.coreCandidateIds) {
      const ownerDomain = assignedCoreCandidates.get(candidateId);
      if (ownerDomain) {
        warnings.push(
          `已从业务域 ${decision.domainName} 中移除重复核心候选 ${candidateId}，该候选已归属 ${ownerDomain}`,
        );
        continue;
      }
      assignedCoreCandidates.set(candidateId, decision.domainName);
      uniqueCoreCandidateIds.push(candidateId);
    }

    if (uniqueCoreCandidateIds.length === 0) {
      warnings.push(
        `已丢弃业务域 ${decision.domainName}，因为没有有效的核心候选`,
      );
      continue;
    }

    decision.coreCandidateIds = uniqueCoreCandidateIds;
    decision.supportingCandidateIds = decision.supportingCandidateIds.filter(
      (candidateId) =>
        !decision.coreCandidateIds.includes(candidateId) &&
        !decision.excludedCandidateIds.includes(candidateId),
    );
    decision.coreTables = [...new Set(decision.coreTables)];
    decision.supportingTables = [...new Set(decision.supportingTables)].filter(
      (tableName) => !decision.coreTables.includes(tableName),
    );
    decisions.push(decision);
  }

  return { decisions, warnings };
}

function normalizeDecision(
  value: unknown,
  index: number,
): DomainDefinition | undefined {
  const item =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const coreCandidateIds = readStringArray(item.coreCandidateIds);
  const supportingCandidateIds = readStringArray(item.supportingCandidateIds);
  const excludedCandidateIds = readStringArray(item.excludedCandidateIds);

  if (
    coreCandidateIds.length === 0 &&
    supportingCandidateIds.length === 0 &&
    excludedCandidateIds.length > 0 &&
    !("domainName" in item)
  ) {
    return undefined;
  }

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
    excludedCandidateIds,
    coreTables: readStringArray(item.coreTables),
    supportingTables: readStringArray(item.supportingTables),
    crossDomainDependencies: normalizeDependencies(
      item.crossDomainDependencies,
    ),
    reasoning:
      typeof item.reasoning === "string" && item.reasoning.trim()
        ? item.reasoning.trim()
        : "LLM 未返回充分理由，已保留结构化结果",
  };
}

function normalizeDependencies(
  value: unknown,
): DomainDefinition["crossDomainDependencies"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.targetDomainHint !== "string" ||
        typeof record.relationType !== "string"
      ) {
        return undefined;
      }
      const relationType = normalizeDependencyRelationType(record.relationType);
      if (!relationType) {
        return undefined;
      }
      return {
        targetDomainHint: record.targetDomainHint,
        relationType,
        evidence: readStringArray(record.evidence),
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
