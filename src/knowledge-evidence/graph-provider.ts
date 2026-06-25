import type { KnowledgeType } from "../schemas/knowledge-type.js";
import type { GenerateTarget } from "../knowledge/generate-scope.js";
import type { ReadOnlyQueryExecutor } from "../engine/lbug/read-only-session.js";
import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";
import {
  queryBoundaryEvidenceByPackage,
  queryCapabilityEvidenceByPackage,
  queryConceptEvidenceByPackage,
  queryConstraintEvidenceByPackage,
  queryDataModelEvidenceByPackage,
  queryExternalEvidenceByPackage,
  queryRelationEvidenceByPackage,
  queryWorkflowEvidenceByPackage,
} from "../evidence/extractors/index.js";

export async function buildGraphEvidenceGroups(input: {
  repoPath: string;
  lbugPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  executeQuery: ReadOnlyQueryExecutor;
}): Promise<EvidenceGroup[]> {
  switch (input.type) {
    case "CONCEPT":
      return queryConceptEvidenceByPackage(
        input.repoPath,
        input.lbugPath,
        input.target,
        input.executeQuery,
      );
    case "DATA_MODEL":
      return queryDataModelEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "CAPABILITY":
      return queryCapabilityEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "BOUNDARY":
      return queryBoundaryEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "EXTERNAL":
      return queryExternalEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "CONSTRAINT":
      return queryConstraintEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "RELATION":
      return queryRelationEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    case "WORKFLOW":
      return queryWorkflowEvidenceByPackage(
        input.repoPath,
        input.target,
        input.executeQuery,
      );
    default:
      return [];
  }
}
