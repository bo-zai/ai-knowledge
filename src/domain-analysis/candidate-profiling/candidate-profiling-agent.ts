import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentRuntime } from "../../agent-runtime/runtime.js";
import { createAgentRuntime } from "../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../config/defaults.js";
import { logger } from "../../shared/logger.js";
import { withLongTaskLogging } from "../../shared/long-task-logger.js";
import type {
  CandidateProfile,
  CandidateProfilingInput,
  CandidateProfilingResult,
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");

const FALLBACK_PROMPT = `
# Candidate Profiling Expert

你负责判断单个候选更像核心业务、支撑业务、基础设施还是聚合入口，并输出 JSON 数组。
`;

export class CandidateProfilingAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: CandidateProfilingInput,
  ): Promise<CandidateProfilingResult> {
    const systemPrompt = await loadPrompt(
      "candidate-profiling.md",
      FALLBACK_PROMPT,
    );
    const profiles: CandidateProfile[] = [];
    logger.info(
      `[CandidateProfiling] Started profiling ${input.candidateProfilesSeed.length} candidates`,
    );

    for (const [index, seed] of input.candidateProfilesSeed.entries()) {
      logger.info(
        `[CandidateProfiling] Progress ${index + 1}/${input.candidateProfilesSeed.length}: ${seed.candidateId}`,
      );
      profiles.push(
        await this.analyzeSeed(
          systemPrompt,
          seed,
          index,
          input.candidateProfilesSeed.length,
        ),
      );
    }

    logger.info(
      `[CandidateProfiling] Completed profiling ${profiles.length} candidates`,
    );
    return {
      profiles,
      success: true,
    };
  }

  async analyzeSeed(
    systemPrompt: string,
    seed: CandidateProfilingInput["candidateProfilesSeed"][number],
    index: number,
    total: number,
  ): Promise<CandidateProfile> {
    try {
      const response = await withLongTaskLogging(
        {
          taskName: `candidate profiling ${seed.candidateId}`,
          buildMessage: () =>
            `stage=candidate-profiling, progress=${index + 1}/${total}`,
        },
        () =>
          this.agent.invoke(
            {
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: buildInputMessage(seed),
                },
              ],
            },
            {
              recursionLimit: 40,
            },
          ),
      );

      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      return normalizeProfile(parseProfile(content), seed);
    } catch (error) {
      logger.warn(
        `Candidate profiling failed for ${seed.candidateId}: ${error}`,
      );
      return buildFallbackProfile(seed);
    }
  }
}

export function createCandidateProfilingAgent(
  repoPath: string,
): CandidateProfilingAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "candidate-profiling-agent",
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

  return new CandidateProfilingAgent(agent);
}

export async function loadCandidateProfilingPrompt(): Promise<string> {
  return loadPrompt("candidate-profiling.md", FALLBACK_PROMPT);
}

async function loadPrompt(fileName: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(PROMPTS_DIR, fileName), "utf-8");
  } catch (error) {
    logger.warn(`Failed to load ${fileName}, using fallback: ${error}`);
    return fallback;
  }
}

function buildInputMessage(
  seed: CandidateProfilingInput["candidateProfilesSeed"][number],
): string {
  return `
请对下面这个候选做定性判断，只输出一个 JSON 对象。

${JSON.stringify(seed, null, 2)}

输出格式：
{
  "profileType": "core-business | support-business | infrastructure | aggregator | ambiguous",
  "suggestedDomainName": "string",
  "businessTerms": ["..."],
  "mergeAffinityHints": ["candidate_xxx"],
  "excludeAffinityHints": ["candidate_xxx"],
  "riskFlags": ["..."],
  "reasoning": "string",
  "confidence": 0.0
}
`;
}

function parseProfile(content: string): Record<string, unknown> | undefined {
  const candidates = [
    content.match(/\{[\s\S]*\}/)?.[0],
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return undefined;
}

function normalizeProfile(
  parsed: Record<string, unknown> | undefined,
  seed: CandidateProfilingInput["candidateProfilesSeed"][number],
): CandidateProfile {
  if (!parsed) {
    return buildFallbackProfile(seed);
  }

  return {
    candidateId: seed.candidateId,
    profileType: normalizeProfileType(parsed.profileType),
    suggestedDomainName:
      typeof parsed.suggestedDomainName === "string" &&
      parsed.suggestedDomainName.trim()
        ? parsed.suggestedDomainName.trim()
        : seed.anchorTable,
    businessTerms: toStringArray(parsed.businessTerms),
    mergeAffinityHints: toStringArray(parsed.mergeAffinityHints),
    excludeAffinityHints: toStringArray(parsed.excludeAffinityHints),
    riskFlags: toStringArray(parsed.riskFlags),
    reasoning:
      typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : "模型未返回完整说明，已回退到保守画像",
    confidence:
      typeof parsed.confidence === "number" &&
      Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
  };
}

function buildFallbackProfile(
  seed: CandidateProfilingInput["candidateProfilesSeed"][number],
): CandidateProfile {
  const isLikelyAggregator =
    seed.relationSignals.length >= 4 &&
    seed.entryPointSummaries.length >= 3 &&
    seed.supportingTables.length > seed.coreTables.length;
  const isLikelyCore =
    seed.entryPointSummaries.length > 0 &&
    seed.coreTables.length >= 2 &&
    seed.relationSignals.length <= 2;

  return {
    candidateId: seed.candidateId,
    profileType: isLikelyAggregator
      ? "aggregator"
      : isLikelyCore
        ? "core-business"
        : "ambiguous",
    suggestedDomainName: seed.anchorTable,
    businessTerms: seed.businessTerms,
    mergeAffinityHints: seed.relationSignals
      .slice(0, 2)
      .map((signal) => signal.targetCandidateId),
    excludeAffinityHints: [],
    riskFlags: [
      isLikelyAggregator
        ? "fallback:structural-aggregator"
        : isLikelyCore
          ? "fallback:structural-core"
          : "fallback:ambiguous",
    ],
    reasoning: "画像阶段失败，已使用纯结构保守回退规则",
    confidence: 0.35,
  };
}

function normalizeProfileType(value: unknown): CandidateProfile["profileType"] {
  switch (value) {
    case "core-business":
    case "support-business":
    case "infrastructure":
    case "aggregator":
    case "ambiguous":
      return value;
    default:
      return "ambiguous";
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
