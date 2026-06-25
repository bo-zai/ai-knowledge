import type { DomainEvidenceSource } from "./types.js";
import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export class DatabaseInstanceSource implements DomainEvidenceSource {
  readonly sourceName = "database-instance";

  async collect(
    _clusterInput: DomainClusterInput,
    _context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    return {};
  }
}

export function createDatabaseInstanceSource(): DatabaseInstanceSource {
  return new DatabaseInstanceSource();
}
