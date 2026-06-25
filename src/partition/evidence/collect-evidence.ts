import type { DomainClusterInput } from "../../partitioning/types.js";
import {
  createCodeEntrySource,
  createCommitSource,
  createDatabaseDdlSource,
  createDatabaseInstanceSource,
  createMapperSqlSource,
  createProjectDocSource,
  createSchemaSource,
  createServiceCallSource,
  type EvidenceSource,
  type EvidenceSourceCollectionResult,
} from "./sources/index.js";
import {
  normalizeEvidence,
  type NormalizeEvidenceResult,
} from "./normalize-evidence.js";
import type {
  EvidenceBundleContainer,
  EvidenceCollectionContext,
} from "./types.js";

export interface CollectEvidenceOptions {
  sources?: EvidenceSource[];
  version?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CollectEvidenceResult extends NormalizeEvidenceResult {
  sourceResults: EvidenceSourceCollectionResult[];
}

export async function collectEvidence(
  clusterInput: DomainClusterInput,
  context: EvidenceCollectionContext,
  options: CollectEvidenceOptions = {},
): Promise<CollectEvidenceResult> {
  const sources = options.sources ?? createDefaultEvidenceSources();
  const sourceResults: EvidenceSourceCollectionResult[] = [];

  for (const source of sources) {
    const sourceResult = await source.collect(clusterInput, context);
    sourceResults.push({
      ...sourceResult,
      metadata: {
        ...sourceResult.metadata,
        collectedAt: options.createdAt ?? new Date().toISOString(),
      },
    });
  }

  const atoms = sourceResults.flatMap((sourceResult) => sourceResult.atoms);
  const normalized = normalizeEvidence({
    repoPath: context.repoPath,
    atoms,
    sourceResults,
    version: options.version,
    createdAt: options.createdAt,
    metadata: buildCollectorMetadata(clusterInput, context, options, sources),
  });

  return {
    ...normalized,
    sourceResults,
  };
}

export function createDefaultEvidenceSources(): EvidenceSource[] {
  return [
    createCodeEntrySource(),
    createServiceCallSource(),
    createMapperSqlSource(),
    createSchemaSource(),
    createCommitSource(),
    createProjectDocSource(),
    createDatabaseDdlSource(),
    createDatabaseInstanceSource(),
  ];
}

export function createEvidenceBundleView(
  bundle: EvidenceBundleContainer,
): EvidenceBundleContainer {
  return bundle;
}

function buildCollectorMetadata(
  clusterInput: DomainClusterInput,
  context: EvidenceCollectionContext,
  options: CollectEvidenceOptions,
  sources: EvidenceSource[],
): Record<string, unknown> {
  return {
    ...context.metadata,
    ...options.metadata,
    candidateCount: clusterInput.candidates.length,
    sourceNames: sources.map((source) => source.sourceName),
    projectModuleName: context.analysisContext?.projectContext.moduleName,
  };
}
