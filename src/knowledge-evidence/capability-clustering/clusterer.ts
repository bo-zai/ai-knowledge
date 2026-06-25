import type {
  EvidenceBundle,
  FunctionCandidate,
} from "../../evidence/evidence-bundle-schema.js";
import type {
  CapabilityCluster,
  CapabilityClusterEvidenceReason,
  CapabilityClusterScores,
  DomainCapabilityClusteringResult,
  FlowCandidate,
} from "./types.js";

const READ_ONLY_VERBS = new Set(["find", "get", "list", "query", "search"]);
const STATE_CHANGE_TERMS = new Set([
  "approve",
  "audit",
  "cancel",
  "change",
  "close",
  "confirm",
  "delete",
  "disable",
  "enable",
  "pay",
  "refund",
  "reject",
  "remove",
  "return",
  "status",
  "submit",
  "update",
]);

export interface BuildDomainCapabilityClustersInput {
  domainKey: string;
  domainName: string;
  partitionId: string;
  bundle: EvidenceBundle;
  fileChangeCounts?: Map<string, number>;
}

interface CandidateGroup {
  key: string;
  candidates: FunctionCandidate[];
}

export function buildDomainCapabilityClusters(
  input: BuildDomainCapabilityClustersInput,
): DomainCapabilityClusteringResult {
  const candidates = input.bundle.functionCandidates ?? [];
  const groups = buildCandidateGroups(candidates);
  const warnings: string[] = [];

  if (groups.length === 0) {
    warnings.push("no_function_candidates");
    const fallback = buildFallbackCluster(input);
    return {
      domainKey: input.domainKey,
      domainName: input.domainName,
      partitionId: input.partitionId,
      sourceBundleId: input.bundle.bundleId,
      capabilities: [fallback.cluster],
      flows: fallback.flows,
      warnings,
    };
  }

  const flows: FlowCandidate[] = [];
  const capabilities = groups.map((group, index) => {
    const clusterId = buildClusterId(input.domainKey, group.key, index);
    const clusterFlows = group.candidates.map((candidate, flowIndex) =>
      buildFlowCandidate({
        candidate,
        flowIndex,
        clusterId,
        bundle: input.bundle,
        fileChangeCounts: input.fileChangeCounts,
      }),
    );
    flows.push(...clusterFlows);
    return buildCluster({
      input,
      group,
      clusterId,
      flowIds: clusterFlows.map((flow) => flow.id),
    });
  });

  const visibleCapabilities = filterNavigableCapabilities(capabilities);
  const visibleCapabilityIds = new Set(
    visibleCapabilities.map((capability) => capability.id),
  );

  return {
    domainKey: input.domainKey,
    domainName: input.domainName,
    partitionId: input.partitionId,
    sourceBundleId: input.bundle.bundleId,
    capabilities: visibleCapabilities.sort((left, right) =>
      compareScores(right.scores, left.scores),
    ),
    flows: flows.filter((flow) =>
      visibleCapabilityIds.has(flow.primaryCapabilityId),
    ),
    warnings,
  };
}

function filterNavigableCapabilities(
  capabilities: CapabilityCluster[],
): CapabilityCluster[] {
  const hasEntryBackedCluster = capabilities.some(
    (capability) => capability.primaryEntryRefs.length > 0,
  );
  if (!hasEntryBackedCluster) return capabilities;
  return capabilities.filter(
    (capability) => capability.primaryEntryRefs.length > 0,
  );
}

function buildCandidateGroups(
  candidates: FunctionCandidate[],
): CandidateGroup[] {
  const groups = new Map<string, FunctionCandidate[]>();
  for (const candidate of candidates) {
    const key = buildGroupKey(candidate);
    const current = groups.get(key) ?? [];
    current.push(candidate);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, groupedCandidates]) => ({
    key,
    candidates: groupedCandidates.sort(
      (left, right) => right.relevance - left.relevance,
    ),
  }));
}

function buildGroupKey(candidate: FunctionCandidate): string {
  return buildCarrierObjectKey(candidate);
}

