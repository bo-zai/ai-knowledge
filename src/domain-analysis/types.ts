import type {
  CandidateGroup,
  CandidateRelation,
  CommitHistoryInfo,
  CrossDomainRef,
  CrossDomainRelationType,
  DomainClusterInput,
  DomainDefinition,
  DomainPartition,
  PartitionAnalysisEvidence,
  PartitionCandidate,
  ProjectContext,
  SchemaRelationGraph,
} from "../partitioning/types.js";
import type {
  EvidenceBundleContainer,
  EvidenceRef,
} from "../partition/evidence/types.js";
import type { SubjectDiscoveryResult } from "../partition/subject-discovery/types.js";
import type { SubjectRelationGraph } from "../partition/relation-inference/types.js";
import type { RelationAdjudicationOutput } from "../partition/llm-adjudication/relation/types.js";
import type { DomainAssemblyOutput } from "../partition/llm-adjudication/domain-assembly/types.js";

export interface DomainAnalysisContext {
  repoPath: string;
  projectContext: ProjectContext;
  commitHistory?: CommitHistoryInfo;
}

export interface CandidateEvidenceBundle {
  candidate: PartitionCandidate;
  relatedRelations: CandidateRelation[];
}

export interface DomainDependencyMatrixEntry {
  sourceCandidateId: string;
  targetCandidateId: string;
  relationReasons: string[];
  relationScore: number;
}

export interface DomainEvidenceBundle {
  context: DomainAnalysisContext;
  candidates: PartitionCandidate[];
  candidateRelations: CandidateRelation[];
  candidateGroups: CandidateGroup[];
  schemaRelationGraph: SchemaRelationGraph;
  candidateEvidenceBundles: CandidateEvidenceBundle[];
  dependencyMatrix: DomainDependencyMatrixEntry[];
  sourceDependencyMatrix?: Record<string, DomainDependencyMatrixEntry[]>;
}

/**
 * 兼容期保留旧证据结构，同时为新证据模型提供挂载点。
 */
export interface CanonicalEvidenceBridge {
  canonicalBundle: EvidenceBundleContainer;
  evidenceRefsByCandidateId?: Record<string, EvidenceRef[]>;
}

export interface PartitionAnalysisInput {
  clusterInput: DomainClusterInput;
  evidenceBundle: DomainEvidenceBundle;
  partitionEvidence: PartitionAnalysisEvidence;
}

export type SubjectCandidateType =
  | "business-root"
  | "business-support"
  | "cross-domain-reference"
  | "noise-or-aggregation";

export interface SubjectCandidateClassification {
  candidateId: string;
  subjectType: SubjectCandidateType;
  suggestedDomainName: string;
  businessTerms: string[];
  ownedTableHints: string[];
  dependencyTableHints: string[];
  riskFlags: string[];
  reasoning: string;
  confidence: number;
}

export interface SubjectCandidateAnalysisInput {
  evidenceBundle: DomainEvidenceBundle;
  candidates: Array<{
    candidateId: string;
    anchorTable: string;
    anchorQuality: string;
    entryPointSummaries: string[];
    ownedTables: string[];
    coreTables: string[];
    supportingTables: string[];
    dependencyTables: string[];
    businessTerms: string[];
    relationSignals: Array<{
      targetCandidateId: string;
      relationScore: number;
      relationReasons: string[];
    }>;
    commitHighlights: string[];
  }>;
}

export interface SubjectCandidateAnalysisResult {
  classifications: SubjectCandidateClassification[];
  success: boolean;
  error?: string;
}

export interface SchemaRelationGrade {
  sourceTable: string;
  targetTable: string;
  grade: "strong-same-domain" | "weak-dependency" | "noise";
  relationType: string;
  strength: string;
  evidence: string[];
}

export interface DomainAnalysisInput {
  evidenceBundle: DomainEvidenceBundle;
  subjectClassifications: SubjectCandidateClassification[];
  rootCandidates: string[];
  supportCandidates: string[];
  referenceCandidates: string[];
  excludedCandidates: string[];
  schemaRelationGrades: SchemaRelationGrade[];
  dependencySignals: DomainDependencyMatrixEntry[];
  relationDecisions?: RelationAdjudicationOutput["decisions"];
  exclusionRules: string[];
}

export interface DomainAnalysisResult {
  decisions: DomainDefinition[];
  success: boolean;
  error?: string;
  rawResponse?: string;
}

