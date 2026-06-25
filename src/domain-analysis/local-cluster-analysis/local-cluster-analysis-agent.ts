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
  LocalClusterAnalysisInput,
  LocalClusterAnalysisResult,
  LocalClusterDomainDraft,
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");

const FALLBACK_PROMPT = `
# Local Cluster Domain Analysis Expert

你负责在局部候选簇内部识别业务域，不要处理全局命名统一问题。
`;

export class LocalClusterAnalysisAgent {
  constructor(private readonly agent: AgentRuntime) {}

  async analyze(
    input: LocalClusterAnalysisInput,
  ): Promise<LocalClusterAnalysisResult> {
    const prompt = await loadPrompt(
      "local-cluster-analysis.md",
      FALLBACK_PROMPT,
    );
    const profileMap = new Map(
      input.profiles.map((profile) => [profile.candidateId, profile]),
    );
    const candidateMap = new Map(
      input.evidenceBundle.candidates.map((candidate) => [
        candidate.candidateId,
        candidate,
      ]),
    );
    const drafts: LocalClusterDomainDraft[] = [];
    logger.info(
      `[LocalClusterAnalysis] Started analyzing ${input.clusters.length} clusters`,
    );

    for (const [index, cluster] of input.clusters.entries()) {
      logger.info(
        `[LocalClusterAnalysis] Progress ${index + 1}/${input.clusters.length}: ${cluster.clusterId} (${cluster.candidateIds.length} candidates)`,
      );
      drafts.push(
        ...(await this.analyzeCluster(
          prompt,
          cluster,
          candidateMap,
          profileMap,
          input,
          index,
          input.clusters.length,
        )),
      );
    }

    logger.info(
      `[LocalClusterAnalysis] Completed ${input.clusters.length} clusters, produced ${drafts.length} drafts`,
    );
    return {
      drafts,
      success: true,
    };
  }

  async analyzeCluster(
    prompt: string,
    cluster: LocalClusterAnalysisInput["clusters"][number],
    candidateMap: Map<
      string,
      LocalClusterAnalysisInput["evidenceBundle"]["candidates"][number]
    >,
    profileMap: Map<string, LocalClusterAnalysisInput["profiles"][number]>,
    input: LocalClusterAnalysisInput,
    index: number,
    total: number,
  ): Promise<LocalClusterDomainDraft[]> {
    const response = await withLongTaskLogging(
      {
        taskName: `local cluster analysis ${cluster.clusterId}`,
        buildMessage: () =>
          `stage=local-cluster-analysis, progress=${index + 1}/${total}, candidates=${cluster.candidateIds.length}`,
      },
      () =>
        this.agent.invoke(
          {
            messages: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: buildInputMessage(
                  cluster,
                  candidateMap,
                  profileMap,
                  input,
                ),
              },
            ],
          },
          {
            recursionLimit: 60,
          },
        ),
    );

    const lastMessage = response.messages[response.messages.length - 1];
    const content =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    return normalizeDrafts(parseDrafts(content), cluster.clusterId);
  }
}

export function createLocalClusterAnalysisAgent(
  repoPath: string,
): LocalClusterAnalysisAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "local-cluster-analysis-agent",
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

  return new LocalClusterAnalysisAgent(agent);
}

export async function loadLocalClusterAnalysisPrompt(): Promise<string> {
  return loadPrompt("local-cluster-analysis.md", FALLBACK_PROMPT);
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
  cluster: LocalClusterAnalysisInput["clusters"][number],
  candidateMap: Map<
    string,
    LocalClusterAnalysisInput["evidenceBundle"]["candidates"][number]
  >,
  profileMap: Map<string, LocalClusterAnalysisInput["profiles"][number]>,
  input: LocalClusterAnalysisInput,
): string {
  const candidates = cluster.candidateIds
    .map((candidateId) => candidateMap.get(candidateId))
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
      entryPoints: candidate.entryPoints.map(
        (entryPoint) =>
          `${entryPoint.kind}:${entryPoint.className}.${entryPoint.methodName}`,
      ),
      services: candidate.services.map((service) => service.className),
      mappers: candidate.mappers.map((mapper) => mapper.className),
      profile: profileMap.get(candidate.candidateId),
    }));

  const relations = input.evidenceBundle.candidateRelations.filter(
    (relation) =>
      cluster.candidateIds.includes(relation.candidateIdA) &&
      cluster.candidateIds.includes(relation.candidateIdB),
  );

  return `
请分析下面这个局部候选簇，输出 JSON 数组，每个元素表示一个局部业务域草案。

## cluster
${JSON.stringify(cluster, null, 2)}

## candidates
${JSON.stringify(candidates, null, 2)}

## internalRelations
${JSON.stringify(relations, null, 2)}

输出格式：
[
  {
    "domainName": "string",
    "coreCandidateIds": ["candidate_xxx"],
    "supportingCandidateIds": ["candidate_xxx"],
    "excludedCandidateIds": ["candidate_xxx"],
    "coreTables": ["..."],
    "supportingTables": ["..."],
    "reasoning": "string",
    "confidence": 0.0,
    "outboundDependencyHints": [
      {
        "targetDomainHint": "string",
        "relationType": "aggregate_dependency",
        "evidence": ["..."]
      }
    ]
  }
]
`;
}

function parseDrafts(content: string): unknown[] {
  const candidates = [
    content.match(/\[[\s\S]*\]/)?.[0],
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return [];
}

function normalizeDrafts(
  value: unknown[],
  clusterId: string,
): LocalClusterDomainDraft[] {
  if (value.length === 0) {
    return [];
  }

  return value.map((item, index) => {
    const record =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : {};

    return {
      clusterId,
      domainName:
        typeof record.domainName === "string" && record.domainName.trim()
          ? record.domainName.trim()
          : `${clusterId}_draft_${index + 1}`,
      coreCandidateIds: toStringArray(record.coreCandidateIds),
      supportingCandidateIds: toStringArray(record.supportingCandidateIds),
      excludedCandidateIds: toStringArray(record.excludedCandidateIds),
      coreTables: toStringArray(record.coreTables),
      supportingTables: toStringArray(record.supportingTables),
      reasoning:
        typeof record.reasoning === "string" && record.reasoning.trim()
          ? record.reasoning.trim()
          : "局部分析未返回完整说明",
      confidence:
        typeof record.confidence === "number" &&
        Number.isFinite(record.confidence)
          ? Math.max(0, Math.min(1, record.confidence))
          : 0.5,
      outboundDependencyHints: Array.isArray(record.outboundDependencyHints)
        ? (record.outboundDependencyHints.filter(
            (entry) => typeof entry === "object" && entry !== null,
          ) as LocalClusterDomainDraft["outboundDependencyHints"])
        : [],
    };
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
