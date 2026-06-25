import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import {
  buildClassificationBase,
  collectProjectTypeEvidence,
  identifyProjectType,
} from "./index.js";
import { resolvePartitionMode } from "./partition-mode-resolver.js";
import type { RepositoryClassificationContext } from "./types.js";

export async function classifyRepository(
  repoPath: string,
  claimsProvider: LlmClaimsProvider,
  timeout?: number,
): Promise<RepositoryClassificationContext> {
  const evidence = await collectProjectTypeEvidence(repoPath);
  const identificationResult = await identifyProjectType(
    evidence,
    claimsProvider,
    timeout,
  );
  const base = buildClassificationBase(identificationResult);
  const partitionModeResult = resolvePartitionMode(
    evidence,
    identificationResult,
  );

  return {
    ...base,
    identifiedAt: new Date().toISOString(),
    partitionMode: partitionModeResult.partitionMode,
    partitionModeConfidence: partitionModeResult.confidence,
    partitionModeEvidence: partitionModeResult.evidence,
  };
}
