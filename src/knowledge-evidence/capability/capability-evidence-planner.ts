import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";
import type { EvidenceGroup } from "../../evidence/type-evidence-builder.js";
import type { FunctionCandidate } from "../../evidence/evidence-bundle-schema.js";
import type { PartitionEvidenceScope } from "../types.js";
import type {
  EntryPoint,
  MapperInfo,
  ServiceInfo,
  TableInfo,
} from "../../partitioning/types.js";

const GENERIC_IDENTIFIER_TERMS = new Set([
  "api",
  "app",
  "base",
  "batch",
  "common",
  "controller",
  "dao",
  "dto",
  "entity",
  "example",
  "impl",
  "info",
  "item",
  "mapper",
  "model",
  "module",
  "page",
  "param",
  "po",
  "query",
  "request",
  "response",
  "result",
  "service",
  "vo",
]);

const ACTION_WORDS = new Set([
  "add",
  "apply",
  "approve",
  "audit",
  "cancel",
  "change",
  "confirm",
  "create",
  "delete",
  "disable",
  "enable",
  "export",
  "find",
  "get",
  "import",
  "list",
  "modify",
  "pay",
  "query",
  "refund",
  "reject",
  "remove",
  "return",
  "save",
  "search",
  "submit",
  "update",
]);

const READ_ONLY_ACTION_WORDS = new Set([
  "find",
  "get",
  "list",
  "query",
  "search",
]);

export function buildCapabilityEvidenceGroupsFromPartitions(input: {
  repoName: string;
  scopes: PartitionEvidenceScope[];
}): EvidenceGroup[] {
  return input.scopes
    .filter((scope) => scope.hasCapabilityEvidence)
    .map((scope) => buildCapabilityEvidenceGroup(input.repoName, scope));
}

export function buildCapabilityEvidenceGroup(
  repoName: string,
  scope: PartitionEvidenceScope,
): EvidenceGroup {
  const groupKey = normalizeGroupKey(scope.partition.partitionId);
  const entryPoints = buildEntryPoints(scope);
  const behaviorSlices = buildBehaviorSlices(scope);
  const dataContracts = buildDataContracts(scope);
  const moduleSurfaces = buildModuleSurfaces(scope);
  const functionCandidates = buildFunctionCandidates(scope);

  return {
    groupId: `CAPABILITY-${groupKey}`,
    packagePath: `partition/${groupKey}`,
    bundle: {
      bundleId: `BUNDLE-CAPABILITY-${groupKey}`.toUpperCase(),
      candidateId: `CAND-CAPABILITY-${groupKey}`,
      repoProfile: { name: repoName },
      confidence: estimateCapabilityConfidence(scope),
      risks: buildRisks(scope),
      capabilityHints: {
        nameCandidates: buildNameCandidates(scope),
        relatedTerms: buildRelatedTerms(scope),
        summaryHint: buildSummaryHint(scope),
      },
      entryPoints,
      behaviorSlices,
      dataContracts,
      moduleSurfaces,
      flowTraces: buildFlowTraces(
        entryPoints,
        behaviorSlices,
        functionCandidates,
      ),
      validationAnchors: [],
      docs: buildDocs(scope),
      negativeEvidence: [],
      openQuestions: [],
      functionCandidates,
    },
  };
}

function buildEntryPoints(
  scope: PartitionEvidenceScope,
): EvidenceBundle["entryPoints"] {
  return scope.partition.entryPoints.map((entryPoint, index) => ({
    ref: `evidence://entry/PEP-${String(index + 1).padStart(3, "0")}`,
    kind: mapEntryKind(entryPoint.kind),
    location: entryPoint.filePath,
    name: `${entryPoint.className}.${entryPoint.methodName}`,
    signature: entryPoint.signature,
    targetRelevance: 0.85,
    matchedTerms: splitTerms(
      `${entryPoint.className} ${entryPoint.methodName}`,
    ),
    sourceLocation: entryPoint.filePath,
    startLine: entryPoint.startLine,
  }));
}

