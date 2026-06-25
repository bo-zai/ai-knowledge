import { runCrossDomainAnalysis } from "../../domain-analysis/cross-domain-analysis/run-cross-domain-analysis.js";
import { runPartitionAnalysis } from "../../domain-analysis/partition-analysis/run-partition-analysis.js";
import type { DomainPartition } from "../../partitioning/types.js";
import type {
  BusinessDomainCrossDomainStageContext,
  BusinessDomainStageContext,
} from "./context.js";
import type {
  BusinessDomainPartitionInput,
  BusinessDomainPartitionResult,
  BusinessDomainStageResult,
} from "./types.js";

/**
 * 统一封装 business-domain 主流水线入口，便于后续替换内部阶段实现。
 */
export async function runBusinessDomainPartition(
  input: BusinessDomainPartitionInput,
): Promise<BusinessDomainPartitionResult> {
  const stageContext = createBusinessDomainStageContext(input);
  const stageResult = await runBusinessDomainPartitionStage(stageContext);

  if (
    !stageResult.partitionResult.success ||
    stageResult.partitionResult.decisions.length === 0 ||
    !stageResult.partitions
  ) {
    return stageResult.partitionResult;
  }

  const refsByPartitionId = await runBusinessDomainCrossDomainStage({
    repoPath: stageContext.repoPath,
    evidenceBundle: stageResult.evidenceBundle,
    decisions: stageResult.partitionResult.decisions,
    partitions: stageResult.partitions,
  });

  return {
    ...stageResult.partitionResult,
    refsByPartitionId,
  };
}

function createBusinessDomainStageContext(
  input: BusinessDomainPartitionInput,
): BusinessDomainStageContext {
  return {
    repoPath: input.repoPath,
    clusterInput: input.clusterInput,
    analysisContext: input.analysisContext,
    concurrency: input.concurrency,
    materializePartitions: input.materializePartitions,
  };
}

async function runBusinessDomainPartitionStage(
  context: BusinessDomainStageContext,
): Promise<BusinessDomainStageResult> {
  const partitionResult = await runPartitionAnalysis(
    context.clusterInput,
    context.analysisContext,
    context.concurrency,
  );

  if (!partitionResult.success || partitionResult.decisions.length === 0) {
    return {
      partitionResult,
    };
  }

  return {
    partitionResult,
    partitions: context.materializePartitions(partitionResult.decisions),
    evidenceBundle: partitionResult.evidenceBundle,
  };
}

async function runBusinessDomainCrossDomainStage(
  context: BusinessDomainCrossDomainStageContext,
): Promise<Record<string, DomainPartition["crossDomainRefs"]> | undefined> {
  if (!context.evidenceBundle) {
    return undefined;
  }

  const crossDomainResult = await runCrossDomainAnalysis(context.repoPath, {
    evidenceBundle: context.evidenceBundle,
    decisions: context.decisions,
    partitions: context.partitions,
  });

  return crossDomainResult.refsByPartitionId;
}
