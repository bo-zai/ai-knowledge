import type { SubjectCandidate } from "../../subject-discovery/types.js";
import type { SubjectRelationGraph } from "../../relation-inference/types.js";
import type {
  SubjectCandidateAnalysisResult,
  SubjectCandidateType,
} from "../../../domain-analysis/types.js";

export interface SubjectRoleInputCandidate {
  subjectId: string;
  anchorTable: string;
  anchorQuality: "high" | "medium" | "low";
  entryPoints: string[];
  ownedTables: string[];
  dependencyTables: string[];
  relatedTables: string[];
  joinedTables: string[];
  writeTables: string[];
  readOnlyTables: string[];
  services: string[];
  mappers: string[];
  uncertaintyFlags: string[];
  relatedSubjectSignals: Array<{
    targetSubjectId: string;
    relationKind: string;
    strength: string;
    score: number;
    evidenceKinds: string[];
  }>;
}

export interface SubjectRoleAdjudicationInput {
  candidates: SubjectRoleInputCandidate[];
}

export interface SubjectRoleDecision {
  subjectId: string;
  subjectType: SubjectCandidateType;
  suggestedDomainName: string;
  businessTerms: string[];
  ownedTableHints: string[];
  dependencyTableHints: string[];
  riskFlags: string[];
  reasoning: string;
  confidence: number;
}

export interface SubjectRoleAdjudicationOutput {
  decisions: SubjectRoleDecision[];
  success: boolean;
  error?: string;
}

export interface SubjectRoleStageInput {
  repoPath: string;
  subjects: SubjectCandidate[];
  relationGraph: SubjectRelationGraph;
}

export interface SubjectRoleCompatibilityResult {
  stageResult: SubjectRoleAdjudicationOutput;
  legacyResult: SubjectCandidateAnalysisResult;
}
