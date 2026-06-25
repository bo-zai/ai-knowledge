import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";
import type { EvidenceGroup } from "../../evidence/type-evidence-builder.js";
import type { PartitionEvidenceScope } from "../types.js";
import { evidencePathMatchesScope } from "../merge-policy.js";

export function buildConceptEvidenceGroupsFromPartitions(input: {
  repoName: string;
  scopes: PartitionEvidenceScope[];
  graphGroups: EvidenceGroup[];
}): EvidenceGroup[] {
  const groups: EvidenceGroup[] = [];

  for (const scope of input.scopes) {
    if (!scope.hasConceptEvidence) {
      continue;
    }

    const dataContracts = [
      ...buildPartitionTableContracts(scope),
      ...buildPartitionEntityContracts(scope),
      ...collectMatchedGraphContracts(scope, input.graphGroups),
    ];

    if (dataContracts.length === 0) {
      continue;
    }

    const groupKey = normalizeGroupKey(scope.partition.partitionId);
    groups.push({
      groupId: `CONCEPT-${groupKey}`,
      packagePath: `partition/${groupKey}`,
      bundle: {
        bundleId: `BUNDLE-CONCEPT-${groupKey}`.toUpperCase(),
        candidateId: `CAND-CONCEPT-${groupKey}`,
        repoProfile: { name: input.repoName },
        confidence: estimateConceptConfidence(scope, dataContracts.length),
        risks: [],
        capabilityHints: {
          nameCandidates: scope.evidenceNames.slice(0, 12),
          relatedTerms: collectRelatedTerms(scope),
          summaryHint: `Partition ${scope.partition.partitionId}`,
        },
        entryPoints: buildPartitionEntryPoints(scope),
        behaviorSlices: [],
        dataContracts,
        validationAnchors: [],
        moduleSurfaces: buildPartitionModuleSurfaces(scope),
        flowTraces: [],
        docs: buildCrossDomainDocs(scope),
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}

function buildPartitionTableContracts(
  scope: PartitionEvidenceScope,
): EvidenceBundle["dataContracts"] {
  return scope.partition.tables.map((table, index) => ({
    ref: `evidence://contract/PTABLE-${String(index + 1).padStart(3, "0")}`,
    kind: "table",
    location: table.tableName,
    name: table.tableName,
    fields: [],
    description: table.role,
    targetRelevance: table.role === "primary" ? 0.9 : 0.65,
    matchedTerms: splitTerms(table.tableName),
    customData: {
      partitionId: scope.partition.partitionId,
      partitionMode: scope.partitionMode,
      tableRole: table.role,
      source: "partition",
    },
  }));
}

function buildPartitionEntityContracts(
  scope: PartitionEvidenceScope,
): EvidenceBundle["dataContracts"] {
  const entities = scope.partition.sharedResources?.entities ?? [];
  return entities.map((entity, index) => ({
    ref: `evidence://contract/PENTITY-${String(index + 1).padStart(3, "0")}`,
    kind: "type",
    location: entity.filePath,
    name: entity.className,
    fields: [],
    description: entity.entityRole,
    targetRelevance: entity.entityRole === "canonical" ? 0.85 : 0.6,
    matchedTerms: splitTerms(entity.className),
    customData: {
      partitionId: scope.partition.partitionId,
      partitionMode: scope.partitionMode,
      entityRole: entity.entityRole,
      source: "partition",
    },
  }));
}

function collectMatchedGraphContracts(
  scope: PartitionEvidenceScope,
  graphGroups: EvidenceGroup[],
): EvidenceBundle["dataContracts"] {
  const contracts: EvidenceBundle["dataContracts"] = [];
  const seen = new Set<string>();

  for (const group of graphGroups) {
    for (const contract of group.bundle.dataContracts) {
      const key = `${contract.location}:${contract.name}`;
      if (seen.has(key)) {
        continue;
      }
      if (isStrictConceptContractMatch(contract, scope)) {
        seen.add(key);
        contracts.push({
          ...contract,
          ref: `evidence://contract/GCON-${String(contracts.length + 1).padStart(3, "0")}`,
          customData: {
            ...(contract.customData ?? {}),
            partitionId: scope.partition.partitionId,
            partitionMode: scope.partitionMode,
            source: "graph",
          },
        });
      }
    }
  }

  return contracts;
}

function isStrictConceptContractMatch(
  contract: EvidenceBundle["dataContracts"][number],
  scope: PartitionEvidenceScope,
): boolean {
  if (scope.evidenceNames.includes(contract.name)) {
    return true;
  }

  const sourceLocations = collectStrictSourceLocations(scope);
  return sourceLocations.some((location) =>
    pathMatchesFile(contract.location, location),
  );
}

function collectStrictSourceLocations(scope: PartitionEvidenceScope): string[] {
  return [
    ...scope.partition.entryPoints.map((entryPoint) => entryPoint.filePath),
    ...(scope.partition.sharedResources?.coreLogic?.map(
      (item) => item.filePath,
    ) ?? []),
    ...(scope.partition.sharedResources?.dataLayer?.flatMap((item) => [
      item.filePath,
      item.xmlPath ?? "",
    ]) ?? []),
    ...(scope.partition.sharedResources?.entities?.map(
      (item) => item.filePath,
    ) ?? []),
  ].filter(Boolean);
}

function pathMatchesFile(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function buildPartitionEntryPoints(
  scope: PartitionEvidenceScope,
): EvidenceBundle["entryPoints"] {
  return scope.partition.entryPoints.map((entryPoint, index) => ({
    ref: `evidence://entry/PEP-${String(index + 1).padStart(3, "0")}`,
    kind: mapEntryKind(entryPoint.kind),
    location: entryPoint.filePath,
    name: `${entryPoint.className}.${entryPoint.methodName}`,
    signature: entryPoint.signature,
    targetRelevance: 0.55,
    matchedTerms: splitTerms(
      `${entryPoint.className} ${entryPoint.methodName}`,
    ),
    sourceLocation: entryPoint.filePath,
    startLine: entryPoint.startLine,
  }));
}

function buildPartitionModuleSurfaces(
  scope: PartitionEvidenceScope,
): EvidenceBundle["moduleSurfaces"] {
  return scope.partition.backendModules.map((module, index) => ({
    ref: `evidence://module/PMOD-${String(index + 1).padStart(3, "0")}`,
    rootPath: module.path,
    exports: [module.name],
    responsibilities: [module.role],
    targetRelevance: 0.6,
    matchedTerms: splitTerms(module.name),
    sourceLocation: module.path,
  }));
}

function buildCrossDomainDocs(
  scope: PartitionEvidenceScope,
): EvidenceBundle["docs"] {
  return (scope.partition.crossDomainRefs ?? []).map((ref, index) => ({
    ref: `evidence://doc/PXREF-${String(index + 1).padStart(3, "0")}`,
    location: scope.partition.partitionId,
    kind: "comment",
    excerpt: `${ref.relationType}:${ref.targetDomain}`,
    terms: [ref.targetDomain, ref.relationType],
    targetRelevance: 0.45,
    matchedTerms: splitTerms(`${ref.targetDomain} ${ref.relationType}`),
  }));
}

function collectRelatedTerms(scope: PartitionEvidenceScope): string[] {
  return [
    ...scope.partition.tables.flatMap((table) => splitTerms(table.tableName)),
    ...scope.partition.backendModules.flatMap((module) =>
      splitTerms(module.name),
    ),
  ].slice(0, 20);
}

function estimateConceptConfidence(
  scope: PartitionEvidenceScope,
  contractCount: number,
): number {
  const primaryTableBonus = scope.partition.tables.some(
    (table) => table.role === "primary",
  )
    ? 0.15
    : 0;
  const entityBonus =
    (scope.partition.sharedResources?.entities?.length ?? 0) > 0 ? 0.1 : 0;
  return Math.min(
    0.9,
    0.55 + primaryTableBonus + entityBonus + contractCount * 0.01,
  );
}

function mapEntryKind(kind: string): "http" | "job" | "handler" {
  if (kind === "scheduled") {
    return "job";
  }
  if (kind === "mq_consumer") {
    return "handler";
  }
  return "http";
}

function normalizeGroupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function splitTerms(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:/\\.-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 1);
}
