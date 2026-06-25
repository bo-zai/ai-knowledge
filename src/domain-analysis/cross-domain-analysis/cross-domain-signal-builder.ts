import type {
  CrossDomainDependencySignal,
  DomainEvidenceBundle,
} from "../types.js";
import type {
  DomainDefinition,
  DomainPartition,
  PartitionCandidate,
  SchemaRelationStrength,
  SchemaTableEdge,
} from "../../partitioning/types.js";

interface PartitionDescriptor {
  partitionId: string;
  domainName: string;
  tables: Set<string>;
}

export function buildCrossDomainDependencySignals(input: {
  evidenceBundle: DomainEvidenceBundle;
  decisions: DomainDefinition[];
  partitions: DomainPartition[];
}): CrossDomainDependencySignal[] {
  const partitionByCandidateId = buildPartitionIdByCandidateId(
    input.partitions,
    input.decisions,
    input.evidenceBundle.candidates,
  );
  const descriptorByPartitionId = buildPartitionDescriptorMap(
    input.partitions,
    input.decisions,
  );
  const aggregated = new Map<string, CrossDomainDependencySignal>();

  for (const entry of input.evidenceBundle.dependencyMatrix) {
    const sourcePartitionId = partitionByCandidateId.get(
      entry.sourceCandidateId,
    );
    const targetPartitionId = partitionByCandidateId.get(
      entry.targetCandidateId,
    );
    if (
      !sourcePartitionId ||
      !targetPartitionId ||
      sourcePartitionId === targetPartitionId
    ) {
      continue;
    }

    mergeSignal(aggregated, {
      sourcePartitionId,
      targetPartitionId,
      descriptorByPartitionId,
      relationScore: entry.relationScore,
      relationReasons: entry.relationReasons,
    });
  }

  for (const relation of input.evidenceBundle.schemaRelationGraph.relations) {
    mergeSchemaRelationSignal(aggregated, relation, descriptorByPartitionId);
  }

  return [...aggregated.values()]
    .filter(
      (signal) =>
        signal.relationScore >= 3 && signal.relationReasons.length > 0,
    )
    .sort((left, right) => right.relationScore - left.relationScore);
}

function buildPartitionDescriptorMap(
  partitions: DomainPartition[],
  decisions: DomainDefinition[],
): Map<string, PartitionDescriptor> {
  const decisionNameByPartitionId = new Map<string, string>();
  for (const decision of decisions) {
    const decisionTables = new Set([
      ...decision.coreTables,
      ...decision.supportingTables,
    ]);
    const matchedPartition = [...partitions]
      .map((partition) => ({
        partition,
        score: partition.tables.filter((table) =>
          decisionTables.has(table.tableName),
        ).length,
      }))
      .sort((left, right) => right.score - left.score)[0]?.partition;
    if (matchedPartition) {
      decisionNameByPartitionId.set(
        matchedPartition.partitionId,
        decision.domainName,
      );
    }
  }

  return new Map(
    partitions.map((partition) => [
      partition.partitionId,
      {
        partitionId: partition.partitionId,
        domainName:
          decisionNameByPartitionId.get(partition.partitionId) ??
          partition.partitionId,
        tables: new Set(partition.tables.map((table) => table.tableName)),
      },
    ]),
  );
}

