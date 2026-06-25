import type { DomainEvidenceBundle, PartitionAnalysisInput } from "../types.js";
import type {
  CandidateRelation,
  PartitionAnalysisEvidence,
  PartitionAnalysisEvidenceItem,
} from "../../partitioning/types.js";

const MAX_SCHEMA_HIGHLIGHTS = 60;
const MAX_RELATION_SUMMARIES_PER_CANDIDATE = 8;
const MAX_COMMIT_HIGHLIGHTS_PER_CANDIDATE = 6;

export function buildPartitionAnalysisInput(
  baseInput: Omit<PartitionAnalysisInput, "partitionEvidence">,
): PartitionAnalysisInput {
  return {
    ...baseInput,
    partitionEvidence: buildPartitionEvidence(baseInput.evidenceBundle),
  };
}

export function buildPartitionEvidence(
  evidenceBundle: DomainEvidenceBundle,
): PartitionAnalysisEvidence {
  return {
    candidateItems: evidenceBundle.candidates.map((candidate) => {
      const evidence = candidate.evidence;
      const relationSummaries = evidenceBundle.candidateRelations
        .filter((relation) =>
          isRelationConnected(relation, candidate.candidateId),
        )
        .map((relation) =>
          summarizeCandidateRelation(relation, candidate.candidateId),
        )
        .filter(Boolean)
        .slice(0, MAX_RELATION_SUMMARIES_PER_CANDIDATE);

      const item: PartitionAnalysisEvidenceItem = {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        suggestedDomainName: evidence?.suggestedName ?? candidate.anchorTable,
        entryPointSummaries:
          evidence?.entryPointSummaries ??
          candidate.entryPoints.map(
            (entryPoint) =>
              `${entryPoint.kind}:${entryPoint.className}.${entryPoint.methodName}`,
          ),
        ownedTables: evidence?.ownedTables ?? candidate.ownedTableNames,
        coreTables: evidence?.coreTables ?? candidate.coreTableNames,
        supportingTables:
          evidence?.supportingTables ?? candidate.supportingTableNames,
        dependencyTables:
          evidence?.dependencyTables ?? candidate.dependencyTableNames,
        relatedCandidateIds:
          evidence?.relatedCandidateIds ??
          collectRelatedCandidateIds(
            evidenceBundle.candidateRelations,
            candidate.candidateId,
          ),
        relatedRelationSummaries: relationSummaries,
        businessTerms: evidence?.businessTerms ?? [],
        commitHighlights: (evidence?.commitHighlights ?? []).slice(
          0,
          MAX_COMMIT_HIGHLIGHTS_PER_CANDIDATE,
        ),
      };
      return item;
    }),
    schemaHighlights: evidenceBundle.schemaRelationGraph.relations
      .slice(0, MAX_SCHEMA_HIGHLIGHTS)
      .map(
        (relation) =>
          `${relation.sourceTable} -> ${relation.targetTable} (${relation.relationType}, ${relation.strength})`,
      ),
    projectDocumentHighlights: [],
  };
}

function isRelationConnected(
  relation: CandidateRelation,
  candidateId: string,
): boolean {
  return (
    relation.candidateIdA === candidateId ||
    relation.candidateIdB === candidateId
  );
}

function collectRelatedCandidateIds(
  relations: CandidateRelation[],
  candidateId: string,
): string[] {
  const related = new Set<string>();
  for (const relation of relations) {
    if (relation.candidateIdA === candidateId) {
      related.add(relation.candidateIdB);
    }
    if (relation.candidateIdB === candidateId) {
      related.add(relation.candidateIdA);
    }
  }
  return [...related];
}

function summarizeCandidateRelation(
  relation: CandidateRelation,
  candidateId: string,
): string | undefined {
  const targetCandidateId =
    relation.candidateIdA === candidateId
      ? relation.candidateIdB
      : relation.candidateIdA;
  const reasons = [
    ...relation.sharedCoreTables.map((tableName) => `共享核心表:${tableName}`),
    ...relation.sharedServices.map((serviceName) => `共享服务:${serviceName}`),
    ...relation.tableForeignKeyRelations.map(
      (item) => `表关联:${item.fromTable}->${item.toTable}`,
    ),
  ];
  if (reasons.length === 0) {
    return undefined;
  }
  return `${targetCandidateId}: ${reasons.join("，")}`;
}
