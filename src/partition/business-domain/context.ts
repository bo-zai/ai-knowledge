import type {
  DomainDefinition,
  DomainClusterInput,
  DomainPartition,
} from "../../partitioning/types.js";
import type {
  DomainAnalysisContext,
  DomainEvidenceBundle,
} from "../../domain-analysis/types.js";

export interface BusinessDomainStageContext {
  repoPath: string;
  clusterInput: DomainClusterInput;
  analysisContext: DomainAnalysisContext;
  concurrency: number;
  materializePartitions: (decisions: DomainDefinition[]) => DomainPartition[];
}

export interface BusinessDomainCrossDomainStageContext {
  repoPath: string;
  evidenceBundle?: DomainEvidenceBundle;
  decisions: DomainDefinition[];
  partitions: DomainPartition[];
}
