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
import type {
  SubjectCandidateAnalysisInput,
  SubjectCandidateAnalysisResult,
  SubjectCandidateClassification,
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");

const FALLBACK_PROMPT = `
# 候选业务主体识别专家

你负责把候选划分为业务主体、支撑主体、跨域引用主体、噪声/聚合主体。
只输出 JSON。
`;

export class SubjectCandidateAnalysisAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: SubjectCandidateAnalysisInput,
  ): Promise<SubjectCandidateAnalysisResult> {
    try {
      const systemPrompt = await loadSystemPrompt();
      const response = await this.agent.invoke(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildInputMessage(input) },
          ],
        },
        {
          recursionLimit: 80,
        },
      );

      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      const classifications = parseClassifications(content);
      if (classifications.length > 0) {
        return {
          classifications,
          success: true,
        };
      }

      logger.warn(
        "[SubjectCandidateAnalysis] No valid JSON returned, using fallback classification",
      );
      return {
        classifications: buildFallbackClassifications(input),
        success: true,
      };
    } catch (error) {
      logger.error("[SubjectCandidateAnalysis] failed:", error);
      return {
        classifications: buildFallbackClassifications(input),
        success: false,
        error: String(error),
      };
    }
  }
}

export function createSubjectCandidateAnalysisAgent(
  repoPath: string,
): SubjectCandidateAnalysisAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "subject-candidate-analysis-agent",
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
  return new SubjectCandidateAnalysisAgent(agent);
}

async function loadSystemPrompt(): Promise<string> {
  const promptFile = path.join(PROMPTS_DIR, "subject-candidate-analysis.md");
  try {
    return await fs.readFile(promptFile, "utf-8");
  } catch (error) {
    logger.warn(
      `[SubjectCandidateAnalysis] Failed to load prompt, using fallback: ${error}`,
    );
    return FALLBACK_PROMPT;
  }
}

function buildInputMessage(input: SubjectCandidateAnalysisInput): string {
  return `
请识别哪些候选是真正的业务主体，哪些只是支撑、共享引用或噪声。

## 候选列表
${JSON.stringify(input.candidates, null, 2)}

输出 JSON 数组。每个元素格式如下：
{
  "candidateId": "candidate:xxx",
  "subjectType": "business-root | business-support | cross-domain-reference | noise-or-aggregation",
  "suggestedDomainName": "候选建议域名",
  "businessTerms": ["term"],
  "ownedTableHints": ["table_a"],
  "dependencyTableHints": ["table_b"],
  "riskFlags": ["shared_identity"],
  "reasoning": "判断理由",
  "confidence": 0.0
}
`;
}

function parseClassifications(
  content: string,
): SubjectCandidateClassification[] {
  const candidates = [
    content.match(/\[[\s\S]*\]/)?.[0],
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }
      return parsed.map((item, index) => normalizeClassification(item, index));
    } catch {
      continue;
    }
  }

  return [];
}

function normalizeClassification(
  value: unknown,
  index: number,
): SubjectCandidateClassification {
  const item = isRecord(value) ? value : {};
  const subjectType = normalizeSubjectType(item.subjectType);
  return {
    candidateId:
      typeof item.candidateId === "string" && item.candidateId.trim()
        ? item.candidateId
        : `unknown-${index}`,
    subjectType,
    suggestedDomainName:
      typeof item.suggestedDomainName === "string" &&
      item.suggestedDomainName.trim()
        ? item.suggestedDomainName.trim()
        : "",
    businessTerms: toStringArray(item.businessTerms),
    ownedTableHints: toStringArray(item.ownedTableHints),
    dependencyTableHints: toStringArray(item.dependencyTableHints),
    riskFlags: toStringArray(item.riskFlags),
    reasoning:
      typeof item.reasoning === "string" ? item.reasoning : "未提供明确理由",
    confidence:
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5,
  };
}

function buildFallbackClassifications(
  input: SubjectCandidateAnalysisInput,
): SubjectCandidateClassification[] {
  return input.candidates.map((candidate) => {
    const entryPointCount = candidate.entryPointSummaries.length;
    const relationReasons = candidate.relationSignals.flatMap(
      (signal) => signal.relationReasons,
    );
    const hasAggregatorRisk = relationReasons.some(
      (reason) =>
        reason.includes("shared-core:") || reason.includes("shared-service:"),
    );
    const subjectType =
      candidate.anchorQuality === "low" || hasAggregatorRisk
        ? "cross-domain-reference"
        : entryPointCount > 0
          ? "business-root"
          : "business-support";

    return {
      candidateId: candidate.candidateId,
      subjectType,
      suggestedDomainName: candidate.anchorTable,
      businessTerms: candidate.businessTerms,
      ownedTableHints:
        candidate.ownedTables.length > 0
          ? candidate.ownedTables
          : candidate.coreTables,
      dependencyTableHints: [
        ...candidate.supportingTables,
        ...candidate.dependencyTables,
      ],
      riskFlags: hasAggregatorRisk ? ["shared-aggregation-risk"] : [],
      reasoning: "基于入口点、锚点质量和共享关系的保守回退分类",
      confidence: 0.35,
    };
  });
}

function normalizeSubjectType(
  value: unknown,
): SubjectCandidateClassification["subjectType"] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
