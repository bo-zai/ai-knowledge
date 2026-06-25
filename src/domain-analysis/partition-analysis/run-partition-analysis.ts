import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { collectEvidence } from "../../partition/evidence/index.js";
import { runRelationAdjudication } from "../../partition/llm-adjudication/relation/index.js";
import { buildSubjectRelationGraph } from "../../partition/relation-inference/index.js";
import { discoverSubjectCandidates } from "../../partition/subject-discovery/index.js";
import { createDomainEvidenceBuilder } from "../evidence-builder/domain-evidence-builder.js";
import { buildPartitionAnalysisInput } from "../evidence-builder/partition-evidence-view.js";
import { runDomainAnalysis } from "../domain-analysis/run-domain-analysis.js";
import { runSubjectCandidateAnalysis } from "../subject-candidate-analysis/run-subject-candidate-analysis.js";
import type {
  DomainAnalysisContext,
  PartitionAnalysisResult,
} from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";
import { logger } from "../../shared/logger.js";

export async function runPartitionAnalysis(
  clusterInput: DomainClusterInput,
  context: DomainAnalysisContext,
  concurrency = 1,
): Promise<PartitionAnalysisResult> {
  const analysisStartedAt = Date.now();
  const artifactWriter = createAnalysisArtifactWriter(context.repoPath);
  const canonicalEvidence = await collectEvidence(clusterInput, {
    repoPath: context.repoPath,
    analysisContext: context,
  });
  await artifactWriter.writeCanonicalEvidenceAtoms(
    canonicalEvidence.bundle.atoms,
  );
  await artifactWriter.writeCanonicalEvidenceBundle(canonicalEvidence.bundle);
  const subjectDiscoveryResult = discoverSubjectCandidates({
    clusterInput,
    atoms: canonicalEvidence.bundle.atoms,
  });
  await artifactWriter.writeSubjectCandidates(
    subjectDiscoveryResult.candidates,
  );
  const subjectRelationGraph = buildSubjectRelationGraph(
    subjectDiscoveryResult.candidates,
    canonicalEvidence.bundle.atoms,
  );
  await artifactWriter.writeSubjectRelations(subjectRelationGraph);

  const evidenceBuilder = createDomainEvidenceBuilder();
  const evidenceBundle = await evidenceBuilder.build(clusterInput, context);
  await artifactWriter.writeEvidenceBundle(evidenceBundle);

  const analysisInput = buildPartitionAnalysisInput({
    clusterInput,
    evidenceBundle,
  });
  await artifactWriter.writePartitionAnalysisInput(analysisInput);
  logger.info(
    `[PartitionAnalysis] Started second-generation analysis for ${evidenceBundle.candidates.length} candidates`,
  );

  logger.info("[PartitionAnalysis] Stage 1/3: subject candidate analysis");
  const subjectCandidateResult = await runSubjectCandidateAnalysis(
    context.repoPath,
    evidenceBundle,
  );
  const relationAdjudicationResult = await runRelationAdjudication({
    repoPath: context.repoPath,
    relationGraph: subjectRelationGraph,
  });
  logger.info("[PartitionAnalysis] Stage 2/3: main domain analysis");
  const mainAnalysis = await runDomainAnalysis(
    context.repoPath,
    evidenceBundle,
    subjectCandidateResult,
    relationAdjudicationResult,
  );
  logger.info("[PartitionAnalysis] Stage 3/3: structural validation");

  const result: PartitionAnalysisResult = {
    decisions: mainAnalysis.structuralValidationResult.decisions,
    success: mainAnalysis.mainAnalysisResult.success,
    error: mainAnalysis.mainAnalysisResult.error,
    executionTimeMs: Date.now() - analysisStartedAt,
    evidenceBundle,
    canonicalEvidenceBundle: canonicalEvidence.bundle,
    subjectDiscoveryResult,
    subjectRelationGraph,
    subjectCandidateResult,
    relationAdjudicationResult,
    domainAssemblyResult: mainAnalysis.domainAssemblyResult,
    mainAnalysisInput: mainAnalysis.input,
    mainAnalysisResult: mainAnalysis.mainAnalysisResult,
    structuralValidationResult: mainAnalysis.structuralValidationResult,
  };
  logger.info(
    `[PartitionAnalysis] Completed second-generation analysis with ${result.decisions.length} decisions in ${result.executionTimeMs}ms`,
  );
  await artifactWriter.writePartitionAnalysisOutput(result);
  return result;
}
