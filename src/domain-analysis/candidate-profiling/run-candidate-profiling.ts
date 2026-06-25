import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { buildCandidateProfilingInput } from "./candidate-profiling-builder.js";
import {
  createCandidateProfilingAgent,
  loadCandidateProfilingPrompt,
} from "./candidate-profiling-agent.js";
import type {
  CandidateProfilingResult,
  DomainEvidenceBundle,
} from "../types.js";
import { logger } from "../../shared/logger.js";
import { runWithConcurrency } from "../../shared/concurrency-runner.js";

export async function runCandidateProfiling(
  repoPath: string,
  evidenceBundle: DomainEvidenceBundle,
  concurrency = 1,
): Promise<CandidateProfilingResult> {
  const input = buildCandidateProfilingInput(evidenceBundle);
  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  await artifactWriter.writeCandidateProfilingInput(input);

  const agent = createCandidateProfilingAgent(repoPath);
  const systemPrompt = await loadCandidateProfilingPrompt();
  const profiles = new Array(input.candidateProfilesSeed.length);

  logger.info(
    `[CandidateProfiling] Dispatching ${input.candidateProfilesSeed.length} candidates with concurrency=${Math.max(1, Math.floor(concurrency || 1))}`,
  );
  await runWithConcurrency({
    items: input.candidateProfilesSeed,
    concurrency,
    onProgress: (event) => {
      if (event.type !== "started") {
        return;
      }

      logger.info(
        `[CandidateProfiling] Progress ${event.index + 1}/${event.total}: ${event.item.candidateId}`,
      );
    },
    worker: async (seed, index) => {
      profiles[index] = await agent.analyzeSeed(
        systemPrompt,
        seed,
        index,
        input.candidateProfilesSeed.length,
      );
    },
  });

  const result: CandidateProfilingResult = {
    profiles,
    success: true,
  };
  logger.info(
    `[CandidateProfiling] Completed profiling ${result.profiles.length} candidates`,
  );
  await artifactWriter.writeCandidateProfilingOutput(result);
  return result;
}
