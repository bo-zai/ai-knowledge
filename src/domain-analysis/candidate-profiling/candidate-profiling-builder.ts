import type {
  CandidateBoundarySignal,
  CandidateProfilingInput,
  DomainEvidenceBundle,
} from "../types.js";

const MAX_RELATION_SIGNALS = 6;
const MAX_COMMIT_HIGHLIGHTS = 6;

export function buildCandidateProfilingInput(
  evidenceBundle: DomainEvidenceBundle,
): CandidateProfilingInput {
  const candidateProfilesSeed = evidenceBundle.candidates.map((candidate) => {
    const relationSignals = evidenceBundle.dependencyMatrix
      .filter(
        (entry) =>
          entry.sourceCandidateId === candidate.candidateId ||
          entry.targetCandidateId === candidate.candidateId,
      )
      .map((entry) => toBoundarySignal(entry, candidate.candidateId))
      .sort((left, right) => right.relationScore - left.relationScore)
      .slice(0, MAX_RELATION_SIGNALS);

    return {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      ownedTables: candidate.ownedTableNames,
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
      dependencyTables: candidate.dependencyTableNames,
      entryPointSummaries:
        candidate.evidence?.entryPointSummaries ??
        candidate.entryPoints.map(
          (entryPoint) =>
            `${entryPoint.kind}:${entryPoint.className}.${entryPoint.methodName}`,
        ),
      relationSignals,
      commitHighlights: (candidate.evidence?.commitHighlights ?? []).slice(
        0,
        MAX_COMMIT_HIGHLIGHTS,
      ),
      businessTerms: candidate.evidence?.businessTerms ?? [],
    };
  });

  return {
    evidenceBundle,
    candidateProfilesSeed,
  };
}

function toBoundarySignal(
  entry: DomainEvidenceBundle["dependencyMatrix"][number],
  candidateId: string,
): CandidateBoundarySignal {
  const targetCandidateId =
    entry.sourceCandidateId === candidateId
      ? entry.targetCandidateId
      : entry.sourceCandidateId;

  return {
    targetCandidateId,
    relationScore: entry.relationScore,
    relationReasons: entry.relationReasons,
  };
}
