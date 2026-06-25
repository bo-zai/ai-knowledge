import type {
  DomainAnalysisInput,
  SubjectCandidateClassification,
} from "../types.js";
import type {
  DomainDefinition,
  PartitionCandidate,
} from "../../partitioning/types.js";
import type {
  BoundaryCandidateDecision,
  BoundaryCandidateIndex,
  DomainBoundaryFinalResult,
  DomainBoundaryPlan,
} from "./types.js";

const MIN_LIFECYCLE_ENTRY_COUNT = 3;
const MAX_CHILD_OWNED_TABLE_COUNT = 1;
const COMMON_GROUP_PREFIX_LENGTH = 2;
const MIN_COMMON_GROUP_SIZE = 3;

export function planDomainBoundaries(
  input: DomainAnalysisInput,
): DomainBoundaryFinalResult & { plan: DomainBoundaryPlan } {
  const indexes = buildCandidateIndexes(input);
  const validIndexes = indexes.filter((index) =>
    isMaterialCandidate(index.candidate),
  );
  const parentByCandidateId = buildParentMap(validIndexes);
  const groupedCandidateIds = buildCommonPrefixGroups(
    validIndexes,
    parentByCandidateId,
  );
  const candidateDecisions = buildCandidateDecisions({
    indexes: validIndexes,
    parentByCandidateId,
    groupedCandidateIds,
  });
  const domainDrafts = buildDomainDrafts({
    indexes: validIndexes,
    candidateDecisions,
    input,
  });
  const conflicts = findBoundaryConflicts(candidateDecisions);
  const decisions = normalizeDomainDrafts(domainDrafts);

  return {
    decisions,
    conflicts,
    plan: {
      candidateDecisions,
      domainDrafts,
      conflicts,
    },
  };
}

function buildCandidateIndexes(
  input: DomainAnalysisInput,
): BoundaryCandidateIndex[] {
  const classificationById = new Map(
    input.subjectClassifications.map((classification) => [
      classification.candidateId,
      classification,
    ]),
  );

  return input.evidenceBundle.candidates.map((candidate) => {
    const classification = classificationById.get(candidate.candidateId);
    return {
      candidate,
      classificationType: classification?.subjectType,
      classificationConfidence: classification?.confidence,
      suggestedDomainName: classification?.suggestedDomainName,
    };
  });
}

function isMaterialCandidate(candidate: PartitionCandidate): boolean {
  if (!isValidTableName(candidate.anchorTable)) {
    return false;
  }

  return getCandidateTables(candidate).length > 0;
}

function buildParentMap(
  indexes: BoundaryCandidateIndex[],
): Map<string, string> {
  const result = new Map<string, string>();

  for (const child of indexes) {
    const parent = indexes
      .filter(
        (candidate) =>
          candidate.candidate.candidateId !== child.candidate.candidateId,
      )
      .filter((candidate) =>
        isStructuralParent(candidate.candidate, child.candidate),
      )
      .sort(
        (left, right) =>
          splitTableNameTokens(right.candidate.anchorTable).length -
          splitTableNameTokens(left.candidate.anchorTable).length,
      )[0];
    if (!parent) {
      continue;
    }

    if (shouldAttachToStructuralParent(parent, child)) {
      result.set(child.candidate.candidateId, parent.candidate.candidateId);
    }
  }

  return result;
}

function buildCommonPrefixGroups(
  indexes: BoundaryCandidateIndex[],
  parentByCandidateId: Map<string, string>,
): Map<string, string> {
  const candidatesByPrefix = new Map<string, BoundaryCandidateIndex[]>();

  for (const index of indexes) {
    if (parentByCandidateId.has(index.candidate.candidateId)) {
      continue;
    }

    if (!isSingleTableOperationalCandidate(index.candidate)) {
      continue;
    }

    const prefix = splitTableNameTokens(index.candidate.anchorTable)
      .slice(0, COMMON_GROUP_PREFIX_LENGTH)
      .join("_");
    if (!prefix) {
      continue;
    }

    const items = candidatesByPrefix.get(prefix) ?? [];
    items.push(index);
    candidatesByPrefix.set(prefix, items);
  }

  const result = new Map<string, string>();
  for (const [prefix, items] of candidatesByPrefix.entries()) {
    if (items.length < MIN_COMMON_GROUP_SIZE) {
      continue;
    }

    for (const item of items) {
      result.set(item.candidate.candidateId, prefix);
    }
  }

  return result;
}

