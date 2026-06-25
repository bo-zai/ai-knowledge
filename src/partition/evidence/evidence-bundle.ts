import type {
  EvidenceAtom,
  EvidenceRef,
  EvidenceSourceKind,
} from "./evidence-atom.js";

export interface EvidenceBundleSourceSummary {
  sourceKind: EvidenceSourceKind;
  atomCount: number;
  collectedAt?: string;
  version?: string;
}

export interface EvidenceBundleStats {
  totalAtoms: number;
  atomCountByKind: Partial<Record<EvidenceAtom["atomKind"], number>>;
  atomCountBySource: Partial<Record<EvidenceSourceKind, number>>;
}

export interface EvidenceBundleContainer {
  bundleId: string;
  repoPath: string;
  version: string;
  createdAt: string;
  atoms: EvidenceAtom[];
  sourceSummaries: EvidenceBundleSourceSummary[];
  stats?: EvidenceBundleStats;
  metadata?: Record<string, unknown>;
}

export interface EvidenceBundleView {
  bundle: EvidenceBundleContainer;
  atomIndex: Record<string, EvidenceAtom>;
}

export interface EvidenceBundleSelection {
  bundleId: string;
  evidenceRefs: EvidenceRef[];
  reason?: string;
}
