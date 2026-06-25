import type {
  DomainAnalysisContext,
  DomainEvidenceBundle,
} from "../../domain-analysis/types.js";
import type {
  CandidateGroup,
  CandidateRelation,
  SchemaRelationGraph,
} from "../../partitioning/types.js";
import type {
  EvidenceAtom,
  EvidenceAtomKind,
  EvidenceLocation,
  EvidenceRef,
  EvidenceSourceKind,
  EvidenceSubjectKind,
  EvidenceSubjectRef,
} from "./evidence-atom.js";
import type {
  EvidenceBundleContainer,
  EvidenceBundleSelection,
  EvidenceBundleSourceSummary,
  EvidenceBundleStats,
  EvidenceBundleView,
} from "./evidence-bundle.js";

export type {
  EvidenceAtom,
  EvidenceAtomKind,
  EvidenceLocation,
  EvidenceRef,
  EvidenceSourceKind,
  EvidenceSubjectKind,
  EvidenceSubjectRef,
} from "./evidence-atom.js";

export type {
  EvidenceBundleContainer,
  EvidenceBundleSelection,
  EvidenceBundleSourceSummary,
  EvidenceBundleStats,
  EvidenceBundleView,
} from "./evidence-bundle.js";

export interface LegacyDomainEvidenceBridge {
  legacyBundle: DomainEvidenceBundle;
  canonicalBundle: EvidenceBundleContainer;
}

export interface EvidenceCollectionContext {
  repoPath: string;
  analysisContext?: DomainAnalysisContext;
  metadata?: Record<string, unknown>;
}

export interface EvidenceBundleBridgeInput {
  context: DomainAnalysisContext;
  canonicalBundle: EvidenceBundleContainer;
  candidateRelations?: CandidateRelation[];
  candidateGroups?: CandidateGroup[];
  schemaRelationGraph?: SchemaRelationGraph;
}

export interface EvidenceBridgeResult {
  canonicalBundle: EvidenceBundleContainer;
  legacyBundle?: DomainEvidenceBundle;
}