function buildBehaviorSlices(
  scope: PartitionEvidenceScope,
): EvidenceBundle["behaviorSlices"] {
  const services = scope.partition.sharedResources?.coreLogic ?? [];
  return services.flatMap((service, serviceIndex) => {
    const methods = service.calledMethodNames?.length
      ? service.calledMethodNames
      : [service.className];
    return methods.map((methodName, methodIndex) => ({
      ref: `evidence://behavior/PBEH-${String(serviceIndex + 1).padStart(3, "0")}-${String(methodIndex + 1).padStart(2, "0")}`,
      location: service.filePath,
      verb: splitTerms(methodName)[0] ?? methodName,
      object: service.className,
      summary: `${service.className}.${methodName}`,
      targetRelevance: 0.75,
      matchedTerms: splitTerms(`${service.className} ${methodName}`),
      sourceLocation: service.filePath,
    }));
  });
}

function buildDataContracts(
  scope: PartitionEvidenceScope,
): EvidenceBundle["dataContracts"] {
  const tableContracts = scope.partition.tables.map((table, index) => ({
    ref: `evidence://contract/PTABLE-${String(index + 1).padStart(3, "0")}`,
    kind: "table" as const,
    location: table.tableName,
    name: table.tableName,
    fields: [],
    description: table.role,
    targetRelevance: table.role === "primary" ? 0.8 : 0.55,
    matchedTerms: splitTerms(table.tableName),
    customData: {
      partitionId: scope.partition.partitionId,
      partitionMode: scope.partitionMode,
      tableRole: table.role,
      source: "partition",
    },
  }));

  const mapperContracts = (
    scope.partition.sharedResources?.dataLayer ?? []
  ).map((mapper, index) => ({
    ref: `evidence://contract/PMAPPER-${String(index + 1).padStart(3, "0")}`,
    kind: "sql" as const,
    location: mapper.xmlPath ?? mapper.filePath,
    name: mapper.className,
    fields: mapper.tablesOperated ?? [],
    description: mapper.operations?.join(", "),
    targetRelevance: 0.65,
    matchedTerms: splitTerms(
      `${mapper.className} ${(mapper.tablesOperated ?? []).join(" ")}`,
    ),
    customData: {
      partitionId: scope.partition.partitionId,
      partitionMode: scope.partitionMode,
      operations: mapper.operations,
      source: "partition",
    },
  }));

  return [...tableContracts, ...mapperContracts];
}

function buildModuleSurfaces(
  scope: PartitionEvidenceScope,
): EvidenceBundle["moduleSurfaces"] {
  return scope.partition.backendModules.map((module, index) => ({
    ref: `evidence://module/PMOD-${String(index + 1).padStart(3, "0")}`,
    rootPath: module.path,
    exports: [module.name],
    responsibilities: [module.role],
    targetRelevance: 0.7,
    matchedTerms: splitTerms(module.name),
    sourceLocation: module.path,
  }));
}

function buildFlowTraces(
  entryPoints: EvidenceBundle["entryPoints"],
  behaviorSlices: EvidenceBundle["behaviorSlices"],
  functionCandidates: FunctionCandidate[],
): EvidenceBundle["flowTraces"] {
  if (entryPoints.length === 0 && behaviorSlices.length === 0) {
    return [];
  }

  const candidates =
    functionCandidates.length > 0
      ? functionCandidates.slice(0, 6)
      : [
          {
            id: "PFUNC-001",
            canonicalName: "Repository observed capability flow",
            normalizedVerb: "use",
            normalizedObject: "capability",
            domainTerms: [],
            summary: "Repository evidence indicates a capability flow.",
            sourceKinds: ["entry"] as FunctionCandidate["sourceKinds"],
            isCore: true,
            relevance: 0.65,
            signals: [],
          },
        ];

  return candidates.map((candidate, index) => {
    const signalLocations = new Set(
      candidate.signals.map((signal) => signal.location),
    );
    const matchedEntries = entryPoints.filter((entryPoint) =>
      signalLocations.has(entryPoint.location),
    );
    const matchedBehaviors = behaviorSlices.filter((behavior) =>
      signalLocations.has(behavior.location),
    );

    return {
      ref: `evidence://flow/PFLOW-${String(index + 1).padStart(3, "0")}`,
      steps: [
        ...matchedEntries.slice(0, 2).map((entryPoint) => ({
          action: candidate.canonicalName,
          location: entryPoint.location,
        })),
        ...matchedBehaviors.slice(0, 4).map((behavior) => ({
          action: `${toTitleCase(behavior.verb)} ${toTitleCase(behavior.object)}`,
          location: behavior.location,
        })),
      ],
      targetRelevance: candidate.relevance,
      matchedTerms: candidate.domainTerms,
    };
  });
}

