import type { DomainEvidenceSource } from "./types.js";
import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export class DatabaseDdlSource implements DomainEvidenceSource {
  readonly sourceName = "database-ddl";

  async collect(
    _clusterInput: DomainClusterInput,
    _context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    return {};
  }
}

export function createDatabaseDdlSource(): DatabaseDdlSource {
  return new DatabaseDdlSource();
}