function buildCluster(input: {
  input: BuildDomainCapabilityClustersInput;
  group: CandidateGroup;
  clusterId: string;
  flowIds: string[];
}): CapabilityCluster {
  const refs = collectRefsForCandidates(
    input.input.bundle,
    input.group.candidates,
  );
  const scores = scoreCluster(
    input.group.candidates,
    input.input.fileChangeCounts,
  );
  return {
    id: input.clusterId,
    nameCandidates: buildNameCandidates(input.group),
    domainKey: input.input.domainKey,
    domainName: input.input.domainName,
    primaryEntryRefs: refs.entryRefs.slice(0, 8),
    supportingEntryRefs: refs.entryRefs.slice(8),
    behaviorRefs: refs.behaviorRefs,
    contractRefs: refs.contractRefs,
    moduleRefs: refs.moduleRefs,
    functionCandidateIds: input.group.candidates.map(
      (candidate) => candidate.id,
    ),
    flowCandidateIds: input.flowIds,
    scores,
    reasons: buildReasons(input.group, refs, scores),
    evidenceBundle: buildClusterBundle(
      input.input.bundle,
      input.clusterId,
      input.group,
      refs,
    ),
  };
}

function buildFlowCandidate(input: {
  candidate: FunctionCandidate;
  flowIndex: number;
  clusterId: string;
  bundle: EvidenceBundle;
  fileChangeCounts?: Map<string, number>;
}): FlowCandidate {
  const refs = collectRefsForCandidates(input.bundle, [input.candidate]);
  return {
    id: `${input.clusterId}-flow-${String(input.flowIndex + 1).padStart(2, "0")}`,
    name: input.candidate.canonicalName,
    primaryCapabilityId: input.clusterId,
    entryRefs: refs.entryRefs,
    behaviorRefs: refs.behaviorRefs,
    contractRefs: refs.contractRefs,
    moduleRefs: refs.moduleRefs,
    isWrite: !READ_ONLY_VERBS.has(input.candidate.normalizedVerb),
    hasStateTransition: isStateTransitionCandidate(input.candidate),
    scores: scoreCluster([input.candidate], input.fileChangeCounts),
  };
}

function buildFallbackCluster(input: BuildDomainCapabilityClustersInput): {
  cluster: CapabilityCluster;
  flows: FlowCandidate[];
} {
  const clusterId = buildClusterId(input.domainKey, "domain-navigation", 0);
  const refs = {
    entryRefs: input.bundle.entryPoints.map((item) => item.ref),
    behaviorRefs: input.bundle.behaviorSlices.map((item) => item.ref),
    contractRefs: input.bundle.dataContracts.map((item) => item.ref),
    moduleRefs: input.bundle.moduleSurfaces.map((item) => item.ref),
  };
  const scores = { businessCore: 0.45, navigationNeed: 0.5, changeActivity: 0 };
  return {
    flows: [],
    cluster: {
      id: clusterId,
      nameCandidates: input.bundle.capabilityHints.nameCandidates,
      domainKey: input.domainKey,
      domainName: input.domainName,
      primaryEntryRefs: refs.entryRefs.slice(0, 8),
      supportingEntryRefs: refs.entryRefs.slice(8),
      behaviorRefs: refs.behaviorRefs,
      contractRefs: refs.contractRefs,
      moduleRefs: refs.moduleRefs,
      functionCandidateIds: [],
      flowCandidateIds: [],
      scores,
      reasons: [
        {
          kind: "engineering_signal",
          summary:
            "Domain has no stable function candidates; kept as one navigation cluster.",
        },
      ],
      evidenceBundle: buildClusterBundle(
        input.bundle,
        clusterId,
        { key: "domain-navigation", candidates: [] },
        refs,
      ),
    },
  };
}

function collectRefsForCandidates(
  bundle: EvidenceBundle,
  candidates: FunctionCandidate[],
): {
  entryRefs: string[];
  behaviorRefs: string[];
  contractRefs: string[];
  moduleRefs: string[];
} {
  const signalLocations = new Set(
    candidates.flatMap((candidate) =>
      candidate.signals.map((signal) => signal.location),
    ),
  );
  const signalNames = new Set(
    candidates.flatMap((candidate) =>
      candidate.signals.map((signal) => signal.name),
    ),
  );
  const candidateTerms = new Set(
    candidates.flatMap((candidate) => [
      candidate.normalizedObject,
      ...candidate.domainTerms,
    ]),
  );
  const entryRefs = bundle.entryPoints
    .filter(
      (item) =>
        signalLocations.has(item.location) && signalNames.has(item.name),
    )
    .map((item) => item.ref);
  const behaviorRefs = bundle.behaviorSlices
    .filter(
      (item) =>
        signalLocations.has(item.location) &&
        Boolean(item.summary) &&
        [...signalNames].some((name) => name.includes(item.summary ?? "")),
    )
    .map((item) => item.ref);
  const contractRefs = bundle.dataContracts
    .filter((item) => hasTermOverlap(item.matchedTerms ?? [], candidateTerms))
    .map((item) => item.ref);
  const moduleRefs = bundle.moduleSurfaces
    .filter((item) =>
      [...signalLocations].some((location) => location.includes(item.rootPath)),
    )
    .map((item) => item.ref);

  return {
    entryRefs: dedupe(entryRefs),
    behaviorRefs: dedupe(behaviorRefs),
    contractRefs: dedupe(contractRefs),
    moduleRefs: dedupe(moduleRefs),
  };
}

