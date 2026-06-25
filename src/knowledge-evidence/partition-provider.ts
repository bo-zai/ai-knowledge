import fs from "fs/promises";
import path from "path";
import { getStoragePaths } from "../engine/storage/repo-manager.js";
import type { DomainPartition, PartitionIndex } from "../partitioning/types.js";
import type {
  PartitionEvidenceLoadResult,
  PartitionEvidenceScope,
} from "./types.js";

export async function loadPartitionEvidence(
  repoPath: string,
): Promise<PartitionEvidenceLoadResult> {
  const { storagePath } = getStoragePaths(repoPath);
  const partitionDir = path.join(storagePath, "partitions");
  const indexPath = path.join(partitionDir, "_index.json");
  const warnings: string[] = [];

  let index: PartitionIndex;
  try {
    index = JSON.parse(await fs.readFile(indexPath, "utf-8")) as PartitionIndex;
  } catch {
    return {
      available: false,
      repoPath,
      scopes: [],
      warnings: [`partition_index_not_found:${indexPath}`],
    };
  }

  const scopes: PartitionEvidenceScope[] = [];
  const seenPartitionIds = new Set<string>();
  for (const entry of index.partitions) {
    const filePath = path.join(partitionDir, entry.file);
    try {
      const partition = normalizePartition(
        JSON.parse(
          await fs.readFile(filePath, "utf-8"),
        ) as Partial<DomainPartition>,
      );
      if (seenPartitionIds.has(partition.partitionId)) {
        warnings.push(`partition_duplicate_skipped:${partition.partitionId}`);
        continue;
      }
      seenPartitionIds.add(partition.partitionId);
      scopes.push(
        createPartitionEvidenceScope(partition, index.partitionMode, entry),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`partition_read_failed:${entry.file}:${message}`);
    }
  }

  return {
    available: scopes.length > 0,
    repoPath,
    partitionMode: index.partitionMode,
    index,
    scopes,
    warnings,
  };
}

function normalizePartition(
  partition: Partial<DomainPartition>,
): DomainPartition {
  return {
    partitionId: partition.partitionId ?? "unknown",
    partitionHash: partition.partitionHash ?? "",
    algorithmVersion: partition.algorithmVersion ?? "",
    tables: partition.tables ?? [],
    entryPoints: partition.entryPoints ?? [],
    sharedResources: partition.sharedResources,
    backendModules: partition.backendModules ?? [],
    frontend: partition.frontend,
    frontendBackendLinks: partition.frontendBackendLinks,
    noEntryTables: partition.noEntryTables,
    confidenceBreakdown: partition.confidenceBreakdown ?? { traceDepth: 0 },
    crossDomainRefs: partition.crossDomainRefs,
    domainKeywords: partition.domainKeywords,
    contentHash: partition.contentHash ?? "",
    fileHashes: partition.fileHashes,
    lastCommitHash: partition.lastCommitHash ?? "",
    updatedAt: partition.updatedAt ?? "",
  };
}

function createPartitionEvidenceScope(
  partition: DomainPartition,
  partitionMode: string | undefined,
  indexEntry: PartitionIndex["partitions"][number],
): PartitionEvidenceScope {
  const evidenceLocations = collectEvidenceLocations(partition);
  const evidenceNames = collectEvidenceNames(partition);
  const tableCount =
    partition.tables.length + (partition.noEntryTables?.length ?? 0);
  const entityCount = partition.sharedResources?.entities?.length ?? 0;
  const entryCount = partition.entryPoints.length;

  return {
    partition,
    partitionMode,
    indexEntry,
    evidenceLocations,
    evidenceNames,
    hasConceptEvidence: tableCount > 0 || entityCount > 0,
    hasCapabilityEvidence:
      entryCount > 0 ||
      (partitionMode === "capability-domain" &&
        partition.backendModules.length > 0),
  };
}

function collectEvidenceLocations(partition: DomainPartition): string[] {
  return dedupe(
    [
      ...partition.entryPoints.map((entryPoint) => entryPoint.filePath),
      ...(partition.sharedResources?.coreLogic?.map((item) => item.filePath) ??
        []),
      ...(partition.sharedResources?.dataLayer?.flatMap((item) => [
        item.filePath,
        item.xmlPath ?? "",
      ]) ?? []),
      ...(partition.sharedResources?.entities?.map((item) => item.filePath) ??
        []),
      ...partition.backendModules.map((item) => item.path),
    ].filter(Boolean),
  );
}

function collectEvidenceNames(partition: DomainPartition): string[] {
  return dedupe(
    [
      partition.partitionId,
      ...partition.tables.map((table) => table.tableName),
      ...(partition.noEntryTables?.map((table) => table.tableName) ?? []),
      ...partition.entryPoints.flatMap((entryPoint) => [
        entryPoint.className,
        entryPoint.methodName,
      ]),
      ...(partition.sharedResources?.coreLogic?.map((item) => item.className) ??
        []),
      ...(partition.sharedResources?.dataLayer?.map((item) => item.className) ??
        []),
      ...(partition.sharedResources?.entities?.map((item) => item.className) ??
        []),
      ...partition.backendModules.map((item) => item.name),
    ].filter(Boolean),
  );
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
