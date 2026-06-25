import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { buildLocalAnalysisClusters } from "./local-cluster-builder.js";
import {
  createLocalClusterAnalysisAgent,
  loadLocalClusterAnalysisPrompt,
} from "./local-cluster-analysis-agent.js";
import type {
  CandidateProfilingResult,
  DomainEvidenceBundle,
  LocalClusterAnalysisInput,
  LocalClusterAnalysisResult,
  LocalClusterDomainDraft,
} from "../types.js";
import { logger } from "../../shared/logger.js";
import { runWithConcurrency } from "../../shared/concurrency-runner.js";

export async function runLocalClusterAnalysis(
  repoPath: string,
  evidenceBundle: DomainEvidenceBundle,
  profilingResult: CandidateProfilingResult,
  concurrency = 1,
): Promise<LocalClusterAnalysisResult> {
  const clusters = buildLocalAnalysisClusters(
    evidenceBundle,
    profilingResult.profiles,
  );
  const input: LocalClusterAnalysisInput = {
    evidenceBundle,
    profiles: profilingResult.profiles,
    clusters,
  };

  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  await artifactWriter.writeLocalClusterAnalysisInput(input);

  const agent = createLocalClusterAnalysisAgent(repoPath);
  const prompt = await loadLocalClusterAnalysisPrompt();
  const candidateMap = new Map(
    input.evidenceBundle.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const profileMap = new Map(
    input.profiles.map((profile) => [profile.candidateId, profile]),
  );
  const draftGroups: LocalClusterDomainDraft[][] = new Array(
    input.clusters.length,
  );

  logger.info(
    `[LocalClusterAnalysis] Dispatching ${input.clusters.length} clusters with concurrency=${Math.max(1, Math.floor(concurrency || 1))}`,
  );
  await runWithConcurrency({
    items: input.clusters,
    concurrency,
    onProgress: (event) => {
      if (event.type !== "started") {
        return;
      }

      logger.info(
        `[LocalClusterAnalysis] Progress ${event.index + 1}/${event.total}: ${event.item.clusterId} (${event.item.candidateIds.length} candidates)`,
      );
    },
    worker: async (cluster, index) => {
      draftGroups[index] = await agent.analyzeCluster(
        prompt,
        cluster,
        candidateMap,
        profileMap,
        input,
        index,
        input.clusters.length,
      );
    },
  });

  const result: LocalClusterAnalysisResult = {
    drafts: draftGroups.flatMap((drafts) => drafts ?? []),
    success: true,
  };
  const output = {
    ...result,
    clusters,
  };
  await artifactWriter.writeLocalClusterAnalysisOutput(output);
  return output;
}
