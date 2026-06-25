import type {
  EvidenceAtom,
  EvidenceRef,
  EvidenceSubjectRef,
} from "../evidence/types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export interface SubjectEntrySurface {
  entryPointId: string;
  kind: string;
  className: string;
  methodName: string;
  moduleName: string;
  filePath: string;
  evidenceRefs: EvidenceRef[];
}

export interface SubjectTableCohesion {
  anchorTable: string;
  ownedTableNames: string[];
  dependencyTableNames: string[];
  relatedTableNames: string[];
  tableAccessCount: number;
  joinedTableNames: string[];
  writeTableNames: string[];
  readOnlyTableNames: string[];
  operationTypes: string[];
  evidenceRefs: EvidenceRef[];
}

export interface SubjectBehaviorCluster {
  serviceNames: string[];
  mapperNames: string[];
  moduleNames: string[];
  averageCallChainDepth: number;
  maxCallChainDepth: number;
  crossBoundaryHintCount: number;
  evidenceRefs: EvidenceRef[];
}

export interface SubjectCandidateAnchor {
  candidateId: string;
  anchorTable: string;
  anchorQuality: "high" | "medium" | "low";
}

export interface SubjectCandidate {
  subjectId: string;
  anchor: SubjectCandidateAnchor;
  entrySurface: SubjectEntrySurface[];
  tableCohesion: SubjectTableCohesion;
  behaviorCluster: SubjectBehaviorCluster;
  ownedArtifacts: EvidenceSubjectRef[];
  evidenceRefs: EvidenceRef[];
  uncertaintyFlags: string[];
  metadata: Record<string, unknown>;
}

export interface SubjectDiscoveryInput {
  clusterInput: DomainClusterInput;
  atoms: EvidenceAtom[];
}

export interface SubjectDiscoveryResult {
  candidates: SubjectCandidate[];
  metadata: Record<string, unknown>;
}