function buildDocs(scope: PartitionEvidenceScope): EvidenceBundle["docs"] {
  return (scope.partition.crossDomainRefs ?? []).map((ref, index) => ({
    ref: `evidence://doc/PXREF-${String(index + 1).padStart(3, "0")}`,
    location: scope.partition.partitionId,
    kind: "comment",
    excerpt: `${ref.relationType}:${ref.targetDomain}`,
    terms: [ref.targetDomain, ref.relationType],
    targetRelevance: 0.5,
    matchedTerms: splitTerms(`${ref.targetDomain} ${ref.relationType}`),
  }));
}

function buildNameCandidates(scope: PartitionEvidenceScope): string[] {
  const namespaceTokens = inferNamespaceTokens(scope);
  const primaryObjectNames = scope.partition.tables
    .filter((table) => table.role === "primary")
    .map((table) => formatTableName(table.tableName, namespaceTokens))
    .filter(Boolean);
  const functionCandidates = buildFunctionCandidates(scope);
  const functionNames = functionCandidates.map(
    (candidate) => candidate.canonicalName,
  );

  return dedupe(
    [
      ...buildObjectLevelNameCandidates(primaryObjectNames, functionCandidates),
      ...functionNames,
      buildInventoryName(scope.partition.partitionId),
      ...scope.partition.tables
        .filter((table) => table.role === "primary")
        .map((table) => table.tableName),
    ].filter(Boolean),
  ).slice(0, 8);
}

function buildObjectLevelNameCandidates(
  primaryObjectNames: string[],
  functionCandidates: FunctionCandidate[],
): string[] {
  if (primaryObjectNames.length === 0) return [];
  const hasMutation = functionCandidates.some(
    (candidate) => !READ_ONLY_ACTION_WORDS.has(candidate.normalizedVerb),
  );
  return primaryObjectNames.map((name) =>
    hasMutation ? `${name} Management` : name,
  );
}

function buildRelatedTerms(scope: PartitionEvidenceScope): string[] {
  return dedupe([
    ...scope.partition.tables.flatMap((table) => splitTerms(table.tableName)),
    ...scope.partition.entryPoints.flatMap((entryPoint) =>
      splitTerms(`${entryPoint.className} ${entryPoint.methodName}`),
    ),
    ...(scope.partition.sharedResources?.coreLogic ?? []).flatMap((service) =>
      splitTerms(
        `${service.className} ${(service.calledMethodNames ?? []).join(" ")}`,
      ),
    ),
  ]).slice(0, 30);
}

function buildFunctionCandidates(
  scope: PartitionEvidenceScope,
): FunctionCandidate[] {
  const namespaceTokens = inferNamespaceTokens(scope);
  const entryCandidates = scope.partition.entryPoints.map((entryPoint, index) =>
    buildFunctionCandidateFromEntry(
      entryPoint,
      index,
      scope.partition.tables,
      namespaceTokens,
    ),
  );
  const serviceCandidates = (
    scope.partition.sharedResources?.coreLogic ?? []
  ).flatMap((service, serviceIndex) =>
    buildFunctionCandidatesFromService(
      service,
      serviceIndex,
      scope.partition.tables,
      namespaceTokens,
    ),
  );
  const mapperCandidates = (
    scope.partition.sharedResources?.dataLayer ?? []
  ).flatMap((mapper, mapperIndex) =>
    buildFunctionCandidatesFromMapper(
      mapper,
      mapperIndex,
      scope.partition.tables,
      namespaceTokens,
    ),
  );

  return dedupeFunctionCandidates([
    ...entryCandidates,
    ...serviceCandidates,
    ...mapperCandidates,
  ]).slice(0, 10);
}

function buildFunctionCandidateFromEntry(
  entryPoint: EntryPoint,
  index: number,
  tables: TableInfo[],
  namespaceTokens: Set<string>,
): FunctionCandidate {
  const parsed = parseActionObject(
    entryPoint.methodName,
    entryPoint.className,
    tables,
    namespaceTokens,
  );
  const canonicalName = buildCanonicalFunctionName(parsed.verb, parsed.object);
  return {
    id: `PFUNC-ENTRY-${String(index + 1).padStart(3, "0")}`,
    canonicalName,
    normalizedVerb: parsed.verb,
    normalizedObject: parsed.object,
    domainTerms: dedupe([
      ...parsed.objectTerms,
      ...splitTerms(entryPoint.className),
    ]),
    summary: `${canonicalName} via ${entryPoint.className}.${entryPoint.methodName}`,
    sourceKinds: ["entry"],
    isCore: true,
    relevance: 0.9,
    signals: [
      {
        kind: "entry",
        name: `${entryPoint.className}.${entryPoint.methodName}`,
        location: entryPoint.filePath,
        summary: entryPoint.signature,
        role: entryPoint.kind,
        matchedTerms: dedupe([
          ...splitTerms(entryPoint.className),
          ...splitTerms(entryPoint.methodName),
        ]),
        relevance: 0.9,
      },
    ],
  };
}

