import type { DomainAnalysisInput } from "../../../domain-analysis/types.js";
import type { DomainAssemblyInput } from "./types.js";

export function buildDomainAssemblyInput(
  input: DomainAnalysisInput,
): DomainAssemblyInput {
  const candidateById = new Map(
    input.evidenceBundle.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const candidateProfiles = input.subjectClassifications.map((item) => {
    const candidate = candidateById.get(item.candidateId);
    return {
      candidateId: item.candidateId,
      subjectType: item.subjectType,
      suggestedDomainName: item.suggestedDomainName,
      businessTerms: item.businessTerms,
      ownedTableHints: item.ownedTableHints,
      dependencyTableHints: item.dependencyTableHints,
      riskFlags: item.riskFlags,
      confidence: item.confidence,
      canBeDomainCore: item.subjectType === "business-root",
      entryPointCount: candidate?.entryPoints.length ?? 0,
      serviceCount: candidate?.services.length ?? 0,
      mapperCount: candidate?.mappers.length ?? 0,
      anchorTable: candidate?.anchorTable ?? item.ownedTableHints[0] ?? "",
      ownedTables: candidate?.ownedTableNames ?? item.ownedTableHints,
      coreTables: candidate?.coreTableNames ?? item.ownedTableHints,
      supportingTables: candidate?.supportingTableNames ?? [],
      dependencyTables:
        candidate?.dependencyTableNames ?? item.dependencyTableHints,
    };
  });

  return {
    candidateProfiles,
    coreCandidatePool: candidateProfiles
      .filter((item) => item.canBeDomainCore)
      .map((item) => ({
        candidateId: item.candidateId,
        suggestedDomainName: item.suggestedDomainName,
        anchorTable: item.anchorTable,
        ownedTables: item.ownedTables,
        coreTables: item.coreTables,
        businessTerms: item.businessTerms,
        riskFlags: item.riskFlags,
        confidence: item.confidence,
      })),
    nonCoreCandidatePool: candidateProfiles
      .filter((item) => !item.canBeDomainCore)
      .map((item) => ({
        candidateId: item.candidateId,
        subjectType: item.subjectType,
        suggestedDomainName: item.suggestedDomainName,
        anchorTable: item.anchorTable,
        ownedTables: item.ownedTables,
        coreTables: item.coreTables,
        businessTerms: item.businessTerms,
        riskFlags: item.riskFlags,
        confidence: item.confidence,
      })),
    dependencySignals: input.dependencySignals.map((item) => ({
      sourceCandidateId: item.sourceCandidateId,
      targetCandidateId: item.targetCandidateId,
      relationScore: item.relationScore,
      relationReasons: item.relationReasons,
    })),
    relationDecisions: (input.relationDecisions ?? []).map((item) => ({
      relationId: item.relationId,
      decisionType: item.decisionType,
      confidence: item.confidence,
      reasoning: item.reasoning,
    })),
    schemaRelationGrades: input.schemaRelationGrades,
    exclusionRules: input.exclusionRules,
  };
}
