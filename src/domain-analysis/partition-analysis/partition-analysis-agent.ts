import type { AgentRuntime } from "../../agent-runtime/runtime.js";
import { createAgentRuntime } from "../../agent-runtime/runtime.js";
import { createDomainClusterTools } from "../../agent-tools/domain-cluster-tools.js";
import { LLM_DEFAULTS } from "../../config/defaults.js";
import { createDomainClusterAgentSync } from "../../partitioning/domain-cluster-agent.js";
import type {
  PartitionAnalysisInput,
  PartitionAnalysisResult,
} from "../types.js";
import { logger } from "../../shared/logger.js";

export class PartitionAnalysisAgent {
  constructor(
    private readonly repoPath: string,
    private readonly agent: AgentRuntime,
  ) {}

  async analyze(
    input: PartitionAnalysisInput,
  ): Promise<PartitionAnalysisResult> {
    const clusterAgent = createDomainClusterAgentSync(
      this.repoPath,
      this.agent,
    );
    const result = await clusterAgent.analyze({
      ...input.clusterInput,
      analysisEvidence: input.partitionEvidence,
    });

    if (!result.success) {
      return {
        decisions: [],
        success: false,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        evidenceBundle: input.evidenceBundle,
      };
    }

    return {
      decisions: result.decisions,
      success: true,
      executionTimeMs: result.executionTimeMs,
      evidenceBundle: input.evidenceBundle,
    };
  }
}

export function createPartitionAnalysisAgent(
  repoPath: string,
): PartitionAnalysisAgent {
  const tools = createDomainClusterTools(repoPath);
  logger.info(`Created ${tools.length} partition analysis tools`);

  const agent = createAgentRuntime({
    model: {
      id: "partition-analysis-agent",
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

  return new PartitionAnalysisAgent(repoPath, agent);
}
