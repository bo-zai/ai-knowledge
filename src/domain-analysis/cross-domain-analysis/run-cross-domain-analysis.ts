import { createAnalysisArtifactWriter } from "../artifacts/analysis-artifact-writer.js";
import { buildCrossDomainDependencySignals } from "./cross-domain-signal-builder.js";
import { createCrossDomainAnalysisAgent } from "./cross-domain-analysis-agent.js";
import type {
  CrossDomainAnalysisInput,
  CrossDomainAnalysisResult,
} from "../types.js";
import type { CrossDomainRef } from "../../partitioning/types.js";

export async function runCrossDomainAnalysis(
  repoPath: string,
  input: CrossDomainAnalysisInput,
): Promise<CrossDomainAnalysisResult> {
  const dependencySignals = buildCrossDomainDependencySignals(input);
  const preparedInput = {
    ...input,
    dependencySignals,
  };
  const agent = createCrossDomainAnalysisAgent(repoPath);
  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  await artifactWriter.writeCrossDomainAnalysisInput(preparedInput);
  const rawResult = await agent.analyze(preparedInput);
  const normalizedResult = normalizeCrossDomainResult(preparedInput, rawResult);
  await artifactWriter.writeCrossDomainAnalysisOutput(normalizedResult);
  return normalizedResult;
}

function normalizeCrossDomainResult(
  input: Required<Pick<CrossDomainAnalysisInput, "dependencySignals">> &
    CrossDomainAnalysisInput,
  result: CrossDomainAnalysisResult,
): CrossDomainAnalysisResult {
  const signalByPair = new Map(
    input.dependencySignals.map((signal) => [
      `${signal.sourcePartitionId}:${signal.targetPartitionId}`,
      signal,
    ]),
  );
  const refsByPartitionId: Record<string, CrossDomainRef[]> = {};

  for (const [sourcePartitionId, refs] of Object.entries(
    result.refsByPartitionId,
  )) {
    const normalizedRefs = refs
      .map((ref) => normalizeRef(sourcePartitionId, ref, signalByPair))
      .filter((ref): ref is CrossDomainRef => Boolean(ref));

    if (normalizedRefs.length > 0) {
      refsByPartitionId[sourcePartitionId] = dedupeRefs(normalizedRefs);
    }
  }

  return {
    ...result,
    refsByPartitionId,
  };
}

function normalizeRef(
  sourcePartitionId: string,
  ref: CrossDomainRef,
  signalByPair: Map<
    string,
    NonNullable<CrossDomainAnalysisInput["dependencySignals"]>[number]
  >,
): CrossDomainRef | undefined {
  const signal = signalByPair.get(`${sourcePartitionId}:${ref.targetDomain}`);
  if (!signal) {
    return undefined;
  }

  if (ref.relationType === "shared_table_reference") {
    return undefined;
  }

  return {
    ...ref,
    evidence:
      ref.evidence && ref.evidence.length > 0
        ? ref.evidence.slice(0, 6)
        : signal.relationReasons.slice(0, 6),
  };
}

function dedupeRefs(refs: CrossDomainRef[]): CrossDomainRef[] {
  const deduped = new Map<string, CrossDomainRef>();
  for (const ref of refs) {
    const key = `${ref.targetDomain}:${ref.relationType}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, ref);
      continue;
    }
    existing.evidence = [
      ...new Set([...(existing.evidence ?? []), ...(ref.evidence ?? [])]),
    ].slice(0, 6);
  }
  return [...deduped.values()];
}
