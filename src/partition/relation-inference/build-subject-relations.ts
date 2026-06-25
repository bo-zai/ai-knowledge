import type { EvidenceAtom } from "../evidence/types.js";
import type { SubjectCandidate } from "../subject-discovery/types.js";
import { inferExplicitForeignKeyRelations } from "./explicit-fk-inference.js";
import { inferImplicitForeignKeyRelations } from "./implicit-fk-inference.js";
import { inferNamingStructureRelations } from "./naming-structure-inference.js";
import { inferSqlJoinRelations } from "./sql-join-inference.js";
import { inferTransactionCohesionRelations } from "./transaction-cohesion-inference.js";
import type { SubjectRelation, SubjectRelationGraph } from "./types.js";

export function buildSubjectRelationGraph(
  subjects: SubjectCandidate[],
  atoms: EvidenceAtom[],
): SubjectRelationGraph {
  const mergedRelations = mergeRelations([
    ...inferExplicitForeignKeyRelations(subjects, atoms),
    ...inferImplicitForeignKeyRelations(subjects),
    ...inferSqlJoinRelations(subjects),
    ...inferTransactionCohesionRelations(subjects),
    ...inferNamingStructureRelations(subjects),
  ]);

  return {
    subjects: subjects.map((subject) => ({
      subjectId: subject.subjectId,
      anchorTable: subject.anchor.anchorTable,
    })),
    relations: mergedRelations,
    metadata: {
      subjectCount: subjects.length,
      relationCount: mergedRelations.length,
    },
  };
}

function mergeRelations(relations: SubjectRelation[]): SubjectRelation[] {
  const relationMap = new Map<string, SubjectRelation>();

  for (const relation of relations) {
    const relationKey = `${relation.sourceSubjectId}->${relation.targetSubjectId}`;
    const existing = relationMap.get(relationKey);
    if (!existing) {
      relationMap.set(relationKey, {
        ...relation,
        evidences: [...relation.evidences],
      });
      continue;
    }

    existing.evidences.push(...relation.evidences);
    existing.totalScore += relation.totalScore;
    existing.relationKind = pickRelationKind(
      existing.relationKind,
      relation.relationKind,
    );
    existing.strength = pickStrength(existing.totalScore);
    existing.metadata = {
      ...existing.metadata,
      ...relation.metadata,
    };
  }

  return [...relationMap.values()]
    .map((relation) => ({
      ...relation,
      strength: pickStrength(relation.totalScore),
      evidences: relation.evidences.sort((left, right) =>
        left.kind.localeCompare(right.kind),
      ),
    }))
    .sort((left, right) => left.relationId.localeCompare(right.relationId));
}

function pickRelationKind(
  left: SubjectRelation["relationKind"],
  right: SubjectRelation["relationKind"],
): SubjectRelation["relationKind"] {
  const priority: SubjectRelation["relationKind"][] = [
    "ownership",
    "reference",
    "shared-master-data",
    "cohesion",
    "weak-signal",
  ];
  return priority.indexOf(left) <= priority.indexOf(right) ? left : right;
}

function pickStrength(score: number): SubjectRelation["strength"] {
  if (score >= 5) {
    return "strong";
  }
  if (score >= 3) {
    return "medium";
  }
  return "weak";
}
