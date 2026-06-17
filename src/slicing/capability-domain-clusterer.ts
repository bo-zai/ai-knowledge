import type { FunctionCluster } from "./function-clusterer.js";

export interface CapabilityDomainCandidate {
  id: string;
  nameHint: string;
  summary: string;
  targetTerms: string[];
  targetPaths: string[];
  primaryObjects: string[];
  relatedEntities: string[];
  functionClusters: FunctionCluster[];
  coreFunctionIds: string[];
  supportingFunctionIds: string[];
}

function titleCase(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

const DOMAIN_STOP_TERMS = new Set([
  "abstract",
  "api",
  "callback",
  "cloud",
  "config",
  "controller",
  "detail",
  "download",
  "execute",
  "ffmpeg",
  "file",
  "health",
  "info",
  "internal",
  "job",
  "li",
  "list",
  "page",
  "query",
  "scheduler",
  "service",
  "task",
  "template",
  "test",
  "upload",
  "workflow",
  "wx",
]);

function scoreDomainTerm(term: string, cluster: FunctionCluster): number {
  let score = 0;
  if (term === cluster.normalizedObject) score += 3;
  if (cluster.domainTerms.includes(term)) score += 2;
  if (cluster.isCore) score += 2;
  if (cluster.normalizedVerb !== "query") score += 1;
  if (DOMAIN_STOP_TERMS.has(term)) score -= 10;
  return score;
}

function pickDomainTerm(cluster: FunctionCluster): string | undefined {
  const candidates = dedupe([cluster.normalizedObject, ...cluster.domainTerms])
    .filter((term) => term.length > 1)
    .map((term) => ({ term, score: scoreDomainTerm(term, cluster) }))
    .sort((left, right) => right.score - left.score);

  return candidates.find((candidate) => candidate.score > 0)?.term;
}

function deriveDomainKey(cluster: FunctionCluster): string {
  return pickDomainTerm(cluster) ?? cluster.normalizedObject;
}

function deriveNameHint(key: string, clusters: FunctionCluster[]): string {
  const objectTerm = key || clusters[0]?.normalizedObject || "domain";
  return `${titleCase(objectTerm)} Management`;
}

function buildSummary(nameHint: string, clusters: FunctionCluster[]): string {
  const actions = clusters
    .filter((cluster) => cluster.isCore)
    .slice(0, 4)
    .map((cluster) => cluster.canonicalName)
    .join("、");
  return actions.length > 0
    ? `${nameHint} 主要覆盖 ${actions} 等业务动作。`
    : `${nameHint} 由多个相关业务动作共同组成。`;
}

function collectTargetPaths(clusters: FunctionCluster[]): string[] {
  return dedupe(
    clusters.flatMap((cluster) =>
      cluster.signals.map((signal) => signal.location),
    ),
  ).slice(0, 12);
}

function collectTargetTerms(
  clusters: FunctionCluster[],
  nameHint: string,
): string[] {
  const raw = clusters.flatMap((cluster) => [
    cluster.normalizedObject,
    ...cluster.domainTerms,
    ...cluster.signals.flatMap((signal) => signal.matchedTerms),
  ]);
  const words = nameHint.toLowerCase().split(/\s+/).filter(Boolean);
  return dedupe([...raw, ...words])
    .filter((term) => term.length > 1)
    .slice(0, 12);
}

export function buildCapabilityDomainCandidates(
  functionClusters: FunctionCluster[],
): CapabilityDomainCandidate[] {
  const grouped = new Map<string, FunctionCluster[]>();

  for (const cluster of functionClusters) {
    const key = deriveDomainKey(cluster);
    if (DOMAIN_STOP_TERMS.has(key)) continue;
    const current = grouped.get(key) ?? [];
    current.push(cluster);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, clusters]) => {
      const nameHint = deriveNameHint(key, clusters);
      const coreClusters = clusters.filter((cluster) => cluster.isCore);
      const supportingClusters = clusters.filter((cluster) => !cluster.isCore);

      return {
        id: key.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        nameHint,
        summary: buildSummary(nameHint, clusters),
        targetTerms: collectTargetTerms(clusters, nameHint),
        targetPaths: collectTargetPaths(clusters),
        primaryObjects: dedupe(
          clusters.map((cluster) => cluster.normalizedObject),
        ).slice(0, 6),
        relatedEntities: dedupe(
          clusters.flatMap((cluster) => cluster.domainTerms),
        ).slice(0, 8),
        functionClusters: clusters,
        coreFunctionIds: coreClusters.map((cluster) => cluster.clusterId),
        supportingFunctionIds: supportingClusters.map(
          (cluster) => cluster.clusterId,
        ),
      };
    })
    .filter(
      (candidate) =>
        candidate.primaryObjects.some((term) => !DOMAIN_STOP_TERMS.has(term)) &&
        candidate.functionClusters.some(
          (cluster) => cluster.isCore && cluster.normalizedVerb !== "query",
        ),
    )
    .sort((left, right) => {
      const coreDiff =
        right.coreFunctionIds.length - left.coreFunctionIds.length;
      if (coreDiff !== 0) return coreDiff;
      return right.functionClusters.length - left.functionClusters.length;
    })
    .slice(0, 15);
}
