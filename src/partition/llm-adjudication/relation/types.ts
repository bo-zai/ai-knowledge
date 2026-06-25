import type { SubjectRelationGraph } from "../../relation-inference/types.js";

export type RelationDecisionType =
  | "ownership"
  | "reference"
  | "shared-master-data"
  | "noise-correlation";

export interface RelationAdjudicationInputItem {
  relationId: string;
  sourceSubjectId: string;
  targetSubjectId: string;
  inferredKind: string;
  inferredStrength: string;
  score: number;
  sourceTables: string[];
  targetTables: string[];
  evidenceSummaries: string[];
}

export interface RelationAdjudicationInput {
  relations: RelationAdjudicationInputItem[];
}

export interface RelationAdjudicationDecision {
  relationId: string;
  decisionType: RelationDecisionType;
  confidence: number;
  reasoning: string;
}

export interface RelationAdjudicationOutput {
  decisions: RelationAdjudicationDecision[];
  success: boolean;
  error?: string;
}

export interface RelationAdjudicationStageInput {
  repoPath: string;
  relationGraph: SubjectRelationGraph;
}
