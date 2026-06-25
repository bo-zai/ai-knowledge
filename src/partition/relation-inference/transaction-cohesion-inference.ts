import type { SubjectCandidate } from "../subject-discovery/types.js";
import type { SubjectRelation } from "./types.js";

export function inferTransactionCohesionRelations(
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
      const sharedServices = left.behaviorCluster.serviceNames.filter(
        (serviceName) =>
          right.behaviorCluster.serviceNames.includes(serviceName),
      );
      const sharedMappers = left.behaviorCluster.mapperNames.filter(
        (mapperName) => right.behaviorCluster.mapperNames.includes(mapperName),
      );
      const sharedRelatedTables = left.tableCohesion.relatedTableNames.filter(
        (tableName) =>
          right.tableCohesion.relatedTableNames.includes(tableName),
      );

      if (
        sharedServices.length === 0 &&
        sharedMappers.length === 0 &&
        sharedRelatedTables.length === 0
      ) {
        continue;
      }

      const score = Math.min(
        3,
        sharedServices.length +
          sharedMappers.length +
          sharedRelatedTables.length,
      );
      relations.push({
        relationId: `${left.subjectId}<->${right.subjectId}:cohesion`,
        sourceSubjectId: left.subjectId,
        targetSubjectId: right.subjectId,
        relationKind: "cohesion",
        strength: score >= 3 ? "medium" : "weak",
        sourceTables: [...left.tableCohesion.ownedTableNames],
        targetTables: [...right.tableCohesion.ownedTableNames],
        evidences: [
          {
            kind: "transaction-cohesion",
            summary: `共享服务/Mapper/关联表: 服务[${sharedServices.join(", ")}] Mapper[${sharedMappers.join(", ")}] 关联表[${sharedRelatedTables.join(", ")}]`,
            evidenceRefs: [
              ...left.behaviorCluster.evidenceRefs,
              ...right.behaviorCluster.evidenceRefs,
            ],
            score,
          },
        ],
        totalScore: score,
        metadata: {
          sharedServices,
          sharedMappers,
          sharedRelatedTables,
        },
      });
    }
  }

  return relations;
}
