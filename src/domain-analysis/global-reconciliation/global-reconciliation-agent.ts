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
  GlobalReconciliationInput,
  GlobalReconciliationResult,
} from "../types.js";
import type { DomainDefinition } from "../../partitioning/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");

const FALLBACK_PROMPT = `
# Global Domain Reconciliation Expert

你负责把局部业务域草案收敛成最终业务域定义，统一命名并消除冲突。
`;

export class GlobalReconciliationAgent {
  constructor(
    private readonly agent: AgentRuntime,
    private readonly repoPath: string,
  ) {}

  async analyze(
    input: GlobalReconciliationInput,
  ): Promise<GlobalReconciliationResult> {
    const prompt = await loadPrompt(
      "global-reconciliation.md",
      FALLBACK_PROMPT,
    );
    const startedAt = Date.now();
    logger.info(
      `[GlobalReconciliation] Started with ${input.localDrafts.length} local drafts and ${input.profiles.length} profiles`,
    );
    const response = await withLongTaskLogging(
      {
        taskName: "global reconciliation",
        buildMessage: () =>
          `stage=global-reconciliation, localDrafts=${input.localDrafts.length}, profiles=${input.profiles.length}`,
      },
      () =>
        this.agent.invoke(
          {
            messages: [
              { role: "system", content: prompt },
              {
                role: "user",
                content: buildInputMessage(input),
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

    const result = {
      decisions: await parseDecisions(content, this.repoPath),
      success: true,
      executionTimeMs: Date.now() - startedAt,
    };
    logger.info(
      `[GlobalReconciliation] Completed with ${result.decisions.length} final decisions`,
    );
    return result;
  }
}

export function createGlobalReconciliationAgent(
  repoPath: string,
): GlobalReconciliationAgent {
  const tools = createDomainClusterTools(repoPath);
  const agent = createAgentRuntime({
    model: {
      id: "global-reconciliation-agent",
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

  return new GlobalReconciliationAgent(agent, repoPath);
}

async function loadPrompt(fileName: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(PROMPTS_DIR, fileName), "utf-8");
  } catch (error) {
    logger.warn(`Failed to load ${fileName}, using fallback: ${error}`);
    return fallback;
  }
}

function buildInputMessage(input: GlobalReconciliationInput): string {
  const candidateSummaries = input.evidenceBundle.candidates.map(
    (candidate) => ({
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
    }),
  );

  return `
请把下面的局部业务域草案收敛为最终业务域定义，输出 JSON 数组。

## candidateProfiles
${JSON.stringify(input.profiles, null, 2)}

## localClusters
${JSON.stringify(input.clusters, null, 2)}

## localDrafts
${JSON.stringify(input.localDrafts, null, 2)}

## candidateSummaries
${JSON.stringify(candidateSummaries, null, 2)}

## dependencyMatrix
${JSON.stringify(input.evidenceBundle.dependencyMatrix.slice(0, 200), null, 2)}

输出格式：
[
  {
    "domainName": "string",
    "confidence": 0.0,
    "coreCandidateIds": ["candidate_xxx"],
    "supportingCandidateIds": ["candidate_xxx"],
    "excludedCandidateIds": ["candidate_xxx"],
    "coreTables": ["..."],
    "supportingTables": ["..."],
    "crossDomainDependencies": [
      {
        "targetDomainHint": "string",
        "relationType": "aggregate_dependency",
        "evidence": ["..."]
      }
    ],
    "reasoning": "string"
  }
]
`;
}

async function parseDecisions(
  content: string,
  workspacePath: string,
): Promise<DomainDefinition[]> {
  const candidates = [
    content.match(/\[[\s\S]*\]/)?.[0],
    content.match(/```json\s*([\s\S]*?)\s*```/)?.[1],
    content.match(/```\s*([\s\S]*?)\s*```/)?.[1],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as DomainDefinition[];
      }
    } catch {
      continue;
    }
  }

  const filePath = extractWrittenJsonPath(content, workspacePath);
  if (!filePath) {
    return [];
  }

  try {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(fileContent) as unknown;
    return Array.isArray(parsed) ? (parsed as DomainDefinition[]) : [];
  } catch {
    return [];
  }
}

function extractWrittenJsonPath(
  content: string,
  workspacePath: string,
): string | undefined {
  const normalizedWorkspacePath = workspacePath.replace(/\\/g, "/");
  const pathCandidates = [
    ...content.matchAll(/[A-Za-z]:[\\/][^\s"'`]+?\.json/gu),
    ...content.matchAll(/(?:\.\/|output\/)[^\s"'`]+?\.json/gu),
  ]
    .map((match) => match[0])
    .map((value) => value.replace(/\\/g, "/"));

  for (const candidate of pathCandidates) {
    if (candidate.startsWith("./")) {
      return path.join(workspacePath, candidate.slice(2));
    }

    if (candidate.startsWith("output/")) {
      return path.join(workspacePath, candidate);
    }

    if (candidate.startsWith(normalizedWorkspacePath)) {
      return candidate;
    }
  }

  return [];
}
