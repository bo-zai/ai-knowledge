import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { planDomainBoundaries } from "../domain-boundary/index.js";
import { buildDomainAnalysisInput } from "./domain-analysis-input-builder.js";
import type {
  DomainAnalysisResult,
  DomainEvidenceBundle,
  StructuralValidationResult,
  SubjectCandidateAnalysisResult,
} from "../types.js";
import type { RelationAdjudicationOutput } from "../../partition/llm-adjudication/relation/types.js";

export interface DomainAnalysisExecutionResult {
  input: ReturnType<typeof buildDomainAnalysisInput>;
  mainAnalysisResult: DomainAnalysisResult;
  domainAssemblyResult: DomainAnalysisResult;
  structuralValidationResult: StructuralValidationResult;
}

export async function runDomainAnalysis(
  repoPath: string,
  evidenceBundle: DomainEvidenceBundle,
  subjectCandidateResult: SubjectCandidateAnalysisResult,
  relationAdjudicationResult?: RelationAdjudicationOutput,
): Promise<DomainAnalysisExecutionResult> {
  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  const input = buildDomainAnalysisInput({
    evidenceBundle,
    subjectClassifications: subjectCandidateResult.classifications,
    relationDecisions: relationAdjudicationResult?.decisions,
  });
  await artifactWriter.writeDomainAnalysisInput(input);

  const boundaryResult = planDomainBoundaries(input);
  await artifactWriter.writeDomainBoundaryPlan(boundaryResult.plan);
  await artifactWriter.writeDomainBoundaryFinal({
    decisions: boundaryResult.decisions,
    conflicts: boundaryResult.conflicts,
  });

  const mainAnalysisResult: DomainAnalysisResult = {
    decisions: boundaryResult.decisions,
    success: true,
    rawResponse: JSON.stringify({
      source: "deterministic-domain-boundary-planner",
      conflicts: boundaryResult.conflicts,
    }),
  };
  await artifactWriter.writeDomainAnalysisRawOutput({
    rawResponse: mainAnalysisResult.rawResponse ?? "",
  });
  await artifactWriter.writeDomainAnalysisOutput(mainAnalysisResult);

  const structuralValidationResult: StructuralValidationResult = {
    decisions: boundaryResult.decisions,
    warnings: boundaryResult.conflicts,
  };
  await artifactWriter.writeStructuralValidationOutput(
    structuralValidationResult,
  );

  return {
    input,
    mainAnalysisResult,
    domainAssemblyResult: {
      decisions: [],
      success: true,
      rawResponse:
        "domain assembly skipped; deterministic boundary planner is authoritative",
    },
    structuralValidationResult,
  };
}
