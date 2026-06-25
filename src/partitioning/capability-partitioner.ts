import { createHash } from "crypto";
import type { ModuleTopology } from "../module/index.js";
import type { DomainPartition, PartitionIndex, TraceResult } from "./types.js";

export interface CapabilityPartitioningInput {
  repoPath: string;
  moduleTopology: ModuleTopology;
}

export function buildCapabilityPartitions(
  input: CapabilityPartitioningInput,
): DomainPartition[] {
  const partitions: DomainPartition[] = [];

  for (const module of input.moduleTopology.modules) {
    const moduleKey = sanitizePartitionKey(module.name);
    partitions.push({
      partitionId: `capability:${moduleKey}`,
      partitionHash: createStableHash({
        module: module.name,
        role: module.role,
        type: module.type,
        dependencies: module.dependencies,
      }),
      algorithmVersion: "3.0.0-capability",
      tables: [],
      entryPoints: [],
      sharedResources: undefined,
      backendModules: [
        {
          name: module.name,
          path: module.path,
          role:
            module.role === "deployable"
              ? "entry_and_logic_provider"
              : "logic_provider",
        },
      ],
      confidenceBreakdown: {
        traceDepth: 0.2,
        crossModule: module.dependencies.length > 0 ? 0.1 : 0,
      },
      domainKeywords: [module.name],
      contentHash: createStableHash({
        path: module.path,
        dependencies: module.dependencies,
      }),
      lastCommitHash: "",
      updatedAt: new Date().toISOString(),
    });
  }

  return partitions;
}

function sanitizePartitionKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createStableHash(content: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16)}`;
}
