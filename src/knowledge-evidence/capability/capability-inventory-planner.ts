import type { CapabilityInventoryItem } from "../../slicing/capability-inventory.js";
import { writeCapabilityInventoryArtifact } from "../artifact-writer.js";
import { runCapabilityClustering } from "../capability-clustering/index.js";

export async function buildPlannedCapabilityInventory(
  repoRoot: string,
): Promise<{ inventory: CapabilityInventoryItem[]; warnings: string[] }> {
  const clustering = await runCapabilityClustering(repoRoot);
  const inventory = clustering.domains.flatMap((domain) =>
    domain.capabilities.map((cluster) => {
      const evidenceBundle = cluster.evidenceBundle;
      const flowCandidateIds = new Set(cluster.flowCandidateIds);
      return {
        id: cluster.id,
        name: cluster.nameCandidates[0] ?? cluster.id,
        domainKey: domain.domainKey,
        domainName: domain.domainName,
        summary: evidenceBundle.capabilityHints.summaryHint,
        targetTerms: buildTargetTerms([
          ...evidenceBundle.capabilityHints.nameCandidates,
          ...evidenceBundle.capabilityHints.relatedTerms,
        ]).slice(0, 12),
        targetPaths: dedupe([
          ...evidenceBundle.entryPoints.map(
            (entryPoint) => entryPoint.location,
          ),
          ...evidenceBundle.behaviorSlices.map((behavior) => behavior.location),
        ]).slice(0, 12),
        primaryObjects: evidenceBundle.dataContracts
          .filter((contract) => contract.kind === "table")
          .map((contract) => contract.name)
          .slice(0, 6),
        relatedEntities: evidenceBundle.dataContracts
          .map((contract) => contract.name)
          .slice(0, 8),
        functionClusters: [],
        coreFunctionIds: cluster.functionCandidateIds,
        supportingFunctionIds: [],
        evidenceBundle,
        flowCandidates: domain.flows.filter((flow) =>
          flowCandidateIds.has(flow.id),
        ),
      } satisfies CapabilityInventoryItem;
    }),
  );

  await writeCapabilityInventoryArtifact(
    repoRoot,
    inventory,
    clustering.warnings,
  );

  return { inventory, warnings: clustering.warnings };
}

function buildTargetTerms(names: string[]): string[] {
  return dedupe(names.flatMap(splitTerms)).filter(
    (term) => !isGenericCodeTerm(term),
  );
}

function splitTerms(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:/\\.-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 1);
}

function isGenericCodeTerm(term: string): boolean {
  return [
    "api",
    "capability",
    "controller",
    "handler",
    "impl",
    "mapper",
    "module",
    "service",
  ].includes(term);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