function buildCandidateDecisions(params: {
  indexes: BoundaryCandidateIndex[];
  parentByCandidateId: Map<string, string>;
  groupedCandidateIds: Map<string, string>;
}): BoundaryCandidateDecision[] {
  const { indexes, parentByCandidateId, groupedCandidateIds } = params;
  const indexById = new Map(
    indexes.map((index) => [index.candidate.candidateId, index]),
  );

  return indexes.map((index) => {
    const candidate = index.candidate;
    if (index.classificationType === "noise-or-aggregation") {
      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        role: "excluded",
        reasons: ["subject-classification:noise-or-aggregation"],
      };
    }

    const parentCandidateId = parentByCandidateId.get(candidate.candidateId);
    if (parentCandidateId) {
      const parent = indexById.get(parentCandidateId)?.candidate;
      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        role: "support",
        domainKey: parent?.anchorTable,
        parentCandidateId,
        reasons: ["structural-parent"],
      };
    }

    const commonGroupKey = groupedCandidateIds.get(candidate.candidateId);
    if (commonGroupKey) {
      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        role: "core",
        domainKey: commonGroupKey,
        reasons: ["common-prefix-operational-group"],
      };
    }

    if (index.classificationType === "business-support") {
      const fallbackDomainKey = findFallbackDomainKey(candidate, indexes);
      if (!fallbackDomainKey) {
        return {
          candidateId: candidate.candidateId,
          anchorTable: candidate.anchorTable,
          role: "core",
          domainKey: candidate.anchorTable,
          reasons: ["support-without-parent-promoted"],
        };
      }

      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        role: "support",
        domainKey: fallbackDomainKey,
        reasons: ["subject-classification:business-support"],
      };
    }

    if (
      hasLifecycleSurface(candidate) ||
      index.classificationType === "business-root"
    ) {
      return {
        candidateId: candidate.candidateId,
        anchorTable: candidate.anchorTable,
        role: "core",
        domainKey: candidate.anchorTable,
        reasons: ["independent-lifecycle"],
      };
    }

    return {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      role: "reference",
      domainKey: candidate.anchorTable,
      reasons: ["reference-or-low-lifecycle"],
    };
  });
}

function buildDomainDrafts(params: {
  indexes: BoundaryCandidateIndex[];
  candidateDecisions: BoundaryCandidateDecision[];
  input: DomainAnalysisInput;
}): DomainDefinition[] {
  const { indexes, candidateDecisions, input } = params;
  const indexById = new Map(
    indexes.map((index) => [index.candidate.candidateId, index]),
  );
  const domains = new Map<string, DomainDefinition>();

  for (const decision of candidateDecisions) {
    if (decision.role === "excluded") {
      continue;
    }

    const index = indexById.get(decision.candidateId);
    if (!index) {
      continue;
    }

    const domainKey = decision.domainKey ?? index.candidate.anchorTable;
    const domain = getOrCreateDomain(domains, domainKey, index);
    if (decision.role === "core" || decision.role === "reference") {
      domain.coreCandidateIds.push(index.candidate.candidateId);
      domain.coreTables.push(...getCoreTables(index.candidate));
    } else {
      domain.supportingCandidateIds.push(index.candidate.candidateId);
      domain.supportingTables.push(...getOwnedTables(index.candidate));
    }
  }

  attachUnassignedSupportCandidates({
    domains,
    candidateDecisions,
    indexes,
  });
  addCrossDomainDependencies({
    domains,
    input,
    candidateDecisions,
  });

  return [...domains.values()];
}

function getOrCreateDomain(
  domains: Map<string, DomainDefinition>,
  domainKey: string,
  index: BoundaryCandidateIndex,
): DomainDefinition {
  const existing = domains.get(domainKey);
  if (existing) {
    return existing;
  }

  const domain: DomainDefinition = {
    domainName: index.suggestedDomainName || domainKey,
    confidence: index.classificationConfidence ?? 0.7,
    coreCandidateIds: [],
    supportingCandidateIds: [],
    excludedCandidateIds: [],
    coreTables: [],
    supportingTables: [],
    crossDomainDependencies: [],
    reasoning: "结构边界规划器根据候选生命周期、表归属和结构关系生成",
  };
  domains.set(domainKey, domain);
  return domain;
}

