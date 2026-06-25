import type { SubjectRelation, SubjectRelationEvidence } from "./types.js";
import type { SubjectCandidate } from "../subject-discovery/types.js";
import type { EvidenceAtom, EvidenceRef } from "../evidence/types.js";

export function inferExplicitForeignKeyRelations(
  subjects: SubjectCandidate[],
  atoms: EvidenceAtom[],
): SubjectRelation[] {
  const subjectByTable = buildSubjectByTable(subjects);
  const relationMap = new Map<string, SubjectRelation>();

  for (const atom of atoms) {
    if (atom.atomKind !== "schema-explicit-fk") {
      continue;
    }

    const sourceTable = getTableSubject(atom, 0);
    const targetTable = getTableSubject(atom, 1);
    if (!sourceTable || !targetTable) {
      continue;
    }

    const sourceSubject = subjectByTable.get(sourceTable);
    const targetSubject = subjectByTable.get(targetTable);
    if (
      !sourceSubject ||
      !targetSubject ||
      sourceSubject.subjectId === targetSubject.subjectId
    ) {
      continue;
    }

    upsertRelation(
      relationMap,
      sourceSubject,
      targetSubject,
      {
        kind: "explicit-fk",
        summary: `${sourceTable} -> ${targetTable} 存在显式外键`,
        evidenceRefs: [toEvidenceRef(atom)],
        score: 5,
      },
      "reference",
      "strong",
      { sourceTable, targetTable },
    );
  }

  return [...relationMap.values()];
}

function buildSubjectByTable(
  subjects: SubjectCandidate[],
): Map<string, SubjectCandidate> {
  const map = new Map<string, SubjectCandidate>();
  for (const subject of subjects) {
    for (const tableName of subject.tableCohesion.ownedTableNames) {
      map.set(tableName, subject);
    }
  }
  return map;
}

function getTableSubject(
  atom: EvidenceAtom,
  index: number,
): string | undefined {
  return atom.subjects.filter((subject) => subject.kind === "table")[index]?.id;
}

function toEvidenceRef(atom: EvidenceAtom): EvidenceRef {
  return {
    evidenceId: atom.id,
    atomKind: atom.atomKind,
    sourceKind: atom.sourceKind,
  };
}

function upsertRelation(
  relationMap: Map<string, SubjectRelation>,
  sourceSubject: SubjectCandidate,
  targetSubject: SubjectCandidate,
  evidence: SubjectRelationEvidence,
  relationKind: SubjectRelation["relationKind"],
  strength: SubjectRelation["strength"],
  metadata: Record<string, unknown>,
): void {
  const relationId = `${sourceSubject.subjectId}->${targetSubject.subjectId}`;
  const existing = relationMap.get(relationId);
  if (existing) {
    existing.evidences.push(evidence);
    existing.totalScore += evidence.score;
    return;
  }

  relationMap.set(relationId, {
    relationId,
    sourceSubjectId: sourceSubject.subjectId,
    targetSubjectId: targetSubject.subjectId,
    relationKind,
    strength,
    sourceTables: [...sourceSubject.tableCohesion.ownedTableNames],
    targetTables: [...targetSubject.tableCohesion.ownedTableNames],
    evidences: [evidence],
    totalScore: evidence.score,
    metadata,
  });
}
