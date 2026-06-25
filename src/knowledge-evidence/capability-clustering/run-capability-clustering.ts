import { loadDomainRegistry } from "../../packaging/domain-registry.js";
import { buildCapabilityEvidenceGroup } from "../capability/capability-evidence-planner.js";
import { loadPartitionEvidence } from "../partition-provider.js";
import type { PartitionEvidenceScope } from "../types.js";
import { writeCapabilityClusteringArtifacts } from "./artifact-writer.js";
import { buildDomainCapabilityClusters } from "./clusterer.js";
import { collectRecentFileChangeCounts } from "./engineering-signal-extractor.js";
import type {
  CapabilityClusteringResult,
  DomainCapabilityClusteringResult,
} from "./types.js";

export async function runCapabilityClustering(
  repoRoot: string,
): Promise<CapabilityClusteringResult> {
  const partitionEvidence = await loadPartitionEvidence(repoRoot);
  if (!partitionEvidence.available) {
    const result = {
      generatedAt: new Date().toISOString(),
      domains: [],
      warnings: partitionEvidence.warnings,
    };
    await writeCapabilityClusteringArtifacts(repoRoot, result);
    return result;
  }

  const registry = await loadDomainRegistryOrEmpty(repoRoot);
  const fileChangeCounts = await collectRecentFileChangeCounts({
    repoRoot,
    filePaths: collectEvidenceFilePaths(partitionEvidence.scopes),
  });
  const domains = partitionEvidence.scopes
    .filter((scope) => scope.hasCapabilityEvidence)
    .map((scope) =>
      buildDomainResult({
        scope,
        registry,
        fileChangeCounts,
      }),
    );

  const result = {
    generatedAt: new Date().toISOString(),
    domains,
    warnings: partitionEvidence.warnings,
  };
  await writeCapabilityClusteringArtifacts(repoRoot, result);
  return result;
}

function buildDomainResult(input: {
  scope: PartitionEvidenceScope;
  registry: Map<string, { domainName: string; summaryZh?: string }>;
  fileChangeCounts: Map<string, number>;
}): DomainCapabilityClusteringResult {
  const baseBundle = buildCapabilityEvidenceGroup(
    "repository",
    input.scope,
  ).bundle;
  const primaryObjects = input.scope.partition.tables
    .filter((table) => table.role === "primary")
    .map((table) => table.tableName);
  const domainKey = normalizeId(
    primaryObjects[0] ?? input.scope.partition.partitionId,
  );
  const registryDomain = input.registry.get(domainKey);

  return buildDomainCapabilityClusters({
    domainKey,
    domainName:
      registryDomain?.domainName ??
      buildInventoryName(input.scope.partition.partitionId),
    partitionId: input.scope.partition.partitionId,
    bundle: baseBundle,
    fileChangeCounts: input.fileChangeCounts,
  });
}

async function loadDomainRegistryOrEmpty(
  repoRoot: string,
): Promise<Map<string, { domainName: string; summaryZh?: string }>> {
  try {
    const registry = await loadDomainRegistry(repoRoot);
    return new Map(
      registry.domains.map((domain) => [
        domain.domainKey,
        {
          domainName: domain.domainName,
          summaryZh: domain.concept?.summaryZh,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

function collectEvidenceFilePaths(scopes: PartitionEvidenceScope[]): string[] {
  return [
    ...scopes.flatMap((scope) =>
      scope.partition.entryPoints.map((entryPoint) => entryPoint.filePath),
    ),
    ...scopes.flatMap((scope) =>
      (scope.partition.sharedResources?.coreLogic ?? []).map(
        (service) => service.filePath,
      ),
    ),
    ...scopes.flatMap((scope) =>
      (scope.partition.sharedResources?.dataLayer ?? []).map(
        (mapper) => mapper.filePath,
      ),
    ),
  ];
}

function buildInventoryName(partitionId: string): string {
  return partitionId
    .replace(/^domain:|^capability:/, "")
    .replace(/[_:-]+/g, " ");
}

function normalizeId(value: string): string {
  return value
    .replace(/^domain:|^capability:/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
