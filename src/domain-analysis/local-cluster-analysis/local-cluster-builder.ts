import type {
  CandidateProfile,
  CandidateProfileType,
  DomainEvidenceBundle,
  LocalAnalysisCluster,
  LocalAnalysisClusterBoundary,
} from "../types.js";

const MIN_INTERNAL_EDGE_SCORE = 2;
const MIN_BOUNDARY_SCORE = 2;
const STRONG_EDGE_SCORE = 4;
const BRIDGE_BLOCKING_TYPES: CandidateProfileType[] = [
  "aggregator",
  "infrastructure",
  "ambiguous",
];
const WEAK_BUSINESS_TYPES: CandidateProfileType[] = ["support-business"];

export function buildLocalAnalysisClusters(
  evidenceBundle: DomainEvidenceBundle,
  profiles: CandidateProfile[],
): LocalAnalysisCluster[] {
  const profileMap = new Map(
    profiles.map((profile) => [profile.candidateId, profile]),
  );
  const adjacency = new Map<string, Set<string>>();

  for (const candidate of evidenceBundle.candidates) {
    adjacency.set(candidate.candidateId, new Set<string>());
  }

  for (const entry of evidenceBundle.dependencyMatrix) {
    if (entry.relationScore < MIN_INTERNAL_EDGE_SCORE) {
      continue;
    }

    const sourceProfile = profileMap.get(entry.sourceCandidateId);
    const targetProfile = profileMap.get(entry.targetCandidateId);
    if (
      !shouldConnectCandidates(
        sourceProfile,
        targetProfile,
        entry.relationScore,
        entry.relationReasons,
      )
    ) {
      continue;
    }

    adjacency.get(entry.sourceCandidateId)?.add(entry.targetCandidateId);
    adjacency.get(entry.targetCandidateId)?.add(entry.sourceCandidateId);
  }

  const visited = new Set<string>();
  const clusters: LocalAnalysisCluster[] = [];

  for (const candidate of evidenceBundle.candidates) {
    if (visited.has(candidate.candidateId)) {
      continue;
    }

    const candidateIds = walkComponent(
      candidate.candidateId,
      adjacency,
      visited,
    );
    const clusterId = `cluster_${clusters.length + 1}`;
    clusters.push({
      clusterId,
      candidateIds: candidateIds.sort(),
      boundarySignals: [],
      clusterReason: describeClusterReason(candidateIds, profileMap),
    });
  }

  const clusterByCandidateId = new Map<string, string>();
  for (const cluster of clusters) {
    for (const candidateId of cluster.candidateIds) {
      clusterByCandidateId.set(candidateId, cluster.clusterId);
    }
  }

  for (const cluster of clusters) {
    cluster.boundarySignals = buildClusterBoundaries(
      cluster,
      clusters,
      clusterByCandidateId,
      evidenceBundle,
    );
  }

  return clusters;
}

function shouldConnectCandidates(
  sourceProfile: CandidateProfile | undefined,
  targetProfile: CandidateProfile | undefined,
  relationScore: number,
  relationReasons: string[],
): boolean {
  const sourceType = sourceProfile?.profileType;
  const targetType = targetProfile?.profileType;
  const sourceIsBridgeBlocking = isBridgeBlockingType(sourceType);
  const targetIsBridgeBlocking = isBridgeBlockingType(targetType);

  if (!sourceType || !targetType) {
    return relationScore >= STRONG_EDGE_SCORE;
  }

  if (sourceType === "core-business" && targetType === "core-business") {
    return relationScore >= MIN_INTERNAL_EDGE_SCORE;
  }

  if (sourceIsBridgeBlocking || targetIsBridgeBlocking) {
    return (
      relationScore >= STRONG_EDGE_SCORE &&
      hasStructuralEvidence(relationReasons)
    );
  }

  if (isWeakBusinessType(sourceType) || isWeakBusinessType(targetType)) {
    return (
      relationScore >= MIN_INTERNAL_EDGE_SCORE + 1 &&
      hasBusinessEvidence(relationReasons)
    );
  }

  return relationScore >= MIN_INTERNAL_EDGE_SCORE;
}

