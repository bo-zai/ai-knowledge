import type { SubjectCandidate } from "../../subject-discovery/types.js";
import type { SubjectRelationGraph } from "../../relation-inference/types.js";
import type {
  SubjectRoleAdjudicationInput,
  SubjectRoleInputCandidate,
} from "./types.js";

export function buildSubjectRoleInput(params: {
  subjects: SubjectCandidate[];
  relationGraph: SubjectRelationGraph;
}): SubjectRoleAdjudicationInput {
  const { subjects, relationGraph } = params;
  const relationsBySubjectId = new Map<
    string,
    SubjectRelationGraph["relations"]
  >();

  for (const relation of relationGraph.relations) {
    const sourceRelations =
      relationsBySubjectId.get(relation.sourceSubjectId) ?? [];
    sourceRelations.push(relation);
    relationsBySubjectId.set(relation.sourceSubjectId, sourceRelations);

    const targetRelations =
      relationsBySubjectId.get(relation.targetSubjectId) ?? [];
    targetRelations.push(relation);
    relationsBySubjectId.set(relation.targetSubjectId, targetRelations);
  }

  return {
    candidates: subjects.map((subject) =>
      buildInputCandidate(
        subject,
        relationsBySubjectId.get(subject.subjectId) ?? [],
      ),
    ),
  };
}

function buildInputCandidate(
  subject: SubjectCandidate,
  relations: SubjectRelationGraph["relations"],
): SubjectRoleInputCandidate {
  return {
    subjectId: subject.subjectId,
    anchorTable: subject.anchor.anchorTable,
    anchorQuality: subject.anchor.anchorQuality,
    entryPoints: subject.entrySurface.map(
      (entryPoint) => `${entryPoint.className}.${entryPoint.methodName}`,
    ),
    ownedTables: subject.tableCohesion.ownedTableNames,
    dependencyTables: subject.tableCohesion.dependencyTableNames,
    relatedTables: subject.tableCohesion.relatedTableNames,
    joinedTables: subject.tableCohesion.joinedTableNames,
    writeTables: subject.tableCohesion.writeTableNames,
    readOnlyTables: subject.tableCohesion.readOnlyTableNames,
    services: subject.behaviorCluster.serviceNames,
    mappers: subject.behaviorCluster.mapperNames,
    uncertaintyFlags: subject.uncertaintyFlags,
    relatedSubjectSignals: relations.slice(0, 12).map((relation) => ({
      targetSubjectId:
        relation.sourceSubjectId === subject.subjectId
          ? relation.targetSubjectId
          : relation.sourceSubjectId,
      relationKind: relation.relationKind,
      strength: relation.strength,
      score: relation.totalScore,
      evidenceKinds: relation.evidences.map((evidence) => evidence.kind),
    })),
  };
}