function attachUnassignedSupportCandidates(params: {
  domains: Map<string, DomainDefinition>;
  candidateDecisions: BoundaryCandidateDecision[];
  indexes: BoundaryCandidateIndex[];
}): void {
  const { domains, candidateDecisions, indexes } = params;
  const indexById = new Map(
    indexes.map((index) => [index.candidate.candidateId, index]),
  );
  const coreDomainKeys = new Set(domains.keys());

  for (const decision of candidateDecisions) {
    if (decision.role !== "support" || decision.domainKey) {
      continue;
    }

    const index = indexById.get(decision.candidateId);
    if (!index) {
      continue;
    }

    const domainKey = findNearestDomainKey(index.candidate, coreDomainKeys);
    if (!domainKey) {
      continue;
    }

    const domain = domains.get(domainKey);
    if (!domain) {
      continue;
    }

    domain.supportingCandidateIds.push(index.candidate.candidateId);
    domain.supportingTables.push(...getOwnedTables(index.candidate));
  }
}

function addCrossDomainDependencies(params: {
  domains: Map<string, DomainDefinition>;
  input: DomainAnalysisInput;
  candidateDecisions: BoundaryCandidateDecision[];
}): void {
  const { domains, input, candidateDecisions } = params;
  const domainByCandidateId = new Map<string, string>();
  for (const decision of candidateDecisions) {
    if (!decision.domainKey || decision.role === "excluded") {
      continue;
    }
    domainByCandidateId.set(decision.candidateId, decision.domainKey);
  }

  for (const signal of input.dependencySignals) {
    const sourceDomainKey = domainByCandidateId.get(signal.sourceCandidateId);
    const targetDomainKey = domainByCandidateId.get(signal.targetCandidateId);
    if (
      !sourceDomainKey ||
      !targetDomainKey ||
      sourceDomainKey === targetDomainKey
    ) {
      continue;
    }

    const sourceDomain = domains.get(sourceDomainKey);
    const targetDomain = domains.get(targetDomainKey);
    if (!sourceDomain || !targetDomain) {
      continue;
    }

    if (
      sourceDomain.crossDomainDependencies.some(
        (dependency) => dependency.targetDomainHint === targetDomain.domainName,
      )
    ) {
      continue;
    }

    sourceDomain.crossDomainDependencies.push({
      targetDomainHint: targetDomain.domainName,
      relationType: "weak_identity_reference",
      evidence: signal.relationReasons.slice(0, 5),
    });
  }
}

function normalizeDomainDrafts(drafts: DomainDefinition[]): DomainDefinition[] {
  return drafts
    .map((draft) => ({
      ...draft,
      coreCandidateIds: unique(draft.coreCandidateIds),
      supportingCandidateIds: unique(draft.supportingCandidateIds).filter(
        (candidateId) => !draft.coreCandidateIds.includes(candidateId),
      ),
      excludedCandidateIds: unique(draft.excludedCandidateIds),
      coreTables: unique(draft.coreTables).filter(isValidTableName),
      supportingTables: unique(draft.supportingTables)
        .filter(isValidTableName)
        .filter((tableName) => !draft.coreTables.includes(tableName)),
      crossDomainDependencies: draft.crossDomainDependencies,
    }))
    .filter(
      (draft) =>
        draft.coreCandidateIds.length > 0 && draft.coreTables.length > 0,
    )
    .sort((left, right) =>
      left.coreTables[0].localeCompare(right.coreTables[0]),
    );
}

function findBoundaryConflicts(
  candidateDecisions: BoundaryCandidateDecision[],
): string[] {
  return candidateDecisions
    .filter((decision) => decision.role === "support" && !decision.domainKey)
    .map(
      (decision) =>
        `候选 ${decision.candidateId} 是支撑候选，但未找到可归属的父业务域`,
    );
}

function shouldAttachToStructuralParent(
  parent: BoundaryCandidateIndex,
  child: BoundaryCandidateIndex,
): boolean {
  if (child.classificationType === "business-support") {
    return true;
  }

  if (isJunctionOrRelationCandidate(child.candidate)) {
    return true;
  }

  if (
    child.candidate.ownedTableNames.length <= MAX_CHILD_OWNED_TABLE_COUNT &&
    splitTableNameTokens(child.candidate.anchorTable).length -
      splitTableNameTokens(parent.candidate.anchorTable).length <=
      2
  ) {
    return true;
  }

  return false;
}

