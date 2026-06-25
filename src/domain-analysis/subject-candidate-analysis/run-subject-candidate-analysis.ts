import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { createSubjectCandidateAnalysisAgent } from "./subject-candidate-analysis-agent.js";
import { buildSubjectCandidateAnalysisInput } from "./subject-candidate-analysis-builder.js";
import type {
  DomainEvidenceBundle,
  SubjectCandidateAnalysisResult,
} from "../types.js";

export async function runSubjectCandidateAnalysis(
  repoPath: string,
  evidenceBundle: DomainEvidenceBundle,
): Promise<SubjectCandidateAnalysisResult> {
  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  const input = buildSubjectCandidateAnalysisInput(evidenceBundle);
  await artifactWriter.writeSubjectCandidateAnalysisInput(input);

  const agent = createSubjectCandidateAnalysisAgent(repoPath);
  const result = await agent.analyze(input);
  await artifactWriter.writeSubjectCandidateAnalysisOutput(result);
  return result;
}
