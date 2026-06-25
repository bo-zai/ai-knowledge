import type { DomainEvidenceSource } from "./types.js";
import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export class CodeUsageSource implements DomainEvidenceSource {
  readonly sourceName = "code-usage";

  async collect(
    _clusterInput: DomainClusterInput,
    _context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    return {};
  }
}

export function createCodeUsageSource(): CodeUsageSource {
  return new CodeUsageSource();
}