function isStructuralParent(
  parent: PartitionCandidate,
  child: PartitionCandidate,
): boolean {
  const parentTokens = splitTableNameTokens(parent.anchorTable);
  const childTokens = splitTableNameTokens(child.anchorTable);
  if (parentTokens.length === 0 || parentTokens.length >= childTokens.length) {
    return false;
  }

  return parentTokens.every((token, index) => childTokens[index] === token);
}

function findFallbackDomainKey(
  candidate: PartitionCandidate,
  indexes: BoundaryCandidateIndex[],
): string | undefined {
  return indexes
    .filter((index) => index.candidate.candidateId !== candidate.candidateId)
    .filter((index) => isStructuralParent(index.candidate, candidate))
    .sort(
      (left, right) =>
        splitTableNameTokens(right.candidate.anchorTable).length -
        splitTableNameTokens(left.candidate.anchorTable).length,
    )[0]?.candidate.anchorTable;
}

function findNearestDomainKey(
  candidate: PartitionCandidate,
  coreDomainKeys: Set<string>,
): string | undefined {
  return [...coreDomainKeys]
    .filter((domainKey) =>
      isTokenPrefix(
        splitTableNameTokens(domainKey),
        splitTableNameTokens(candidate.anchorTable),
      ),
    )
    .sort(
      (left, right) =>
        splitTableNameTokens(right).length - splitTableNameTokens(left).length,
    )[0];
}

function isTokenPrefix(parentTokens: string[], childTokens: string[]): boolean {
  if (parentTokens.length === 0 || parentTokens.length >= childTokens.length) {
    return false;
  }

  return parentTokens.every((token, index) => childTokens[index] === token);
}

function hasLifecycleSurface(candidate: PartitionCandidate): boolean {
  const methodNames = candidate.entryPoints.map((entryPoint) =>
    entryPoint.methodName.toLowerCase(),
  );
  const hasCreate = methodNames.some((methodName) =>
    /create|add|save|insert|register|submit/.test(methodName),
  );
  const hasUpdate = methodNames.some((methodName) =>
    /update|edit|modify|status|enable|disable|delete|remove/.test(methodName),
  );
  const hasRead = methodNames.some((methodName) =>
    /list|page|get|detail|query|search|select/.test(methodName),
  );

  return (
    methodNames.length >= MIN_LIFECYCLE_ENTRY_COUNT &&
    ((hasRead && (hasCreate || hasUpdate)) || (hasCreate && hasUpdate))
  );
}

function isSingleTableOperationalCandidate(
  candidate: PartitionCandidate,
): boolean {
  return (
    candidate.ownedTableNames.length <= 1 && hasLifecycleSurface(candidate)
  );
}

function isJunctionOrRelationCandidate(candidate: PartitionCandidate): boolean {
  return (
    candidate.tables.some((table) => table.role === "junction_table") ||
    splitTableNameTokens(candidate.anchorTable).includes("relation")
  );
}

function getCoreTables(candidate: PartitionCandidate): string[] {
  const tables =
    candidate.ownedTableNames.length > 0
      ? candidate.ownedTableNames
      : candidate.coreTableNames;
  return tables.filter(isValidTableName);
}

function getOwnedTables(candidate: PartitionCandidate): string[] {
  const anchorTokens = splitTableNameTokens(candidate.anchorTable);
  const tables =
    candidate.ownedTableNames.length > 0
      ? candidate.ownedTableNames
      : [candidate.anchorTable];
  return tables.filter(isValidTableName).filter((tableName) => {
    if (tableName === candidate.anchorTable) {
      return true;
    }

    return isTokenPrefix(anchorTokens, splitTableNameTokens(tableName));
  });
}

function getCandidateTables(candidate: PartitionCandidate): string[] {
  return unique([
    candidate.anchorTable,
    ...candidate.ownedTableNames,
    ...candidate.coreTableNames,
    ...candidate.supportingTableNames,
  ]).filter(isValidTableName);
}

function splitTableNameTokens(tableName: string): string[] {
  return tableName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function isValidTableName(tableName: string): boolean {
  const normalized = tableName.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "unknown" && normalized !== "id";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