function buildClusterBundle(
  bundle: EvidenceBundle,
  clusterId: string,
  group: CandidateGroup,
  refs: {
    entryRefs: string[];
    behaviorRefs: string[];
    contractRefs: string[];
    moduleRefs: string[];
  },
): EvidenceBundle {
  const allowedEntryRefs = new Set(refs.entryRefs);
  const allowedBehaviorRefs = new Set(refs.behaviorRefs);
  const allowedContractRefs = new Set(refs.contractRefs);
  const allowedModuleRefs = new Set(refs.moduleRefs);
  const functionCandidates = group.candidates;
  const relatedTerms = dedupe([
    ...bundle.capabilityHints.relatedTerms,
    ...functionCandidates.flatMap((candidate) => candidate.domainTerms),
  ]).slice(0, 30);

  return {
    ...bundle,
    bundleId: `${bundle.bundleId}-${clusterId}`.toUpperCase(),
    candidateId: `CAND-${clusterId}`.toUpperCase(),
    capabilityHints: {
      ...bundle.capabilityHints,
      nameCandidates: buildNameCandidates(group),
      relatedTerms,
      summaryHint: [
        bundle.capabilityHints.summaryHint,
        `cluster=${clusterId}`,
        functionCandidates.length > 0
          ? `functions=${functionCandidates.map((candidate) => candidate.canonicalName).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
    entryPoints: bundle.entryPoints.filter((item) =>
      allowedEntryRefs.has(item.ref),
    ),
    behaviorSlices: bundle.behaviorSlices.filter((item) =>
      allowedBehaviorRefs.has(item.ref),
    ),
    dataContracts: bundle.dataContracts.filter((item) =>
      allowedContractRefs.has(item.ref),
    ),
    moduleSurfaces: bundle.moduleSurfaces.filter((item) =>
      allowedModuleRefs.has(item.ref),
    ),
    flowTraces: bundle.flowTraces.filter((item) =>
      functionCandidates.some((candidate) =>
        item.matchedTerms?.some((term) => candidate.domainTerms.includes(term)),
      ),
    ),
    functionCandidates,
  };
}

function buildNameCandidates(group: CandidateGroup): string[] {
  const objectNames = dedupe(
    group.candidates.map((candidate) => {
      const carrierObject = buildCarrierObjectKey(candidate).replace(/-/g, " ");
      return toTitleCase(carrierObject || candidate.normalizedObject);
    }),
  );
  const actionNames = group.candidates.map(
    (candidate) => candidate.canonicalName,
  );
  const hasMutation = group.candidates.some(
    (candidate) => !READ_ONLY_VERBS.has(candidate.normalizedVerb),
  );
  return dedupe([
    ...objectNames.map((name) => (hasMutation ? `${name} Management` : name)),
    ...actionNames,
  ]).slice(0, 8);
}

function buildReasons(
  group: CandidateGroup,
  refs: {
    entryRefs: string[];
    behaviorRefs: string[];
    contractRefs: string[];
    moduleRefs: string[];
  },
  scores: CapabilityClusterScores,
): CapabilityClusterEvidenceReason[] {
  const reasons: CapabilityClusterEvidenceReason[] = [];
  const verbs = dedupe(
    group.candidates.map((candidate) => candidate.normalizedVerb),
  );
  const objects = dedupe(
    group.candidates.map((candidate) => candidate.normalizedObject),
  );
  if (verbs.length > 0) {
    reasons.push({
      kind: "shared_action",
      summary: `Grouped by action terms: ${verbs.join(", ")}`,
    });
  }
  if (objects.length > 0) {
    reasons.push({
      kind: "shared_object",
      summary: `Grouped by business objects: ${objects.join(", ")}`,
    });
  }
  if (refs.entryRefs.length > 0) {
    reasons.push({
      kind: "shared_entry",
      summary: `${refs.entryRefs.length} entry evidence refs attached.`,
    });
  }
  if (refs.contractRefs.length > 0) {
    reasons.push({
      kind: "shared_table",
      summary: `${refs.contractRefs.length} data contract refs attached.`,
    });
  }
  reasons.push({
    kind: "engineering_signal",
    summary: `scores business=${scores.businessCore.toFixed(2)}, navigation=${scores.navigationNeed.toFixed(2)}, change=${scores.changeActivity.toFixed(2)}`,
  });
  return reasons;
}

function scoreCluster(
  candidates: FunctionCandidate[],
  fileChangeCounts?: Map<string, number>,
): CapabilityClusterScores {
  if (candidates.length === 0) {
    return { businessCore: 0.45, navigationNeed: 0.5, changeActivity: 0 };
  }
  const writeRatio = ratio(
    candidates,
    (candidate) => !READ_ONLY_VERBS.has(candidate.normalizedVerb),
  );
  const stateRatio = ratio(candidates, isStateTransitionCandidate);
  const entryRatio = ratio(candidates, (candidate) =>
    candidate.sourceKinds.includes("entry"),
  );
  const averageRelevance = average(
    candidates.map((candidate) => candidate.relevance),
  );
  const signalCount = candidates.reduce(
    (sum, candidate) => sum + candidate.signals.length,
    0,
  );
  const touchedFiles = dedupe(
    candidates.flatMap((candidate) =>
      candidate.signals.map((signal) => signal.location),
    ),
  );
  const changeCount = touchedFiles.reduce(
    (sum, location) => sum + (fileChangeCounts?.get(location) ?? 0),
    0,
  );

  return {
    businessCore: clamp01(
      averageRelevance * 0.35 +
        entryRatio * 0.2 +
        writeRatio * 0.25 +
        stateRatio * 0.2,
    ),
    navigationNeed: clamp01(
      Math.min(1, signalCount / 8) * 0.35 +
        Math.min(1, touchedFiles.length / 6) * 0.35 +
        Math.min(1, candidates.length / 5) * 0.3,
    ),
    changeActivity: clamp01(Math.min(1, changeCount / 12)),
  };
}

function isStateTransitionCandidate(candidate: FunctionCandidate): boolean {
  const value =
    `${candidate.normalizedVerb} ${candidate.normalizedObject} ${candidate.canonicalName}`.toLowerCase();
  return [...STATE_CHANGE_TERMS].some((term) => value.includes(term));
}

function buildCarrierObjectKey(candidate: FunctionCandidate): string {
  const signalObjectTerms = candidate.signals
    .map((signal) => extractCarrierTerms(signal.name))
    .find((terms) => terms.length > 0);
  const objectTerms = signalObjectTerms?.length
    ? signalObjectTerms
    : candidate.normalizedObject.split(/\s+/).filter(Boolean);
  return stripShortNamespacePrefix(objectTerms)
    .filter((term) => !READ_ONLY_VERBS.has(term))
    .filter((term) => !STATE_CHANGE_TERMS.has(term))
    .join("-");
}

function extractCarrierTerms(name: string): string[] {
  const className = name.split(".")[0] ?? name;
  return className
    .replace(/(Controller|ServiceImpl|Service|Mapper)$/u, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:/\\.-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .filter((term) => !isGenericCarrierTerm(term));
}

function stripShortNamespacePrefix(terms: string[]): string[] {
  if (terms.length <= 1) return terms;
  const [first, ...rest] = terms;
  if (first && first.length >= 2 && first.length <= 4) {
    return rest;
  }
  return terms;
}

function isGenericCarrierTerm(term: string): boolean {
  return [
    "api",
    "app",
    "base",
    "controller",
    "impl",
    "mapper",
    "service",
  ].includes(term);
}

function buildClusterId(
  domainKey: string,
  groupKey: string,
  index: number,
): string {
  return `${domainKey}-${groupKey}-${index + 1}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasTermOverlap(terms: string[], candidateTerms: Set<string>): boolean {
  return terms.some((term) => candidateTerms.has(term));
}

function compareScores(
  left: CapabilityClusterScores,
  right: CapabilityClusterScores,
): number {
  const leftTotal =
    left.businessCore * 0.6 +
    left.navigationNeed * 0.25 +
    left.changeActivity * 0.15;
  const rightTotal =
    right.businessCore * 0.6 +
    right.navigationNeed * 0.25 +
    right.changeActivity * 0.15;
  return leftTotal - rightTotal;
}

function ratio<T>(items: T[], predicate: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(predicate).length / items.length;
}

function average(items: number[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + item, 0) / items.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
