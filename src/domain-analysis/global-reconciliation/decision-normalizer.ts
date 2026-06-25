import type { CandidateProfile, DomainEvidenceBundle } from "../types.js";
import type {
  DomainDefinition,
  PartitionCandidate,
} from "../../partitioning/types.js";

const NOISE_TABLE_NAMES = new Set([
  "id",
  "ids",
  "dateupdate",
  "createtime",
  "updatetime",
  "deleted",
  "isdelete",
]);

export interface NormalizeDomainDecisionsInput {
  decisions: DomainDefinition[];
  evidenceBundle: DomainEvidenceBundle;
  profiles: CandidateProfile[];
}

export function normalizeDomainDecisions(
  input: NormalizeDomainDecisionsInput,
): DomainDefinition[] {
  const candidateMap = new Map(
    input.evidenceBundle.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const profileMap = new Map(
    input.profiles.map((profile) => [profile.candidateId, profile]),
  );
  const ownedByCandidateMap = buildOwnedByCandidateMap(
    input.evidenceBundle.candidates,
  );
  const anchorTableMap = new Map(
    input.evidenceBundle.candidates.map((candidate) => [
      candidate.candidateId,
      candidate.anchorTable,
    ]),
  );
  const tableKindMap = new Map(
    input.evidenceBundle.schemaRelationGraph.tables.map((table) => [
      table.tableName,
      table.tableKind,
    ]),
  );
  const canonicalTableOwners = buildCanonicalTableOwners(
    input.evidenceBundle.candidates,
    profileMap,
  );

  const normalizedDecisions = input.decisions
    .map((decision) =>
      normalizeSingleDecision(
        decision,
        candidateMap,
        ownedByCandidateMap,
        anchorTableMap,
        tableKindMap,
        canonicalTableOwners,
      ),
    )
    .filter((decision): decision is DomainDefinition => Boolean(decision));

  return deduplicateDomainNames(normalizedDecisions);
}

function normalizeSingleDecision(
  decision: DomainDefinition,
  candidateMap: Map<string, PartitionCandidate>,
  ownedByCandidateMap: Map<string, Set<string>>,
  anchorTableMap: Map<string, string>,
  tableKindMap: Map<string, string>,
  canonicalTableOwners: Map<string, string>,
): DomainDefinition | null {
  const coreCandidateIds = dedupeIds(
    decision.coreCandidateIds.filter((candidateId) =>
      candidateMap.has(candidateId),
    ),
  );
  const supportingCandidateIds = dedupeIds(
    decision.supportingCandidateIds
      .filter((candidateId) => candidateMap.has(candidateId))
      .filter((candidateId) => !coreCandidateIds.includes(candidateId)),
  );
  const includedCandidateIds = new Set([
    ...coreCandidateIds,
    ...supportingCandidateIds,
  ]);

  if (includedCandidateIds.size === 0) {
    return null;
  }

  const availableCoreTables = new Set(
    coreCandidateIds.flatMap((candidateId) =>
      getOwnedTablesForCandidate(candidateId, ownedByCandidateMap),
    ),
  );
  const availableSupportingTables = new Set(
    [...includedCandidateIds].flatMap((candidateId) =>
      getOwnedTablesForCandidate(candidateId, ownedByCandidateMap),
    ),
  );

  const sanitizedCoreTables = dedupeTables(
    decision.coreTables.filter((tableName) =>
      shouldKeepTableName(tableName, availableSupportingTables),
    ),
  );
  const sanitizedSupportingTables = dedupeTables(
    decision.supportingTables.filter((tableName) =>
      shouldKeepTableName(tableName, availableSupportingTables),
    ),
  );

  const finalCoreTables = sanitizedCoreTables.filter((tableName) =>
    shouldRemainCoreTable(
      tableName,
      includedCandidateIds,
      availableCoreTables,
      anchorTableMap,
      tableKindMap,
      canonicalTableOwners,
    ),
  );
  const demotedSupportingTables = sanitizedCoreTables.filter(
    (tableName) => !finalCoreTables.includes(tableName),
  );
  const finalSupportingTables = dedupeTables([
    ...sanitizedSupportingTables,
    ...demotedSupportingTables,
  ]).filter((tableName) => !finalCoreTables.includes(tableName));

  if (finalCoreTables.length === 0) {
    const fallbackCoreTable = pickFallbackCoreTable(
      coreCandidateIds,
      candidateMap,
      availableSupportingTables,
    );
    if (!fallbackCoreTable) {
      return null;
    }
    finalCoreTables.push(fallbackCoreTable);
  }

  return {
    ...decision,
    coreCandidateIds,
    supportingCandidateIds,
    excludedCandidateIds: dedupeIds(
      decision.excludedCandidateIds.filter(
        (candidateId) => !includedCandidateIds.has(candidateId),
      ),
    ),
    coreTables: finalCoreTables,
    supportingTables: finalSupportingTables,
  };
}

function buildOwnedByCandidateMap(
  candidates: PartitionCandidate[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    map.set(
      candidate.candidateId,
      new Set([
        candidate.anchorTable,
        ...candidate.ownedTableNames,
        ...candidate.supportingTableNames,
      ]),
    );
  }

  return map;
}

function buildCanonicalTableOwners(
  candidates: PartitionCandidate[],
  profileMap: Map<string, CandidateProfile>,
): Map<string, string> {
  const tableOwners = new Map<string, string[]>();

  for (const candidate of candidates) {
    const ownedTables = new Set([
      candidate.anchorTable,
      ...candidate.ownedTableNames,
      ...candidate.supportingTableNames,
    ]);
    for (const tableName of ownedTables) {
      const owners = tableOwners.get(tableName) ?? [];
      owners.push(candidate.candidateId);
      tableOwners.set(tableName, owners);
    }
  }

  const result = new Map<string, string>();
  for (const [tableName, owners] of tableOwners.entries()) {
    const winner = [...owners].sort((left, right) => {
      const leftCandidate = candidates.find(
        (candidate) => candidate.candidateId === left,
      );
      const rightCandidate = candidates.find(
        (candidate) => candidate.candidateId === right,
      );
      const leftScore = scoreCandidateOwnership(
        leftCandidate,
        profileMap.get(left),
        tableName,
      );
      const rightScore = scoreCandidateOwnership(
        rightCandidate,
        profileMap.get(right),
        tableName,
      );
      return rightScore - leftScore;
    })[0];

    if (winner) {
      result.set(tableName, winner);
    }
  }

  return result;
}

function scoreCandidateOwnership(
  candidate: PartitionCandidate | undefined,
  profile: CandidateProfile | undefined,
  tableName: string,
): number {
  if (!candidate) {
    return 0;
  }

  let score = 0;
  if (candidate.anchorTable === tableName) {
    score += 6;
  }
  if (candidate.ownedTableNames.includes(tableName)) {
    score += 3;
  }
  if (candidate.supportingTableNames.includes(tableName)) {
    score += 1;
  }

  switch (profile?.profileType) {
    case "core-business":
      score += 3;
      break;
    case "support-business":
      score += 1;
      break;
    case "aggregator":
    case "infrastructure":
    case "ambiguous":
      score -= 2;
      break;
  }

  return score;
}

function getOwnedTablesForCandidate(
  candidateId: string,
  ownedByCandidateMap: Map<string, Set<string>>,
): string[] {
  return [...(ownedByCandidateMap.get(candidateId) ?? new Set<string>())];
}

function shouldKeepTableName(
  tableName: string,
  availableSupportingTables: Set<string>,
): boolean {
  if (!tableName) {
    return false;
  }

  const normalized = tableName.trim().toLowerCase();
  if (!normalized || NOISE_TABLE_NAMES.has(normalized)) {
    return false;
  }

  return availableSupportingTables.has(tableName);
}

function shouldRemainCoreTable(
  tableName: string,
  includedCandidateIds: Set<string>,
  availableCoreTables: Set<string>,
  anchorTableMap: Map<string, string>,
  tableKindMap: Map<string, string>,
  canonicalTableOwners: Map<string, string>,
): boolean {
  const isAnchorTable = [...includedCandidateIds].some(
    (candidateId) => anchorTableMap.get(candidateId) === tableName,
  );
  if (isAnchorTable) {
    return true;
  }

  if (isLowSignalTable(tableName, tableKindMap.get(tableName))) {
    return false;
  }

  if (availableCoreTables.has(tableName)) {
    return true;
  }

  const canonicalOwner = canonicalTableOwners.get(tableName);
  if (!canonicalOwner || includedCandidateIds.has(canonicalOwner)) {
    return true;
  }

  return false;
}

function isLowSignalTable(
  tableName: string,
  tableKind: string | undefined,
): boolean {
  if (tableKind === "log") {
    return true;
  }

  const normalized = tableName.toLowerCase();
  return normalized.endsWith("_log") || normalized.includes("_log_");
}

function pickFallbackCoreTable(
  coreCandidateIds: string[],
  candidateMap: Map<string, PartitionCandidate>,
  availableSupportingTables: Set<string>,
): string | undefined {
  for (const candidateId of coreCandidateIds) {
    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      continue;
    }

    const preferredTables = [
      candidate.anchorTable,
      ...candidate.coreTableNames,
      ...candidate.supportingTableNames,
    ];
    for (const tableName of preferredTables) {
      if (
        availableSupportingTables.has(tableName) &&
        !NOISE_TABLE_NAMES.has(tableName.toLowerCase())
      ) {
        return tableName;
      }
    }
  }

  return undefined;
}

function deduplicateDomainNames(
  decisions: DomainDefinition[],
): DomainDefinition[] {
  const usedNames = new Map<string, number>();

  return decisions.map((decision) => {
    const normalizedName = decision.domainName.trim();
    const currentCount = usedNames.get(normalizedName) ?? 0;
    usedNames.set(normalizedName, currentCount + 1);

    if (currentCount === 0) {
      return {
        ...decision,
        domainName: normalizedName,
      };
    }

    const anchorHint =
      decision.coreTables[0] ?? decision.coreCandidateIds[0] ?? "domain";
    return {
      ...decision,
      domainName: `${normalizedName}-${anchorHint}`,
    };
  });
}

function dedupeIds(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeTables(values: string[]): string[] {
  return [...new Set(values)].filter((tableName) => {
    const normalized = tableName.toLowerCase();
    if (NOISE_TABLE_NAMES.has(normalized)) {
      return false;
    }

    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length === 0) {
      return false;
    }

    if (tokens.every((token) => token.length <= 1)) {
      return false;
    }

    return true;
  });
}
