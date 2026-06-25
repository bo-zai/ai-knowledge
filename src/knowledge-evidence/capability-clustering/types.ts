import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";

export interface CapabilityClusterScores {
  businessCore: number;
  navigationNeed: number;
  changeActivity: number;
}

export interface CapabilityClusterEvidenceReason {
  kind:
    | "shared_action"
    | "shared_object"
    | "shared_entry"
    | "shared_table"
    | "engineering_signal";
  summary: string;
}

export interface FlowCandidate {
  id: string;
  name: string;
  primaryCapabilityId: string;
  entryRefs: string[];
  behaviorRefs: string[];
  contractRefs: string[];
  moduleRefs: string[];
  isWrite: boolean;
  hasStateTransition: boolean;
  scores: CapabilityClusterScores;
}

export interface CapabilityCluster {
  id: string;
  nameCandidates: string[];
  domainKey: string;
  domainName: string;
  primaryEntryRefs: string[];
  supportingEntryRefs: string[];
  behaviorRefs: string[];
  contractRefs: string[];
  moduleRefs: string[];
  functionCandidateIds: string[];
  flowCandidateIds: string[];
  scores: CapabilityClusterScores;
  reasons: CapabilityClusterEvidenceReason[];
  evidenceBundle: EvidenceBundle;
}

export interface DomainCapabilityClusteringResult {
  domainKey: string;
  domainName: string;
  partitionId: string;
  sourceBundleId: string;
  capabilities: CapabilityCluster[];
  flows: FlowCandidate[];
  warnings: string[];
}

export interface CapabilityClusteringResult {
  generatedAt: string;
  domains: DomainCapabilityClusteringResult[];
  warnings: string[];
}