function mergeSchemaRelationSignal(
  aggregated: Map<string, CrossDomainDependencySignal>,
  relation: SchemaTableEdge,
  descriptorByPartitionId: Map<string, PartitionDescriptor>,
): void {
  const sourceDescriptor = findPartitionByTable(
    descriptorByPartitionId,
    relation.sourceTable,
  );
  const targetDescriptor = findPartitionByTable(
    descriptorByPartitionId,
    relation.targetTable,
  );
  if (
    !sourceDescriptor ||
    !targetDescriptor ||
    sourceDescriptor.partitionId === targetDescriptor.partitionId
  ) {
    return;
  }

  const score = relationStrengthToScore(relation.strength);
  const reasons =
    relation.evidence.length > 0
      ? relation.evidence.map(
          (evidence) =>
            `schema:${relation.relationType}:${relation.sourceTable}->${relation.targetTable}:${evidence}`,
        )
      : [
          `schema:${relation.relationType}:${relation.sourceTable}->${relation.targetTable}`,
        ];

  mergeSignal(aggregated, {
    sourcePartitionId: sourceDescriptor.partitionId,
    targetPartitionId: targetDescriptor.partitionId,
    descriptorByPartitionId,
    relationScore: score,
    relationReasons: reasons,
  });

  if (relation.direction === "bidirectional") {
    mergeSignal(aggregated, {
      sourcePartitionId: targetDescriptor.partitionId,
      targetPartitionId: sourceDescriptor.partitionId,
      descriptorByPartitionId,
      relationScore: score,
      relationReasons: reasons,
    });
  }
}

function mergeSignal(
  aggregated: Map<string, CrossDomainDependencySignal>,
  input: {
    sourcePartitionId: string;
    targetPartitionId: string;
    descriptorByPartitionId: Map<string, PartitionDescriptor>;
    relationScore: number;
    relationReasons: string[];
  },
): void {
  const sourceDescriptor = input.descriptorByPartitionId.get(
    input.sourcePartitionId,
  );
  const targetDescriptor = input.descriptorByPartitionId.get(
    input.targetPartitionId,
  );
  if (!sourceDescriptor || !targetDescriptor) {
    return;
  }

  const key = `${input.sourcePartitionId}:${input.targetPartitionId}`;
  const existing = aggregated.get(key);
  if (!existing) {
    aggregated.set(key, {
      sourcePartitionId: input.sourcePartitionId,
      sourceDomainName: sourceDescriptor.domainName,
      sourceTables: [...sourceDescriptor.tables],
      targetPartitionId: input.targetPartitionId,
      targetDomainName: targetDescriptor.domainName,
      targetTables: [...targetDescriptor.tables],
      relationScore: input.relationScore,
      relationReasons: [...new Set(input.relationReasons)],
    });
    return;
  }

  existing.relationScore += input.relationScore;
  existing.relationReasons = [
    ...new Set([...existing.relationReasons, ...input.relationReasons]),
  ];
}

function findPartitionByTable(
  descriptorByPartitionId: Map<string, PartitionDescriptor>,
  tableName: string,
): PartitionDescriptor | undefined {
  for (const descriptor of descriptorByPartitionId.values()) {
    if (descriptor.tables.has(tableName)) {
      return descriptor;
    }
  }
  return undefined;
}

function buildPartitionIdByCandidateId(
  partitions: DomainPartition[],
  decisions: DomainDefinition[],
  candidates: PartitionCandidate[],
): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const decision of decisions) {
    const candidateIds = [
      ...decision.coreCandidateIds,
      ...decision.supportingCandidateIds,
    ];
    const decisionTableSet = new Set([
      ...decision.coreTables,
      ...decision.supportingTables,
    ]);
    const partition = [...partitions]
      .map((item) => ({
        partition: item,
        score: item.tables.filter((table) =>
          decisionTableSet.has(table.tableName),
        ).length,
      }))
      .sort((left, right) => right.score - left.score)[0]?.partition;
    if (!partition) {
      continue;
    }

    for (const candidateId of candidateIds) {
      mapping.set(candidateId, partition.partitionId);
    }
  }

  for (const candidate of candidates) {
    if (mapping.has(candidate.candidateId)) {
      continue;
    }
    const matched = partitions.find((partition) =>
      partition.tables.some(
        (table) => table.tableName === candidate.anchorTable,
      ),
    );
    if (matched) {
      mapping.set(candidate.candidateId, matched.partitionId);
    }
  }

  return mapping;
}

function relationStrengthToScore(strength: SchemaRelationStrength): number {
  if (strength === "strong") {
    return 4;
  }
  if (strength === "medium") {
    return 3;
  }
  return 2;
}
