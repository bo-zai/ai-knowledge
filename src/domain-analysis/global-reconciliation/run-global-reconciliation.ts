import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { createGlobalReconciliationAgent } from "./global-reconciliation-agent.js";
import { normalizeDomainDecisions } from "./decision-normalizer.js";
import type {
  CandidateProfilingResult,
  DomainEvidenceBundle,
  GlobalReconciliationInput,
  GlobalReconciliationResult,
  LocalClusterAnalysisResult,
} from "../types.js";

export async function runGlobalReconciliation(
  repoPath: string,
  evidenceBundle: DomainEvidenceBundle,
  profilingResult: CandidateProfilingResult,
  localClusterResult: LocalClusterAnalysisResult,
): Promise<GlobalReconciliationResult> {
  const input: GlobalReconciliationInput = {
    evidenceBundle,
    profiles: profilingResult.profiles,
    clusters: localClusterResult.clusters ?? buildClusters(localClusterResult),
    localDrafts: localClusterResult.drafts,
  };

  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  await artifactWriter.writeGlobalReconciliationInput(input);

  const agent = createGlobalReconciliationAgent(repoPath);
  const result = await agent.analyze(input);
  const normalizedDecisions = normalizeDomainDecisions({
    decisions: result.decisions,
    evidenceBundle,
    profiles: profilingResult.profiles,
  });
  const output = {
    ...result,
    decisions: normalizedDecisions,
  };
  await artifactWriter.writeGlobalReconciliationOutput(output);
  return output;
}

function buildClusters(
  localClusterResult: LocalClusterAnalysisResult,
): GlobalReconciliationInput["clusters"] {
  const clusterMap = new Map<
    string,
    GlobalReconciliationInput["clusters"][number]
  >();

  for (const draft of localClusterResult.drafts) {
    if (!clusterMap.has(draft.clusterId)) {
      clusterMap.set(draft.clusterId, {
        clusterId: draft.clusterId,
        candidateIds: [
          ...new Set([
            ...draft.coreCandidateIds,
            ...draft.supportingCandidateIds,
            ...draft.excludedCandidateIds,
          ]),
        ],
        boundarySignals: [],
        clusterReason: "local-draft",
      });
    }
  }

  return [...clusterMap.values()];
}