function isBridgeBlockingType(
  profileType: CandidateProfileType | undefined,
): boolean {
  return profileType ? BRIDGE_BLOCKING_TYPES.includes(profileType) : false;
}

function isWeakBusinessType(
  profileType: CandidateProfileType | undefined,
): boolean {
  return profileType ? WEAK_BUSINESS_TYPES.includes(profileType) : false;
}

function hasStructuralEvidence(relationReasons: string[]): boolean {
  return relationReasons.some((reason) => {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes("shared core table") ||
      normalized.includes("table relation") ||
      normalized.includes("merge affinity")
    );
  });
}

function hasBusinessEvidence(relationReasons: string[]): boolean {
  return relationReasons.some((reason) => {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes("merge affinity") ||
      normalized.includes("shared business term") ||
      normalized.includes("shared core table") ||
      normalized.includes("table relation")
    );
  });
}

function walkComponent(
  startCandidateId: string,
  adjacency: Map<string, Set<string>>,
  visited: Set<string>,
): string[] {
  const stack = [startCandidateId];
  const component: string[] = [];

  while (stack.length > 0) {
    const candidateId = stack.pop();
    if (!candidateId || visited.has(candidateId)) {
      continue;
    }

    visited.add(candidateId);
    component.push(candidateId);

    for (const neighbor of adjacency.get(candidateId) ?? []) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return component;
}

function describeClusterReason(
  candidateIds: string[],
  profileMap: Map<string, CandidateProfile>,
): string {
  const types = [
    ...new Set(
      candidateIds
        .map((candidateId) => profileMap.get(candidateId)?.profileType)
        .filter((profileType) => Boolean(profileType)),
    ),
  ];

  return types.length > 0
    ? `connected-component:${types.join(",")}`
    : "connected-component";
}

function buildClusterBoundaries(
  cluster: LocalAnalysisCluster,
  clusters: LocalAnalysisCluster[],
  clusterByCandidateId: Map<string, string>,
  evidenceBundle: DomainEvidenceBundle,
): LocalAnalysisClusterBoundary[] {
  const clusterCandidateIds = new Set(cluster.candidateIds);
  const boundaries = new Map<string, LocalAnalysisClusterBoundary>();

  for (const entry of evidenceBundle.dependencyMatrix) {
    const sourceInside = clusterCandidateIds.has(entry.sourceCandidateId);
    const targetInside = clusterCandidateIds.has(entry.targetCandidateId);
    if (sourceInside === targetInside) {
      continue;
    }
    if (entry.relationScore < MIN_BOUNDARY_SCORE) {
      continue;
    }

    const outerCandidateId = sourceInside
      ? entry.targetCandidateId
      : entry.sourceCandidateId;
    const targetClusterId = clusterByCandidateId.get(outerCandidateId);
    if (!targetClusterId || targetClusterId === cluster.clusterId) {
      continue;
    }

    const existing = boundaries.get(targetClusterId);
    if (!existing) {
      boundaries.set(targetClusterId, {
        targetClusterId,
        relatedCandidateIds: [outerCandidateId],
        relationScore: entry.relationScore,
        relationReasons: [...entry.relationReasons],
      });
      continue;
    }

    existing.relatedCandidateIds = [
      ...new Set([...existing.relatedCandidateIds, outerCandidateId]),
    ];
    existing.relationScore = Math.max(
      existing.relationScore,
      entry.relationScore,
    );
    existing.relationReasons = [
      ...new Set([...existing.relationReasons, ...entry.relationReasons]),
    ];
  }

  return [...boundaries.values()]
    .sort((left, right) => right.relationScore - left.relationScore)
    .map((boundary) => ({
      ...boundary,
      relatedCandidateIds: boundary.relatedCandidateIds.sort(),
      relationReasons: boundary.relationReasons.slice(0, 12),
    }));
}
