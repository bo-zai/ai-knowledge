import {
  createAgentRuntime,
  type AgentRuntime,
} from "../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../config/defaults.js";
import { PromptLoader } from "../../shared/prompt-loader.js";
import { withLongTaskLogging } from "../../shared/long-task-logger.js";
import type {
  CrossDomainAnalysisInput,
  CrossDomainAnalysisResult,
} from "../types.js";
import { logger } from "../../shared/logger.js";

const CROSS_DOMAIN_FALLBACK_PROMPT = `
# 跨域关系分析专家

你负责在既有业务域之间识别真实的跨域依赖。只输出证据充分的跨域引用结果。
`;

export class CrossDomainAnalysisAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: CrossDomainAnalysisInput,
  ): Promise<CrossDomainAnalysisResult> {
    const dependencySignals = input.dependencySignals ?? [];
    if (dependencySignals.length === 0) {
      return {
        refsByPartitionId: {},
        success: true,
      };
    }

    try {
      const systemPrompt = await loadSystemPrompt();
      logger.info(
        `[CrossDomainAnalysis] Started with ${dependencySignals.length} dependency signals`,
      );
      const response = await withLongTaskLogging(
        {
          taskName: "cross-domain analysis",
          buildMessage: () =>
            `stage=cross-domain-analysis, dependencySignals=${dependencySignals.length}`,
        },
        () =>
          this.agent.invoke(
            {
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: buildInputMessage({ ...input, dependencySignals }),
                },
              ],
            },
            {
              recursionLimit: 80,
            },
          ),
      );

      const lastMessage = response.messages[response.messages.length - 1];
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      const parsed = parseResult(content);
      if (parsed) {
        logger.info(
          `[CrossDomainAnalysis] Completed with ${Object.keys(parsed.refsByPartitionId ?? {}).length} source partitions`,
        );
        return {
          refsByPartitionId: parsed.refsByPartitionId ?? {},
          success: true,
        };
      }

      logger.warn(
        "Cross-domain analysis returned no valid JSON, using fallback",
      );
      return buildFallbackResult({ ...input, dependencySignals });
    } catch (error) {
      logger.error("Cross-domain analysis failed:", error);
      return buildFallbackResult(
        { ...input, dependencySignals },
        String(error),
      );
    }
  }
}

export function createCrossDomainAnalysisAgent(
  repoPath: string,
): CrossDomainAnalysisAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "cross-domain-analysis-agent",
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
  return new CrossDomainAnalysisAgent(agent);
}

async function loadSystemPrompt(): Promise<string> {
  try {
    return PromptLoader.load("cross-domain-analysis").raw;
  } catch (error) {
    logger.warn(`Failed to load cross-domain prompt, using fallback: ${error}`);
    return CROSS_DOMAIN_FALLBACK_PROMPT;
  }
}

function buildInputMessage(input: CrossDomainAnalysisInput): string {
  const partitionSummaries = input.partitions.map((partition) => ({
    partitionId: partition.partitionId,
    primaryTables: partition.tables
      .filter((table) => table.role === "primary")
      .map((table) => table.tableName),
    allTables: partition.tables.map((table) => table.tableName),
    entryPoints: partition.entryPoints.map(
      (entryPoint) =>
        `${entryPoint.kind}:${entryPoint.className}.${entryPoint.methodName}`,
    ),
  }));

  return `
请分析已有业务域之间的跨域依赖，不要重新合并业务域。

## 已有业务域
${JSON.stringify(partitionSummaries, null, 2)}

## 业务域定义
${JSON.stringify(input.decisions, null, 2)}

## 候选跨域证据
${JSON.stringify(input.dependencySignals ?? [], null, 2)}

输出 JSON 对象，格式如下：
{
  "refsByPartitionId": {
    "sourcePartitionId": [
      {
        "targetDomain": "targetPartitionId",
        "relationType": "aggregate_dependency",
        "evidence": ["..."]
      }
    ]
  }
}
`;
}

function parseResult(content: string): CrossDomainAnalysisResult | undefined {
  const candidates = [
    content.match(/\{[\s\S]*\}/)?.[0],
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as CrossDomainAnalysisResult;
    } catch {
      continue;
    }
  }

  return undefined;
}

function buildFallbackResult(
  input: CrossDomainAnalysisInput,
  error?: string,
): CrossDomainAnalysisResult {
  const refsByPartitionId: CrossDomainAnalysisResult["refsByPartitionId"] = {};

  for (const signal of input.dependencySignals ?? []) {
    if (!hasStrongFallbackEvidence(signal.relationReasons)) {
      continue;
    }

    const relationType = inferFallbackRelationType(signal.relationReasons);
    const refs = refsByPartitionId[signal.sourcePartitionId] ?? [];
    refs.push({
      targetDomain: signal.targetPartitionId,
      relationType,
      evidence: signal.relationReasons.slice(0, 12),
    });
    refsByPartitionId[signal.sourcePartitionId] = dedupeRefs(refs);
  }

  return {
    refsByPartitionId,
    success: !error,
    error,
  };
}

function inferFallbackRelationType(
  reasons: string[],
): "aggregate_dependency" | "junction_dependency" | "weak_identity_reference" {
  if (reasons.some((reason) => reason.includes("junction_table"))) {
    return "junction_dependency";
  }
  if (
    reasons.some(
      (reason) =>
        reason.startsWith("schema:weak_reference") ||
        reason.startsWith("schema:implicit_fk"),
    )
  ) {
    return "weak_identity_reference";
  }
  return "aggregate_dependency";
}

function hasStrongFallbackEvidence(reasons: string[]): boolean {
  return reasons.some(
    (reason) =>
      reason.startsWith("fk:") ||
      reason.startsWith("sql-join:") ||
      reason.startsWith("schema:explicit_fk") ||
      reason.startsWith("schema:aggregate_child") ||
      reason.startsWith("schema:junction_table"),
  );
}

function dedupeRefs(
  refs: NonNullable<CrossDomainAnalysisResult["refsByPartitionId"][string]>,
): NonNullable<CrossDomainAnalysisResult["refsByPartitionId"][string]> {
  const deduped = new Map<string, (typeof refs)[number]>();
  for (const ref of refs) {
    const key = `${ref.targetDomain}:${ref.relationType}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, ref);
      continue;
    }
    existing.evidence = [
      ...new Set([...(existing.evidence ?? []), ...(ref.evidence ?? [])]),
    ].slice(0, 12);
  }
  return [...deduped.values()];
}
