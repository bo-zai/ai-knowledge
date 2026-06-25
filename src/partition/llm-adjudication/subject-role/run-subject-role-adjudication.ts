import { createAnalysisArtifactWriter } from "../../../domain-analysis/artifacts/analysis-artifact-writer.js";
import type { SubjectCandidateAnalysisResult } from "../../../domain-analysis/types.js";
import { buildSubjectRoleInput } from "./build-subject-role-input.js";
import { createSubjectRoleAgent } from "./subject-role-agent.js";
import type {
  SubjectRoleCompatibilityResult,
  SubjectRoleStageInput,
} from "./types.js";

export async function runSubjectRoleAdjudication(
  input: SubjectRoleStageInput,
): Promise<SubjectRoleCompatibilityResult> {
  const artifactWriter = createAnalysisArtifactWriter(input.repoPath);
  const stageInput = buildSubjectRoleInput({
    subjects: input.subjects,
    relationGraph: input.relationGraph,
  });
  await artifactWriter.writeJsonArtifact?.(
    "subject-role-input.json",
    stageInput,
  );

  const agent = createSubjectRoleAgent(input.repoPath);
  const stageResult = await agent.analyze(stageInput);
  await artifactWriter.writeJsonArtifact?.(
    "subject-role-output.json",
    stageResult,
  );

  const legacyResult: SubjectCandidateAnalysisResult = {
    classifications: stageResult.decisions.map((decision) => ({
      candidateId: decision.subjectId,
      subjectType: decision.subjectType,
      suggestedDomainName: decision.suggestedDomainName,
      businessTerms: decision.businessTerms,
      ownedTableHints: decision.ownedTableHints,
      dependencyTableHints: decision.dependencyTableHints,
      riskFlags: decision.riskFlags,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
    })),
    success: stageResult.success,
    error: stageResult.error,
  };

  return {
    stageResult,
    legacyResult,
  };
}
