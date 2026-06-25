import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export interface DomainEvidenceSource {
  readonly sourceName: string;
  collect(
    clusterInput: DomainClusterInput,
    context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>>;
}
