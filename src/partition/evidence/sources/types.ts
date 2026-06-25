import type {
  EvidenceCollectionContext,
  EvidenceAtom,
  EvidenceSourceKind,
} from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export interface EvidenceSourceCollectionResult {
  sourceName: string;
  sourceKind: EvidenceSourceKind;
  atoms: EvidenceAtom[];
  metadata?: Record<string, unknown>;
}

export interface EvidenceSource {
  readonly sourceName: string;
  readonly sourceKind: EvidenceSourceKind;
  collect(
    clusterInput: DomainClusterInput,
    context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult>;
}
