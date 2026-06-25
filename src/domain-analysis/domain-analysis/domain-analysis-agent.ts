import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentRuntime,
  type AgentRuntime,
} from "../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../config/defaults.js";
import { logger } from "../../shared/logger.js";
import { withLongTaskLogging } from "../../shared/long-task-logger.js";
import type { DomainDefinition } from "../../partitioning/types.js";
import type { DomainAnalysisInput, DomainAnalysisResult } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");

const FALLBACK_PROMPT = `
# 业务域主分析专家

你负责根据候选主体、结构证据和依赖证据，一次性输出业务域划分结果。
只输出 JSON 数组。
`;

export class DomainAnalysisAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(input: DomainAnalysisInput): Promise<DomainAnalysisResult> {
    try {
      const systemPrompt = await loadSystemPrompt();
      const response = await withLongTaskLogging(
        {
          taskName: "domain main analysis",
          buildMessage: () =>
            `stage=domain-main-analysis, roots=${input.rootCandidates.length}, supports=${input.supportCandidates.length}, refs=${input.referenceCandidates.length}`,
        },
        () =>
          this.agent.invoke(
            {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: buildInputMessage(input) },
              ],
            },
            {
              recursionLimit: 100,
            },
          ),
      );

      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      const initialDecisions = parseDecisions(content);
      if (initialDecisions.length > 0) {
        return {
          decisions: initialDecisions,
          success: true,
          rawResponse: content,
        };
      }

      logger.warn(
        "[DomainAnalysis] Primary response did not contain valid JSON array, requesting repair",
      );
      const repairedContent = await this.repairResponse(content);

      return {
        decisions: parseDecisions(repairedContent),
        success: true,
        rawResponse: repairedContent,
      };
    } catch (error) {
      logger.error("[DomainAnalysis] failed:", error);
      return {
        decisions: [],
        success: false,
        error: String(error),
      };
    }
  }

  private async repairResponse(rawResponse: string): Promise<string> {
    const response = await this.agent.invoke(
      {
        messages: [
          {
            role: "system",
            content:
              "你是 JSON 修复器。把输入内容整理成一个合法 JSON 数组。不要解释，不要补充 Markdown，只输出 JSON 数组。",
          },
          {
            role: "user",
            content: `
请把下面内容整理为一个合法 JSON 数组。

要求：
- 只能输出 JSON 数组
- 保留原有字段语义
- 如果输入里没有有效数组，则输出 []

原始内容：
${rawResponse}
`,
          },
        ],
      },
      {
        recursionLimit: 20,
      },
    );

    const lastMessage = response.messages[response.messages.length - 1];
    return typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
  }
}

export function createDomainAnalysisAgent(
  repoPath: string,
): DomainAnalysisAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "domain-analysis-agent",
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
  return new DomainAnalysisAgent(agent);
}

async function loadSystemPrompt(): Promise<string> {
  const promptFile = path.join(PROMPTS_DIR, "domain-main-analysis.md");
  try {
    return await fs.readFile(promptFile, "utf-8");
  } catch (error) {
    logger.warn(
      `[DomainAnalysis] Failed to load prompt, using fallback: ${error}`,
    );
    return FALLBACK_PROMPT;
  }
}

function buildInputMessage(input: DomainAnalysisInput): string {
  const compactCandidates = input.evidenceBundle.candidates.map(
    (candidate) => ({
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
      entryPoints: candidate.entryPoints.map((entryPoint) => ({
        kind: entryPoint.kind,
        className: entryPoint.className,
        methodName: entryPoint.methodName,
        module: entryPoint.module,
        apiBasePath: entryPoint.apiInfo?.basePath,
      })),
      businessTerms: candidate.evidence?.businessTerms ?? [],
    }),
  );

  return `
请基于以下结构化证据，一次性输出最终业务域划分结果。

## 候选主体分类
${JSON.stringify(input.subjectClassifications, null, 2)}

## 候选摘要
${JSON.stringify(compactCandidates, null, 2)}

## 强弱关系分级
${JSON.stringify(input.schemaRelationGrades, null, 2)}

## 候选依赖矩阵
${JSON.stringify(input.dependencySignals, null, 2)}

## 排除规则
${JSON.stringify(input.exclusionRules, null, 2)}

## 项目上下文
${JSON.stringify(input.evidenceBundle.context, null, 2)}

输出 JSON 数组。每个元素格式如下：
{
  "domainName": "业务域名称",
  "confidence": 0.0,
  "coreCandidateIds": ["candidate:a"],
  "supportingCandidateIds": ["candidate:b"],
  "excludedCandidateIds": ["candidate:c"],
  "coreTables": ["table_a"],
  "supportingTables": ["table_b"],
  "crossDomainDependencies": [
    {
      "targetDomainHint": "用户域",
      "relationType": "aggregate_dependency",
      "evidence": ["reason"]
    }
  ],
  "reasoning": "为什么这些候选属于同一业务域，为什么其他候选只是依赖"
}
`;
}

function parseDecisions(content: string): DomainDefinition[] {
  const candidates = [
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/\[[\s\S]*\]/)?.[0],
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }
      return parsed.map((item, index) => normalizeDecision(item, index));
    } catch {
      continue;
    }
  }

  return [];
}

function normalizeDecision(value: unknown, index: number): DomainDefinition {
  const item = isRecord(value) ? value : {};
  return {
    domainName:
      typeof item.domainName === "string" && item.domainName.trim()
        ? item.domainName.trim()
        : `未命名域_${index + 1}`,
    confidence:
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5,
    coreCandidateIds: toStringArray(item.coreCandidateIds),
    supportingCandidateIds: toStringArray(item.supportingCandidateIds),
    excludedCandidateIds: toStringArray(item.excludedCandidateIds),
    coreTables: toStringArray(item.coreTables),
    supportingTables: toStringArray(item.supportingTables),
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
      if (!isRecord(item)) {
        return undefined;
      }
      if (
        typeof item.targetDomainHint !== "string" ||
        typeof item.relationType !== "string"
      ) {
        return undefined;
      }
      const relationType = normalizeDependencyRelationType(item.relationType);
      if (!relationType) {
        return undefined;
      }

      return {
        targetDomainHint: item.targetDomainHint,
        relationType,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
