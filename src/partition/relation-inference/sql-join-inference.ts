import type { SubjectCandidate } from "../subject-discovery/types.js";
import type { SubjectRelation } from "./types.js";

export function inferSqlJoinRelations(
  subjects: SubjectCandidate[],
): SubjectRelation[] {
  const relations: SubjectRelation[] = [];

  for (const sourceSubject of subjects) {
    const joinedTargets = sourceSubject.tableCohesion.joinedTableNames;
    if (joinedTargets.length === 0) {
      continue;
    }

    for (const targetSubject of subjects) {
      if (sourceSubject.subjectId === targetSubject.subjectId) {
        continue;
      }

      const matchedTables = joinedTargets.filter((tableName) =>
        targetSubject.tableCohesion.ownedTableNames.includes(tableName),
      );
      if (matchedTables.length === 0) {
        continue;
      }

      relations.push({
        relationId: `${sourceSubject.subjectId}->${targetSubject.subjectId}:join`,
        sourceSubjectId: sourceSubject.subjectId,
        targetSubjectId: targetSubject.subjectId,
        relationKind: "reference",
        strength: "medium",
        sourceTables: [...sourceSubject.tableCohesion.ownedTableNames],
        targetTables: [...targetSubject.tableCohesion.ownedTableNames],
        evidences: [
          {
            kind: "sql-join",
            summary: `SQL join 命中目标主体表: ${matchedTables.join(", ")}`,
            evidenceRefs: [...sourceSubject.tableCohesion.evidenceRefs],
            score: Math.min(4, matchedTables.length + 1),
          },
        ],
        totalScore: Math.min(4, matchedTables.length + 1),
        metadata: {
          matchedTables,
        },
      });
    }
  }

  return relations;
}
