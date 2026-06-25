import type { SubjectCandidate } from "../subject-discovery/types.js";
import type { SubjectRelation } from "./types.js";

export function inferNamingStructureRelations(
  subjects: SubjectCandidate[],
): SubjectRelation[] {
  const relations: SubjectRelation[] = [];

  for (let index = 0; index < subjects.length; index += 1) {
    for (
      let compareIndex = index + 1;
      compareIndex < subjects.length;
      compareIndex += 1
    ) {
      const left = subjects[index];
      const right = subjects[compareIndex];
      const leftTokens = splitTokens(left.anchor.anchorTable);
      const rightTokens = splitTokens(right.anchor.anchorTable);
      const sharedTokens = leftTokens.filter((token) =>
        rightTokens.includes(token),
      );

      if (sharedTokens.length < 2) {
        continue;
      }

      relations.push({
        relationId: `${left.subjectId}<->${right.subjectId}:naming`,
        sourceSubjectId: left.subjectId,
        targetSubjectId: right.subjectId,
        relationKind: "weak-signal",
        strength: "weak",
        sourceTables: [...left.tableCohesion.ownedTableNames],
        targetTables: [...right.tableCohesion.ownedTableNames],
        evidences: [
          {
            kind: "naming-structure",
            summary: `主体锚点存在共享命名结构: ${sharedTokens.join(", ")}`,
            evidenceRefs: [],
            score: 1,
          },
        ],
        totalScore: 1,
        metadata: {
          sharedTokens,
        },
      });
    }
  }

  return relations;
}

function splitTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[_\W]+/)
    .filter(Boolean);
}
