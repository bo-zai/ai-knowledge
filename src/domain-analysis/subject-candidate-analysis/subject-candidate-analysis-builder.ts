import type {
  DomainEvidenceBundle,
  SubjectCandidateAnalysisInput,
} from "../types.js";

export function buildSubjectCandidateAnalysisInput(
  evidenceBundle: DomainEvidenceBundle,
): SubjectCandidateAnalysisInput {
  return {
    evidenceBundle,
    candidates: evidenceBundle.candidates.map((candidate) => {
      const evidence = candidate.evidence;
      const relationSignals = evidenceBundle.dependencyMatrix
        .filter(
          (entry) =>
            entry.sourceCandidateId === candidate.candidateId ||
            entry.targetCandidateId === candidate.candidateId,
        )
        .slice(0, 12)
        .map((entry) => ({
          targetCandidateId:
            entry.sourceCandidateId === candidate.candidateId
              ? entry.targetCandidateId
              : entry.sourceCandidateId,
          relationScore: entry.relationScore,
          relationReasons: entry.relationReasons.slice(0, 8),
        }));

      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        anchorQuality: candidate.anchorQuality,
        entryPointSummaries: evidence?.entryPointSummaries ?? [],
        ownedTables: evidence?.ownedTables ?? candidate.ownedTableNames,
        coreTables: evidence?.coreTables ?? candidate.coreTableNames,
        supportingTables:
          evidence?.supportingTables ?? candidate.supportingTableNames,
        dependencyTables:
          evidence?.dependencyTables ?? candidate.dependencyTableNames,
        businessTerms: evidence?.businessTerms ?? [],
        relationSignals,
        commitHighlights: evidence?.commitHighlights ?? [],
      };
    }),
  };
}
