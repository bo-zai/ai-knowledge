export const EVIDENCE_SOURCE_KINDS = [
  "code",
  "sql",
  "schema",
  "git",
  "doc",
  "ddl",
  "db-instance",
] as const;

export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const EVIDENCE_ATOM_KINDS = [
  "entry-point",
  "service-call",
  "mapper-operation",
  "sql-statement",
  "table-access",
  "table-join",
  "transaction-cohesion",
  "schema-explicit-fk",
  "schema-implicit-fk",
  "schema-table-shape",
  "naming-structure",
  "module-membership",
  "commit-cochange",
  "doc-fragment",
  "ddl-fragment",
  "db-sample",
] as const;

export type EvidenceAtomKind = (typeof EVIDENCE_ATOM_KINDS)[number];

export const EVIDENCE_SUBJECT_KINDS = [
  "table",
  "service",
  "mapper",
  "entity",
  "entry-point",
  "module",
  "file",
  "sql-unit",
  "document",
  "schema-object",
] as const;

export type EvidenceSubjectKind = (typeof EVIDENCE_SUBJECT_KINDS)[number];

export interface EvidenceLocation {
  path: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export interface EvidenceSubjectRef {
  kind: EvidenceSubjectKind;
  id: string;
  name: string;
}

export interface EvidenceRef {
  evidenceId: string;
  atomKind: EvidenceAtomKind;
  sourceKind: EvidenceSourceKind;
}

export interface EvidenceAtom {
  id: string;
  atomKind: EvidenceAtomKind;
  sourceKind: EvidenceSourceKind;
  summary: string;
  subjects: EvidenceSubjectRef[];
  attributes: Record<string, unknown>;
  confidence: number;
  locations: EvidenceLocation[];
  tags?: string[];
}
