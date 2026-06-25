import type {
  DomainAnalysisInput,
  DomainDependencyMatrixEntry,
  DomainEvidenceBundle,
  SchemaRelationGrade,
  SubjectCandidateClassification,
} from "../types.js";
import type { RelationAdjudicationOutput } from "../../partition/llm-adjudication/relation/types.js";

export function buildDomainAnalysisInput(params: {
  evidenceBundle: DomainEvidenceBundle;
  subjectClassifications: SubjectCandidateClassification[];
  relationDecisions?: RelationAdjudicationOutput["decisions"];
}): DomainAnalysisInput {
  const { evidenceBundle, subjectClassifications, relationDecisions } = params;
  const classificationById = new Map(
    subjectClassifications.map((item) => [item.candidateId, item]),
  );

  const rootCandidates = subjectClassifications
    .filter((item) => item.subjectType === "business-root")
    .map((item) => item.candidateId);
  const supportCandidates = subjectClassifications
    .filter((item) => item.subjectType === "business-support")
    .map((item) => item.candidateId);
  const referenceCandidates = subjectClassifications
    .filter((item) => item.subjectType === "cross-domain-reference")
    .map((item) => item.candidateId);
  const excludedCandidates = subjectClassifications
    .filter((item) => item.subjectType === "noise-or-aggregation")
    .map((item) => item.candidateId);

  return {
    evidenceBundle,
    subjectClassifications,
    rootCandidates,
    supportCandidates,
    referenceCandidates,
    excludedCandidates,
    schemaRelationGrades: buildSchemaRelationGrades(evidenceBundle),
    dependencySignals: selectDependencySignals(
      evidenceBundle.dependencyMatrix,
      classificationById,
      relationDecisions,
    ),
    relationDecisions,
    exclusionRules: [
      "共享引用主体默认优先视为依赖来源，不直接作为合并主因",
      "审计记录、配置主数据、字典类和聚合查询结果默认不是业务域核心表",
      "弱引用、隐式关联、通用查询拼装只支持跨域依赖，不支持直接合并",
      "同一候选不能同时作为多个业务域的核心主体",
    ],
  };
}

function buildSchemaRelationGrades(
  evidenceBundle: DomainEvidenceBundle,
): SchemaRelationGrade[] {
  return evidenceBundle.schemaRelationGraph.relations.map((relation) => ({
    sourceTable: relation.sourceTable,
    targetTable: relation.targetTable,
    grade: mapSchemaGrade(relation.relationType, relation.strength),
    relationType: relation.relationType,
    strength: relation.strength,
    evidence: relation.evidence.slice(0, 8),
  }));
}

function mapSchemaGrade(
  relationType: string,
  strength: string,
): SchemaRelationGrade["grade"] {
  if (relationType === "audit_or_log" || relationType === "config_or_dict") {
    return "noise";
  }

  if (
    relationType === "aggregate_child" ||
    relationType === "junction_table" ||
    relationType === "extension_table" ||
    (relationType === "explicit_fk" && strength === "strong")
  ) {
    return "strong-same-domain";
  }

  return "weak-dependency";
}

function selectDependencySignals(
  entries: DomainDependencyMatrixEntry[],
  classificationById: Map<string, SubjectCandidateClassification>,
  relationDecisions?: RelationAdjudicationOutput["decisions"],
): DomainDependencyMatrixEntry[] {
  const decisionByRelationKey = new Map(
    (relationDecisions ?? []).map((item) => [
      normalizeRelationKey(item.relationId),
      item,
    ]),
  );
  return entries
    .filter((entry) => {
      const source = classificationById.get(entry.sourceCandidateId);
      const target = classificationById.get(entry.targetCandidateId);
      return Boolean(source) && Boolean(target);
    })
    .map((entry) => {
      const relationDecision = decisionByRelationKey.get(
        normalizeRelationKey(
          `${entry.sourceCandidateId}->${entry.targetCandidateId}`,
        ),
      );
      if (!relationDecision) {
        return entry;
      }

      const adjustedScore =
        relationDecision.decisionType === "ownership"
          ? entry.relationScore + 3
          : relationDecision.decisionType === "reference"
            ? entry.relationScore + 1
            : relationDecision.decisionType === "shared-master-data"
              ? Math.max(1, entry.relationScore)
              : Math.max(0, entry.relationScore - 3);

      return {
        ...entry,
        relationScore: adjustedScore,
        relationReasons: [
          ...entry.relationReasons,
          `relation-decision:${relationDecision.decisionType}`,
        ],
      };
    })
    .filter((entry) => entry.relationScore > 0)
    .sort((left, right) => right.relationScore - left.relationScore)
    .slice(0, 200);
}

function normalizeRelationKey(value: string): string {
  return value
    .replace(/:implicit$|:join$|:cohesion$|:naming$/g, "")
    .replace(/<->/g, "->");
}