export interface StructuralValidationResult {
  decisions: DomainDefinition[];
  warnings: string[];
}

export type CandidateProfileType =
  | "core-business"
  | "support-business"
  | "infrastructure"
  | "aggregator"
  | "ambiguous";

export interface CandidateBoundarySignal {
  targetCandidateId: string;
  relationScore: number;
  relationReasons: string[];
}

export interface CandidateProfile {
  candidateId: string;
  profileType: CandidateProfileType;
  suggestedDomainName: string;
  businessTerms: string[];
  mergeAffinityHints: string[];
  excludeAffinityHints: string[];
  riskFlags: string[];
  reasoning: string;
  confidence: number;
}

export interface CandidateProfilingInput {
  evidenceBundle: DomainEvidenceBundle;
  candidateProfilesSeed: Array<{
    candidateId: string;
    anchorTable: string;
    ownedTables: string[];
    coreTables: string[];
    supportingTables: string[];
    dependencyTables: string[];
    entryPointSummaries: string[];
    relationSignals: CandidateBoundarySignal[];
    commitHighlights: string[];
    businessTerms: string[];
  }>;
}

export interface CandidateProfilingResult {
  profiles: CandidateProfile[];
  success: boolean;
  error?: string;
}

export interface LocalAnalysisClusterBoundary {
  targetClusterId: string;
  relatedCandidateIds: string[];
  relationScore: number;
  relationReasons: string[];
}

export interface LocalAnalysisCluster {
  clusterId: string;
  candidateIds: string[];
  boundarySignals: LocalAnalysisClusterBoundary[];
  clusterReason: string;
}

export interface LocalClusterAnalysisInput {
  evidenceBundle: DomainEvidenceBundle;
  profiles: CandidateProfile[];
  clusters: LocalAnalysisCluster[];
}

export interface LocalClusterDomainDraft {
  clusterId: string;
  domainName: string;
  coreCandidateIds: string[];
  supportingCandidateIds: string[];
  excludedCandidateIds: string[];
  coreTables: string[];
  supportingTables: string[];
  reasoning: string;
  confidence: number;
  outboundDependencyHints: DomainDefinition["crossDomainDependencies"];
}

export interface LocalClusterAnalysisResult {
  clusters?: LocalAnalysisCluster[];
  drafts: LocalClusterDomainDraft[];
  success: boolean;
  error?: string;
}

export interface GlobalReconciliationInput {
  evidenceBundle: DomainEvidenceBundle;
  profiles: CandidateProfile[];
  clusters: LocalAnalysisCluster[];
  localDrafts: LocalClusterDomainDraft[];
}

export interface GlobalReconciliationResult {
  decisions: DomainDefinition[];
  success: boolean;
  error?: string;
  executionTimeMs?: number;
}

export interface PartitionAnalysisResult {
  decisions: DomainDefinition[];
  success: boolean;
  error?: string;
  executionTimeMs?: number;
  evidenceBundle?: DomainEvidenceBundle;
  canonicalEvidenceBundle?: EvidenceBundleContainer;
  subjectDiscoveryResult?: SubjectDiscoveryResult;
  subjectRelationGraph?: SubjectRelationGraph;
  subjectCandidateResult?: SubjectCandidateAnalysisResult;
  relationAdjudicationResult?: RelationAdjudicationOutput;
  domainAssemblyResult?: DomainAssemblyOutput;
  mainAnalysisInput?: DomainAnalysisInput;
  mainAnalysisResult?: DomainAnalysisResult;
  structuralValidationResult?: StructuralValidationResult;
  profilingResult?: CandidateProfilingResult;
  localClusterResult?: LocalClusterAnalysisResult;
  globalReconciliationResult?: GlobalReconciliationResult;
}

export interface CrossDomainAnalysisInput {
  evidenceBundle: DomainEvidenceBundle;
  decisions: DomainDefinition[];
  partitions: DomainPartition[];
  dependencySignals?: CrossDomainDependencySignal[];
}

export interface CrossDomainAnalysisResult {
  refsByPartitionId: Record<string, CrossDomainRef[]>;
  success: boolean;
  error?: string;
}

export interface CrossDomainDependencySignal {
  sourcePartitionId: string;
  sourceDomainName: string;
  sourceTables: string[];
  targetPartitionId: string;
  targetDomainName: string;
  targetTables: string[];
  relationScore: number;
  relationReasons: string[];
  suggestedRelationType?: CrossDomainRelationType;
}
