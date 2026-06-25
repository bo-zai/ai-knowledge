import type { DomainEvidenceSource } from "../evidence-sources/types.js";
import type {
  DomainAnalysisContext,
  DomainDependencyMatrixEntry,
  DomainEvidenceBundle,
} from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";
import { createCandidateSchemaSource } from "../evidence-sources/candidate-schema-source.js";
import { createCodeUsageSource } from "../evidence-sources/code-usage-source.js";
import { createMapperSqlSource } from "../evidence-sources/mapper-sql-source.js";
import { createProjectDocSource } from "../evidence-sources/project-doc-source.js";

export interface DomainEvidenceBuilderOptions {
  sources?: DomainEvidenceSource[];
}

export class DomainEvidenceBuilder {
  private readonly sources: DomainEvidenceSource[];

  constructor(options: DomainEvidenceBuilderOptions = {}) {
    this.sources = options.sources ?? [
      createCandidateSchemaSource(),
      createMapperSqlSource(),
      createCodeUsageSource(),
      createProjectDocSource(),
    ];
  }

  async build(
    clusterInput: DomainClusterInput,
    context: DomainAnalysisContext,
  ): Promise<DomainEvidenceBundle> {
    const partials = await Promise.all(
      this.sources.map((source) => source.collect(clusterInput, context)),
    );

    const baseDependencyMatrix = this.buildDependencyMatrix(clusterInput);
    const extraDependencyMatrix = partials.flatMap(
      (item) => item.dependencyMatrix ?? [],
    );
    const dependencyMatrix = this.mergeDependencyMatrix([
      ...baseDependencyMatrix,
      ...extraDependencyMatrix,
    ]);
    const sourceDependencyMatrix = Object.fromEntries(
      this.sources.map((source, index) => [
        source.sourceName,
        partials[index]?.dependencyMatrix ?? [],
      ]),
    );

    return {
      context,
      candidates: clusterInput.candidates,
      candidateRelations: clusterInput.candidateRelations,
      candidateGroups: clusterInput.candidateGroups,
      schemaRelationGraph: clusterInput.schemaRelationGraph,
      candidateEvidenceBundles: clusterInput.candidates.map((candidate) => ({
        candidate,
        relatedRelations: clusterInput.candidateRelations.filter(
          (relation) =>
            relation.candidateIdA === candidate.candidateId ||
            relation.candidateIdB === candidate.candidateId,
        ),
      })),
      dependencyMatrix,
      sourceDependencyMatrix,
      ...Object.assign({}, ...partials),
    };
  }

  private buildDependencyMatrix(
    clusterInput: DomainClusterInput,
  ): DomainDependencyMatrixEntry[] {
    return clusterInput.candidateRelations.map((relation) => ({
      sourceCandidateId: relation.candidateIdA,
      targetCandidateId: relation.candidateIdB,
      relationReasons: [
        ...relation.sharedCoreTables.map(
          (tableName) => `shared-core:${tableName}`,
        ),
        ...relation.sharedServices.map(
          (serviceName) => `shared-service:${serviceName}`,
        ),
        ...relation.tableForeignKeyRelations.map(
          (item) => `fk:${item.fromTable}->${item.toTable}`,
        ),
      ],
      relationScore:
        relation.sharedCoreTables.length * 3 +
        relation.sharedServices.length * 2 +
        relation.tableForeignKeyRelations.length,
    }));
  }

  private mergeDependencyMatrix(
    entries: DomainDependencyMatrixEntry[],
  ): DomainDependencyMatrixEntry[] {
    const merged = new Map<string, DomainDependencyMatrixEntry>();

    for (const entry of entries) {
      const key = `${entry.sourceCandidateId}:${entry.targetCandidateId}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...entry,
          relationReasons: [...new Set(entry.relationReasons)],
        });
        continue;
      }

      existing.relationScore = Math.max(
        existing.relationScore,
        entry.relationScore,
      );
      existing.relationReasons = [
        ...new Set([...existing.relationReasons, ...entry.relationReasons]),
      ];
    }

    return [...merged.values()].sort((left, right) =>
      `${left.sourceCandidateId}:${left.targetCandidateId}`.localeCompare(
        `${right.sourceCandidateId}:${right.targetCandidateId}`,
      ),
    );
  }
}

export function createDomainEvidenceBuilder(
  options?: DomainEvidenceBuilderOptions,
): DomainEvidenceBuilder {
  return new DomainEvidenceBuilder(options);
}
