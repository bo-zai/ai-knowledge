import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";
import type { PartitionEvidenceScope } from "./types.js";

export function matchGroupToScope(
  group: EvidenceGroup,
  scopes: PartitionEvidenceScope[],
): PartitionEvidenceScope | undefined {
  return scopes
    .map((scope) => ({
      scope,
      score: scoreGroupScopeMatch(group, scope),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.scope;
}

export function evidencePathMatchesScope(
  evidencePath: string | undefined,
  scope: PartitionEvidenceScope,
): boolean {
  if (!evidencePath) {
    return false;
  }
  const normalizedEvidencePath = normalizePath(evidencePath);
  return scope.evidenceLocations.some((location) => {
    const normalizedLocation = normalizePath(location);
    return (
      normalizedEvidencePath === normalizedLocation ||
      normalizedEvidencePath.endsWith(`/${normalizedLocation}`) ||
      normalizedEvidencePath.startsWith(`${normalizedLocation}/`) ||
      normalizedEvidencePath.includes(`/${normalizedLocation}/`)
    );
  });
}

function scoreGroupScopeMatch(
  group: EvidenceGroup,
  scope: PartitionEvidenceScope,
): number {
  let score = 0;
  for (const entryPoint of group.bundle.entryPoints) {
    if (evidencePathMatchesScope(entryPoint.location, scope)) {
      score += 6;
    }
  }
  for (const contract of group.bundle.dataContracts) {
    if (evidencePathMatchesScope(contract.location, scope)) {
      score += 5;
    }
    if (scope.evidenceNames.includes(contract.name)) {
      score += 4;
    }
  }
  for (const behavior of group.bundle.behaviorSlices) {
    if (evidencePathMatchesScope(behavior.location, scope)) {
      score += 3;
    }
  }
  for (const moduleSurface of group.bundle.moduleSurfaces) {
    if (evidencePathMatchesScope(moduleSurface.rootPath, scope)) {
      score += 2;
    }
  }
  return score;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}
