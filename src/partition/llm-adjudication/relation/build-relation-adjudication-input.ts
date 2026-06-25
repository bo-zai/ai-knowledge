import type { SubjectRelationGraph } from "../../relation-inference/types.js";
import type { RelationAdjudicationInput } from "./types.js";

export function buildRelationAdjudicationInput(
  relationGraph: SubjectRelationGraph,
): RelationAdjudicationInput {
  return {
    relations: relationGraph.relations.map((relation) => ({
      relationId: relation.relationId,
      sourceSubjectId: relation.sourceSubjectId,
      targetSubjectId: relation.targetSubjectId,
      inferredKind: relation.relationKind,
      inferredStrength: relation.strength,
      score: relation.totalScore,
      sourceTables: relation.sourceTables,
      targetTables: relation.targetTables,
      evidenceSummaries: relation.evidences.map((evidence) => evidence.summary),
    })),
  };
}
