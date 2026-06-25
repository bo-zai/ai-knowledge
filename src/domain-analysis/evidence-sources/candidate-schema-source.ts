import type { DomainEvidenceSource } from "./types.js";
import type { DomainAnalysisContext, DomainEvidenceBundle } from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";

export class CandidateSchemaSource implements DomainEvidenceSource {
  readonly sourceName = "candidate-schema";

  async collect(
    clusterInput: DomainClusterInput,
    context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    return {
      context,
      candidates: clusterInput.candidates,
      candidateRelations: clusterInput.candidateRelations,
      candidateGroups: clusterInput.candidateGroups,
      schemaRelationGraph: clusterInput.schemaRelationGraph,
    };
  }
}

export function createCandidateSchemaSource(): CandidateSchemaSource {
  return new CandidateSchemaSource();
}