function buildFunctionCandidatesFromService(
  service: ServiceInfo,
  serviceIndex: number,
  tables: TableInfo[],
  namespaceTokens: Set<string>,
): FunctionCandidate[] {
  const methods = service.calledMethodNames?.length
    ? service.calledMethodNames
    : [service.className];
  return methods.map((methodName, methodIndex) => {
    const parsed = parseActionObject(
      methodName,
      service.className,
      tables,
      namespaceTokens,
    );
    const canonicalName = buildCanonicalFunctionName(
      parsed.verb,
      parsed.object,
    );
    return {
      id: `PFUNC-SERVICE-${String(serviceIndex + 1).padStart(3, "0")}-${String(methodIndex + 1).padStart(2, "0")}`,
      canonicalName,
      normalizedVerb: parsed.verb,
      normalizedObject: parsed.object,
      domainTerms: parsed.objectTerms,
      summary: `${canonicalName} via ${service.className}.${methodName}`,
      sourceKinds: ["behavior"],
      isCore: ACTION_WORDS.has(parsed.verb),
      relevance: 0.75,
      signals: [
        {
          kind: "behavior",
          name: `${service.className}.${methodName}`,
          location: service.filePath,
          role: service.implementationType,
          matchedTerms: dedupe([
            ...splitTerms(service.className),
            ...splitTerms(methodName),
          ]),
          relevance: 0.75,
        },
      ],
    };
  });
}

function buildFunctionCandidatesFromMapper(
  mapper: MapperInfo,
  mapperIndex: number,
  tables: TableInfo[],
  namespaceTokens: Set<string>,
): FunctionCandidate[] {
  const methods = mapper.calledMethodNames?.length
    ? mapper.calledMethodNames
    : (mapper.operations ?? []);
  return methods.map((methodName, methodIndex) => {
    const parsed = parseActionObject(
      String(methodName),
      mapper.className,
      tables,
      namespaceTokens,
    );
    const canonicalName = buildCanonicalFunctionName(
      parsed.verb,
      parsed.object,
    );
    return {
      id: `PFUNC-MAPPER-${String(mapperIndex + 1).padStart(3, "0")}-${String(methodIndex + 1).padStart(2, "0")}`,
      canonicalName,
      normalizedVerb: parsed.verb,
      normalizedObject: parsed.object,
      domainTerms: parsed.objectTerms,
      summary: `${canonicalName} via ${mapper.className}.${methodName}`,
      sourceKinds: ["behavior"],
      isCore: false,
      relevance: 0.55,
      signals: [
        {
          kind: "behavior",
          name: `${mapper.className}.${methodName}`,
          location: mapper.xmlPath ?? mapper.filePath,
          role: mapper.operations?.join(", "),
          matchedTerms: dedupe([
            ...splitTerms(mapper.className),
            ...splitTerms(String(methodName)),
            ...(mapper.tablesOperated ?? []).flatMap(splitTerms),
          ]),
          relevance: 0.55,
        },
      ],
    };
  });
}

function parseActionObject(
  methodName: string,
  className: string,
  tables: TableInfo[],
  namespaceTokens: Set<string>,
): { verb: string; object: string; objectTerms: string[] } {
  const methodTerms = splitTerms(methodName);
  const classTerms = stripNamespacePrefixes(
    stripClassSuffixTerms(splitTerms(className)),
    namespaceTokens,
  );
  const verb = methodTerms.find((term) => ACTION_WORDS.has(term)) ?? "manage";
  const termsAfterVerb = methodTerms.includes(verb)
    ? methodTerms.slice(methodTerms.indexOf(verb) + 1)
    : methodTerms;
  const primaryTableTerms = tables
    .filter((table) => table.role === "primary")
    .flatMap((table) =>
      stripNamespacePrefixes(splitTerms(table.tableName), namespaceTokens),
    );
  const objectTerms = dedupe([
    ...stripNamespacePrefixes(termsAfterVerb, namespaceTokens),
    ...classTerms,
    ...primaryTableTerms,
  ]).filter((term) => !GENERIC_IDENTIFIER_TERMS.has(term));
  const object =
    objectTerms.length > 0 ? objectTerms.join(" ") : "business object";
  return { verb, object, objectTerms };
}

