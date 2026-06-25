import {
  deriveEvidenceSignals,
  type EvidenceSignals,
} from "./derive-evidence-signals.js";
import type {
  EvidenceAtom,
  EvidenceBundleContainer,
  EvidenceBundleSourceSummary,
  EvidenceBundleStats,
} from "./types.js";
import type { EvidenceSourceCollectionResult } from "./sources/index.js";

export interface NormalizeEvidenceInput {
  repoPath: string;
  atoms: EvidenceAtom[];
  sourceResults: EvidenceSourceCollectionResult[];
  version?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizeEvidenceResult {
  bundle: EvidenceBundleContainer;
  duplicateAtomIds: string[];
  signals: EvidenceSignals;
}

const EVIDENCE_BUNDLE_VERSION = "1";

export function normalizeEvidence(
  input: NormalizeEvidenceInput,
): NormalizeEvidenceResult {
  const dedupedAtoms = deduplicateAtoms(input.atoms);
  const sortedAtoms = [...dedupedAtoms.uniqueAtoms].sort(compareAtoms);
  const sourceSummaries = buildSourceSummaries(
    input.sourceResults,
    sortedAtoms,
  );
  const stats = buildBundleStats(sortedAtoms);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const bundle: EvidenceBundleContainer = {
    bundleId: buildBundleId(input.repoPath, createdAt),
    repoPath: input.repoPath,
    version: input.version ?? EVIDENCE_BUNDLE_VERSION,
    createdAt,
    atoms: sortedAtoms,
    sourceSummaries,
    stats,
    metadata: {
      ...input.metadata,
      normalization: {
        duplicateAtomIds: dedupedAtoms.duplicateAtomIds,
        sourceCount: input.sourceResults.length,
      },
    },
  };

  const signals = deriveEvidenceSignals(bundle);
  bundle.metadata = {
    ...bundle.metadata,
    derivedSignals: signals,
  };

  return {
    bundle,
    duplicateAtomIds: dedupedAtoms.duplicateAtomIds,
    signals,
  };
}

function deduplicateAtoms(atoms: EvidenceAtom[]): {
  uniqueAtoms: EvidenceAtom[];
  duplicateAtomIds: string[];
} {
  const uniqueAtoms: EvidenceAtom[] = [];
  const duplicateAtomIds: string[] = [];
  const atomKeys = new Map<string, string>();

  for (const atom of atoms) {
    const atomKey = buildAtomFingerprint(atom);
    const existingId = atomKeys.get(atomKey);
    if (existingId) {
      duplicateAtomIds.push(atom.id);
      continue;
    }

    atomKeys.set(atomKey, atom.id);
    uniqueAtoms.push({
      ...atom,
      subjects: [...atom.subjects].sort(compareSubjects),
      locations: [...atom.locations].sort(compareLocations),
      tags: atom.tags
        ? [...new Set(atom.tags)].sort((left, right) =>
            left.localeCompare(right),
          )
        : undefined,
    });
  }

  return {
    uniqueAtoms,
    duplicateAtomIds: duplicateAtomIds.sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function buildSourceSummaries(
  sourceResults: EvidenceSourceCollectionResult[],
  atoms: EvidenceAtom[],
): EvidenceBundleSourceSummary[] {
  const atomCountBySource = new Map<string, number>();
  for (const atom of atoms) {
    atomCountBySource.set(
      atom.sourceKind,
      (atomCountBySource.get(atom.sourceKind) ?? 0) + 1,
    );
  }

  return [...sourceResults]
    .map((sourceResult) => ({
      sourceKind: sourceResult.sourceKind,
      atomCount: atomCountBySource.get(sourceResult.sourceKind) ?? 0,
      collectedAt: readStringMetadata(sourceResult.metadata, "collectedAt"),
      version: readStringMetadata(sourceResult.metadata, "version"),
    }))
    .sort((left, right) => left.sourceKind.localeCompare(right.sourceKind));
}

function buildBundleStats(atoms: EvidenceAtom[]): EvidenceBundleStats {
  const atomCountByKind = new Map<EvidenceAtom["atomKind"], number>();
  const atomCountBySource = new Map<EvidenceAtom["sourceKind"], number>();

  for (const atom of atoms) {
    atomCountByKind.set(
      atom.atomKind,
      (atomCountByKind.get(atom.atomKind) ?? 0) + 1,
    );
    atomCountBySource.set(
      atom.sourceKind,
      (atomCountBySource.get(atom.sourceKind) ?? 0) + 1,
    );
  }

  return {
    totalAtoms: atoms.length,
    atomCountByKind: Object.fromEntries(
      [...atomCountByKind.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    atomCountBySource: Object.fromEntries(
      [...atomCountBySource.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function buildBundleId(repoPath: string, createdAt: string): string {
  return `bundle:${repoPath}:${createdAt}`;
}

function buildAtomFingerprint(atom: EvidenceAtom): string {
  return JSON.stringify({
    atomKind: atom.atomKind,
    sourceKind: atom.sourceKind,
    summary: atom.summary,
    subjects: [...atom.subjects].sort(compareSubjects),
    attributes: sortUnknown(atom.attributes),
    confidence: atom.confidence,
    locations: [...atom.locations].sort(compareLocations),
    tags: atom.tags
      ? [...new Set(atom.tags)].sort((left, right) => left.localeCompare(right))
      : [],
  });
}

function sortUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortUnknown);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortUnknown(nestedValue)]),
    );
  }
  return value;
}

function compareAtoms(left: EvidenceAtom, right: EvidenceAtom): number {
  return (
    left.sourceKind.localeCompare(right.sourceKind) ||
    left.atomKind.localeCompare(right.atomKind) ||
    left.id.localeCompare(right.id)
  );
}

function compareSubjects(
  left: EvidenceAtom["subjects"][number],
  right: EvidenceAtom["subjects"][number],
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id) ||
    left.name.localeCompare(right.name)
  );
}

function compareLocations(
  left: EvidenceAtom["locations"][number],
  right: EvidenceAtom["locations"][number],
): number {
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.column ?? 0) - (right.column ?? 0) ||
    (left.snippet ?? "").localeCompare(right.snippet ?? "")
  );
}

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
