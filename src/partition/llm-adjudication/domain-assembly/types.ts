import type { DomainDefinition } from "../../../partitioning/types.js";

export interface DomainAssemblyInput {
  candidateProfiles: Array<{
    candidateId: string;
    subjectType: string;
    suggestedDomainName: string;
    businessTerms: string[];
    ownedTableHints: string[];
    dependencyTableHints: string[];
    riskFlags: string[];
    confidence: number;
    canBeDomainCore: boolean;
    entryPointCount: number;
    serviceCount: number;
    mapperCount: number;
    anchorTable: string;
    ownedTables: string[];
    coreTables: string[];
    supportingTables: string[];
    dependencyTables: string[];
  }>;
  coreCandidatePool: Array<{
    candidateId: string;
    suggestedDomainName: string;
    anchorTable: string;
    ownedTables: string[];
    coreTables: string[];
    businessTerms: string[];
    riskFlags: string[];
    confidence: number;
  }>;
  nonCoreCandidatePool: Array<{
    candidateId: string;
    subjectType: string;
    suggestedDomainName: string;
    anchorTable: string;
    ownedTables: string[];
    coreTables: string[];
    businessTerms: string[];
    riskFlags: string[];
    confidence: number;
  }>;
  dependencySignals: Array<{
    sourceCandidateId: string;
    targetCandidateId: string;
    relationScore: number;
    relationReasons: string[];
  }>;
  relationDecisions: Array<{
    relationId: string;
    decisionType: string;
    confidence: number;
    reasoning: string;
  }>;
  schemaRelationGrades: Array<{
    sourceTable: string;
    targetTable: string;
    grade: string;
    relationType: string;
    strength: string;
    evidence: string[];
  }>;
  exclusionRules: string[];
}

export interface DomainAssemblyOutput {
  decisions: DomainDefinition[];
  success: boolean;
  error?: string;
  rawResponse?: string;
}