function stripClassSuffixTerms(terms: string[]): string[] {
  return terms.filter((term) => !GENERIC_IDENTIFIER_TERMS.has(term));
}

function stripNamespacePrefixes(
  terms: string[],
  namespaceTokens: Set<string>,
): string[] {
  if (terms.length <= 1) return terms;
  const [first, ...rest] = terms;
  if (first && namespaceTokens.has(first)) {
    return rest;
  }
  return terms;
}

function buildCanonicalFunctionName(verb: string, object: string): string {
  return `${toTitleCase(verb)} ${toTitleCase(object)}`;
}

function buildSummaryHint(scope: PartitionEvidenceScope): string {
  const primaryObjects = scope.partition.tables
    .filter((table) => table.role === "primary")
    .map((table) => table.tableName);
  const functions = buildFunctionCandidates(scope)
    .filter((candidate) => candidate.isCore)
    .map((candidate) => candidate.canonicalName)
    .slice(0, 5);
  return [
    `partition=${scope.partition.partitionId}`,
    primaryObjects.length > 0
      ? `primary_objects=${primaryObjects.join(", ")}`
      : "",
    functions.length > 0 ? `business_functions=${functions.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function buildInventoryName(partitionId: string): string {
  return partitionId
    .replace(/^domain:|^capability:/, "")
    .replace(/[_:-]+/g, " ");
}

function formatTableName(
  tableName: string,
  namespaceTokens: Set<string>,
): string {
  return toTitleCase(
    stripNamespacePrefixes(
      splitTerms(tableName).filter(
        (term) => !GENERIC_IDENTIFIER_TERMS.has(term),
      ),
      namespaceTokens,
    ).join(" "),
  );
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dedupeFunctionCandidates(
  candidates: FunctionCandidate[],
): FunctionCandidate[] {
  const byKey = new Map<string, FunctionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.normalizedVerb}:${candidate.normalizedObject}`;
    const existing = byKey.get(key);
    if (!existing || candidate.relevance > existing.relevance) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const coreDiff = Number(right.isCore) - Number(left.isCore);
    if (coreDiff !== 0) return coreDiff;
    return right.relevance - left.relevance;
  });
}

function buildRisks(scope: PartitionEvidenceScope): string[] {
  const risks: string[] = [];
  if (scope.partition.entryPoints.length === 0) {
    risks.push("no_external_boundary_found");
  }
  if (scope.partition.tables.length === 0) {
    risks.push("no_data_contract_found");
  }
  return risks;
}

function estimateCapabilityConfidence(scope: PartitionEvidenceScope): number {
  const entryBonus = scope.partition.entryPoints.length > 0 ? 0.2 : 0;
  const behaviorBonus =
    (scope.partition.sharedResources?.coreLogic?.length ?? 0) > 0 ? 0.12 : 0;
  const dataBonus = scope.partition.tables.length > 0 ? 0.08 : 0;
  return Math.min(0.9, 0.5 + entryBonus + behaviorBonus + dataBonus);
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

function inferNamespaceTokens(scope: PartitionEvidenceScope): Set<string> {
  const counts = new Map<string, number>();
  const names = [
    ...scope.partition.tables.map((table) => table.tableName),
    ...scope.partition.entryPoints.map((entryPoint) => entryPoint.className),
    ...(scope.partition.sharedResources?.coreLogic?.map(
      (item) => item.className,
    ) ?? []),
    ...(scope.partition.sharedResources?.dataLayer?.map(
      (item) => item.className,
    ) ?? []),
    ...(scope.partition.sharedResources?.entities?.map(
      (item) => item.className,
    ) ?? []),
  ];
  for (const name of names) {
    const first = splitTerms(name)[0];
    if (!first || first.length < 2 || first.length > 4) continue;
    if (ACTION_WORDS.has(first) || GENERIC_IDENTIFIER_TERMS.has(first))
      continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([term]) => term),
  );
}

function splitTerms(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:/\\.-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 1)
    .filter((item) => !GENERIC_IDENTIFIER_TERMS.has(item));
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
