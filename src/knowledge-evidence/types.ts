import type { KnowledgeType } from "../schemas/knowledge-type.js";
import type { GenerateTarget } from "../knowledge/generate-scope.js";
import type { GraphStatus } from "../query/prepare-generation.js";
import type { ReadOnlyQueryExecutor } from "../engine/lbug/read-only-session.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";
import type { DomainPartition, PartitionIndex } from "../partitioning/types.js";

export type EvidenceSourceKind = "partition" | "graph" | "hybrid";

export interface KnowledgeEvidencePlanInput {
  repoPath: string;
  lbugPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  graphStatus: GraphStatus;
  executeQuery: ReadOnlyQueryExecutor;
  claimsProvider?: LlmClaimsProvider;
}

export interface PartitionEvidenceScope {
  partition: DomainPartition;
  partitionMode?: string;
  indexEntry?: PartitionIndex["partitions"][number];
  evidenceLocations: string[];
  evidenceNames: string[];
  hasConceptEvidence: boolean;
  hasCapabilityEvidence: boolean;
}

export interface PartitionEvidenceLoadResult {
  available: boolean;
  repoPath: string;
  partitionMode?: string;
  index?: PartitionIndex;
  scopes: PartitionEvidenceScope[];
  warnings: string[];
}

export interface PlannedEvidenceGroupsResult {
  groups: EvidenceGroup[];
  source: EvidenceSourceKind;
  warnings: string[];
}

export interface EvidencePlanArtifact {
  type: KnowledgeType;
  source: EvidenceSourceKind;
  partitionMode?: string;
  groupCount: number;
  warnings: string[];
  groups: Array<{
    groupId: string;
    packagePath: string;
    entryPointCount: number;
    behaviorCount: number;
    dataContractCount: number;
    moduleCount: number;
  }>;
}
