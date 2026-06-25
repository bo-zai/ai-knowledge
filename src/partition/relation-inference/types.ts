import type { EvidenceRef } from "../evidence/types.js";
import type { SubjectCandidate } from "../subject-discovery/types.js";

export type SubjectRelationEvidenceKind =
  | "explicit-fk"
  | "implicit-fk"
  | "sql-join"
  | "transaction-cohesion"
  | "naming-structure";

export type SubjectRelationKind =
  | "ownership"
  | "reference"
  | "shared-master-data"
  | "cohesion"
  | "weak-signal";

export type SubjectRelationStrength = "strong" | "medium" | "weak";

export interface SubjectRelationEvidence {
  kind: SubjectRelationEvidenceKind;
  summary: string;
  evidenceRefs: EvidenceRef[];
  score: number;
}

export interface SubjectRelation {
  relationId: string;
  sourceSubjectId: string;
  targetSubjectId: string;
  relationKind: SubjectRelationKind;
  strength: SubjectRelationStrength;
  sourceTables: string[];
  targetTables: string[];
  evidences: SubjectRelationEvidence[];
  totalScore: number;
  metadata: Record<string, unknown>;
}

export interface SubjectRelationGraph {
  subjects: Array<{
    subjectId: string;
    anchorTable: string;
  }>;
  relations: SubjectRelation[];
  metadata: Record<string, unknown>;
}

export interface SubjectRelationInferenceInput {
  subjects: SubjectCandidate[];
}
