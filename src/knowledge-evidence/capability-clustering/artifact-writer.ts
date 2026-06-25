import fs from "fs/promises";
import path from "path";
import type {
  CapabilityClusteringResult,
  DomainCapabilityClusteringResult,
} from "./types.js";

export async function writeCapabilityClusteringArtifacts(
  repoRoot: string,
  result: CapabilityClusteringResult,
): Promise<void> {
  const outputRoot = path.join(
    repoRoot,
    "ai-knowledge",
    ".internal",
    "capability-clustering",
  );
  const domainsDir = path.join(outputRoot, "domains");
  await fs.mkdir(domainsDir, { recursive: true });

  for (const domain of result.domains) {
    await fs.writeFile(
      path.join(domainsDir, `${domain.domainKey}.json`),
      JSON.stringify(summarizeDomainForArtifact(domain), null, 2) + "\n",
      "utf-8",
    );
  }

  await fs.writeFile(
    path.join(outputRoot, "_index.json"),
    JSON.stringify(
      {
        generatedAt: result.generatedAt,
        warnings: result.warnings,
        domains: result.domains.map((domain) => ({
          domainKey: domain.domainKey,
          domainName: domain.domainName,
          partitionId: domain.partitionId,
          capabilityCount: domain.capabilities.length,
          flowCount: domain.flows.length,
          file: `domains/${domain.domainKey}.json`,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

function summarizeDomainForArtifact(
  domain: DomainCapabilityClusteringResult,
): Omit<DomainCapabilityClusteringResult, "capabilities"> & {
  capabilities: Array<
    Omit<
      DomainCapabilityClusteringResult["capabilities"][number],
      "evidenceBundle"
    > & {
      evidenceBundleSummary: {
        entryPointCount: number;
        behaviorCount: number;
        contractCount: number;
        moduleCount: number;
        functionCandidateCount: number;
      };
    }
  >;
} {
  return {
    ...domain,
    capabilities: domain.capabilities
      .map((capability) => ({
        ...capability,
        evidenceBundle: undefined,
        evidenceBundleSummary: {
          entryPointCount: capability.evidenceBundle.entryPoints.length,
          behaviorCount: capability.evidenceBundle.behaviorSlices.length,
          contractCount: capability.evidenceBundle.dataContracts.length,
          moduleCount: capability.evidenceBundle.moduleSurfaces.length,
          functionCandidateCount:
            capability.evidenceBundle.functionCandidates?.length ?? 0,
        },
      }))
      .map(({ evidenceBundle: _evidenceBundle, ...capability }) => capability),
  };
}
