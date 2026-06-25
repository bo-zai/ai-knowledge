import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgentRuntime,
  type AgentRuntime,
} from "../../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../../config/defaults.js";
import { logger } from "../../../shared/logger.js";
import type {
  RelationAdjudicationDecision,
  RelationAdjudicationInput,
  RelationAdjudicationOutput,
  RelationDecisionType,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "..", "prompts");

export class RelationAdjudicationAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: RelationAdjudicationInput,
  ): Promise<RelationAdjudicationOutput> {
    try {
      const systemPrompt = await fs.readFile(
        path.join(PROMPTS_DIR, "relation-adjudication.md"),
        "utf-8",
      );
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
      const decisions = parseOutput(content);
      return {
        decisions:
          decisions.length > 0 ? decisions : buildFallbackDecisions(input),
        success: decisions.length > 0,
        error: decisions.length > 0 ? undefined : "No valid JSON returned",
      };
    } catch (error) {
      logger.error("[RelationAdjudicationAgent] failed:", error);
      return {
        decisions: buildFallbackDecisions(input),
        success: false,
        error: String(error),
      };
    }
  }
}

export function createRelationAdjudicationAgent(
  repoPath: string,
): RelationAdjudicationAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "relation-adjudication-agent",
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
  return new RelationAdjudicationAgent(agent);
}

function buildInputMessage(input: RelationAdjudicationInput): string {
  return `
请判断每条主体关系更接近 ownership、reference、shared-master-data 还是 noise-correlation。

输入关系:
${JSON.stringify(input.relations, null, 2)}

只输出 JSON 数组:
[
  {
    "relationId": "x",
    "decisionType": "ownership | reference | shared-master-data | noise-correlation",
    "confidence": 0.8,
    "reasoning": "reason"
  }
]
`;
}

function parseOutput(content: string): RelationAdjudicationDecision[] {
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
      return parsed.map((item) => normalizeDecision(item));
    } catch {
      continue;
    }
  }
  return [];
}

function normalizeDecision(value: unknown): RelationAdjudicationDecision {
  const item =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    relationId:
      typeof item.relationId === "string" ? item.relationId : "unknown",
    decisionType: normalizeDecisionType(item.decisionType),
    confidence:
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5,
    reasoning:
      typeof item.reasoning === "string" ? item.reasoning : "未提供明确理由",
  };
}

function buildFallbackDecisions(
  input: RelationAdjudicationInput,
): RelationAdjudicationDecision[] {
  return input.relations.map((relation) => ({
    relationId: relation.relationId,
    decisionType:
      relation.inferredKind === "weak-signal"
        ? "noise-correlation"
        : relation.inferredKind === "cohesion"
          ? "reference"
          : "reference",
    confidence: 0.35,
    reasoning: "基于结构关系类型的保守回退判定",
  }));
}

function normalizeDecisionType(value: unknown): RelationDecisionType {
  switch (value) {
    case "ownership":
    case "reference":
    case "shared-master-data":
    case "noise-correlation":
      return value;
    default:
      return "reference";
  }
}
