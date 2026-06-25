import type { DomainEvidenceSource } from "./types.js";
import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export class ProjectDocSource implements DomainEvidenceSource {
  readonly sourceName = "project-doc";

  async collect(
    _clusterInput: DomainClusterInput,
    _context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    return {};
  }
}

export function createProjectDocSource(): ProjectDocSource {
  return new ProjectDocSource();
}
