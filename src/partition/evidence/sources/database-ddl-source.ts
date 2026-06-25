import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export class DatabaseDdlSource implements EvidenceSource {
  readonly sourceName = "database-ddl";
  readonly sourceKind = "ddl" as const;

  async collect(
    _clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms: [],
      metadata: {
        implemented: false,
      },
    };
  }
}

export function createDatabaseDdlSource(): DatabaseDdlSource {
  return new DatabaseDdlSource();
}
