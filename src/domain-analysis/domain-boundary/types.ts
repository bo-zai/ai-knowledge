import type {
  DomainDefinition,
  PartitionCandidate,
} from "../../partitioning/types.js";

export type BoundaryCandidateRole =
  | "core"
  | "support"
  | "reference"
  | "excluded";

export interface BoundaryCandidateDecision {
  candidateId: string;
  anchorTable: string;
  role: BoundaryCandidateRole;
  domainKey?: string;
  parentCandidateId?: string;
  reasons: string[];
}

export interface DomainBoundaryPlan {
  candidateDecisions: BoundaryCandidateDecision[];
  domainDrafts: DomainDefinition[];
  conflicts: string[];
}

export interface DomainBoundaryFinalResult {
  decisions: DomainDefinition[];
  conflicts: string[];
}

export interface BoundaryCandidateIndex {
  candidate: PartitionCandidate;
  classificationType?: string;
  classificationConfidence?: number;
  suggestedDomainName?: string;
}
