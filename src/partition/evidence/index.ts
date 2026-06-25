export type {
  EvidenceAtom,
  EvidenceAtomKind,
  EvidenceLocation,
  EvidenceRef,
  EvidenceSourceKind,
  EvidenceSubjectKind,
  EvidenceSubjectRef,
  EvidenceBundleContainer,
  EvidenceBundleSelection,
  EvidenceBundleSourceSummary,
  EvidenceBundleStats,
  EvidenceBundleView,
  LegacyDomainEvidenceBridge,
  EvidenceCollectionContext,
  EvidenceBundleBridgeInput,
  EvidenceBridgeResult,
} from "./types.js";

export {
  collectEvidence,
  createDefaultEvidenceSources,
  type CollectEvidenceOptions,
  type CollectEvidenceResult,
} from "./collect-evidence.js";

export {
  normalizeEvidence,
  type NormalizeEvidenceInput,
  type NormalizeEvidenceResult,
} from "./normalize-evidence.js";

export {
  deriveEvidenceSignals,
  type EvidenceSignals,
} from "./derive-evidence-signals.js";
