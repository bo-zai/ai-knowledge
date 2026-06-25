import type { SubjectCandidate } from "../subject-discovery/types.js";
import type { SubjectRelation } from "./types.js";

export function inferImplicitForeignKeyRelations(
  subjects: SubjectCandidate[],
): SubjectRelation[] {
  const relations: SubjectRelation[] = [];

  for (const sourceSubject of subjects) {
    for (const targetSubject of subjects) {
      if (sourceSubject.subjectId === targetSubject.subjectId) {
        continue;
      }

      const sharedRelatedTables =
        sourceSubject.tableCohesion.relatedTableNames.filter((tableName) =>
          targetSubject.tableCohesion.ownedTableNames.includes(tableName),
        );
      if (sharedRelatedTables.length === 0) {
        continue;
      }

      relations.push({
        relationId: `${sourceSubject.subjectId}->${targetSubject.subjectId}:implicit`,
        sourceSubjectId: sourceSubject.subjectId,
        targetSubjectId: targetSubject.subjectId,
        relationKind: "reference",
        strength: "medium",
        sourceTables: [...sourceSubject.tableCohesion.ownedTableNames],
        targetTables: [...targetSubject.tableCohesion.ownedTableNames],
        evidences: [
          {
            kind: "implicit-fk",
            summary: `候选关联表命中目标主体拥有表: ${sharedRelatedTables.join(", ")}`,
            evidenceRefs: [...sourceSubject.tableCohesion.evidenceRefs],
            score: Math.min(4, sharedRelatedTables.length + 1),
          },
        ],
        totalScore: Math.min(4, sharedRelatedTables.length + 1),
        metadata: {
          sharedRelatedTables,
        },
      });
    }
  }

  return relations;
}
