import type {
  DomainDefinition,
  DomainClusterInput,
  DomainPartition,
} from "../../partitioning/types.js";
import type {
  DomainAnalysisContext,
  DomainEvidenceBundle,
  PartitionAnalysisResult,
} from "../../domain-analysis/types.js";

export interface BusinessDomainPartitionInput {
  repoPath: string;
  clusterInput: DomainClusterInput;
  analysisContext: DomainAnalysisContext;
  concurrency: number;
  materializePartitions: (decisions: DomainDefinition[]) => DomainPartition[];
}

export interface BusinessDomainPartitionResult extends PartitionAnalysisResult {
  refsByPartitionId?: Record<string, DomainPartition["crossDomainRefs"]>;
}

export interface BusinessDomainStageResult {
  partitionResult: PartitionAnalysisResult;
  partitions?: DomainPartition[];
  evidenceBundle?: DomainEvidenceBundle;
}
