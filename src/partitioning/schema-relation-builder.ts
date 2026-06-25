import type {
  PartitionCandidate,
  SchemaRelationGraph,
  SchemaTableEdge,
  SchemaTableKind,
  SchemaTableNode,
  TraceResult,
} from "./types.js";

const LOG_SEGMENTS = new Set(["log", "logs", "history", "record", "audit"]);
const CONFIG_SEGMENTS = new Set(["config", "dict", "setting"]);
const JUNCTION_SEGMENTS = new Set([
  "relation",
  "map",
  "mapping",
  "bind",
  "ref",
]);
const EXTENSION_SEGMENTS = new Set([
  "detail",
  "item",
  "line",
  "record",
  "log",
  "history",
  "ext",
  "extra",
  "snapshot",
  "img",
  "image",
  "file",
  "attr",
  "property",
  "config",
  "rule",
]);

export class SchemaRelationBuilder {
  build(traceResults: TraceResult[]): SchemaRelationGraph {
    const tables = this.buildTableNodes(traceResults);
    const relations = this.buildEdges(traceResults, tables);

    return {
      tables: [...tables.values()].sort((left, right) =>
        left.tableName.localeCompare(right.tableName),
      ),
      relations: relations.sort((left, right) =>
        `${left.sourceTable}:${left.targetTable}`.localeCompare(
          `${right.sourceTable}:${right.targetTable}`,
        ),
      ),
    };
  }

  buildCandidateEvidence(
    graph: SchemaRelationGraph,
    candidate: PartitionCandidate,
    allCandidates: PartitionCandidate[],
  ): PartitionCandidate["evidence"] {
    const candidateTableSet = new Set(
      candidate.tables.map((table) => table.tableName),
    );
    const internalRelations = graph.relations.filter(
      (relation) =>
        candidateTableSet.has(relation.sourceTable) &&
        candidateTableSet.has(relation.targetTable),
    );
    const outboundRelations = graph.relations.filter(
      (relation) =>
        candidateTableSet.has(relation.sourceTable) &&
        !candidateTableSet.has(relation.targetTable),
    );
    const inboundRelations = graph.relations.filter(
      (relation) =>
        !candidateTableSet.has(relation.sourceTable) &&
        candidateTableSet.has(relation.targetTable),
    );
    const relatedCandidateIds = allCandidates
      .filter((item) => item.candidateId !== candidate.candidateId)
      .filter(
        (item) =>
          outboundRelations.some((relation) =>
            item.tables.some(
              (table) => table.tableName === relation.targetTable,
            ),
          ) ||
          inboundRelations.some((relation) =>
            item.tables.some(
              (table) => table.tableName === relation.sourceTable,
            ),
          ),
      )
      .map((item) => item.candidateId);
    const businessTerms = [
      ...this.extractNameTokens(candidate.anchorTable),
      ...candidate.services.flatMap((service) =>
        this.extractNameTokens(service.className),
      ),
      ...candidate.entryPoints.flatMap((entryPoint) =>
        this.extractNameTokens(entryPoint.className),
      ),
    ];

    return {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      suggestedName: candidate.anchorTable,
      entryPointSummaries: candidate.entryPoints.map(
        (entryPoint) =>
          `${entryPoint.module}:${entryPoint.className}.${entryPoint.methodName}`,
      ),
      coreTables: candidate.coreTableNames,
      supportingTables: candidate.supportingTableNames,
      ownedTables: candidate.ownedTableNames,
      dependencyTables: candidate.dependencyTableNames,
      coreServices: candidate.services.map((service) => service.className),
      coreMappers: candidate.mappers.map((mapper) => mapper.className),
      internalRelations,
      outboundRelations,
      inboundRelations,
      relatedCandidateIds: [...new Set(relatedCandidateIds)].sort(),
      businessTerms: [...new Set(businessTerms)].sort(),
      commitHighlights: [],
    };
  }

  private buildTableNodes(
    traceResults: TraceResult[],
  ): Map<string, SchemaTableNode> {
    const tableNodes = new Map<string, SchemaTableNode>();

    for (const result of traceResults) {
      for (const table of result.tables) {
        if (tableNodes.has(table.tableName)) {
          continue;
        }

        tableNodes.set(table.tableName, {
          tableName: table.tableName,
          normalizedName: table.tableName.toLowerCase(),
          tableKind: this.detectTableKind(table.tableName),
          nameTokens: this.extractNameTokens(table.tableName),
        });
      }
    }

    return tableNodes;
  }

  private buildEdges(
    traceResults: TraceResult[],
    tables: Map<string, SchemaTableNode>,
  ): SchemaTableEdge[] {
    const edges = new Map<string, SchemaTableEdge>();

    for (const result of traceResults) {
      const mapperTables = [
        ...new Set(
          result.mappers.flatMap((mapper) => mapper.tablesOperated ?? []),
        ),
      ];
      for (const table of result.tables) {
        const foreignKey = this.parseForeignKey(table.foreignKey);
        if (foreignKey) {
          const targetTableKind = tables.get(
            foreignKey.referencesTable,
          )?.tableKind;
          this.upsertEdge(edges, {
            sourceTable: table.tableName,
            targetTable: foreignKey.referencesTable,
            relationType:
              this.resolveExplicitForeignKeyRelationType(targetTableKind),
            strength:
              targetTableKind === "log" ||
              targetTableKind === "config" ||
              targetTableKind === "dict"
                ? "weak"
                : "strong",
            direction: "outbound",
            evidence: [`FK:${foreignKey.columnName}`],
          });
        }

        for (const otherTable of mapperTables) {
          if (otherTable === table.tableName || !tables.has(otherTable)) {
            continue;
          }

          const inferredRelation = this.inferRelation(
            table.tableName,
            otherTable,
          );
          if (!inferredRelation) {
            continue;
          }

          this.upsertEdge(edges, inferredRelation);
        }
      }
    }

    return [...edges.values()];
  }

  private upsertEdge(
    edges: Map<string, SchemaTableEdge>,
    edge: SchemaTableEdge,
  ): void {
    const key = `${edge.sourceTable}:${edge.targetTable}:${edge.relationType}`;
    const existing = edges.get(key);
    if (!existing) {
      edges.set(key, edge);
      return;
    }

    existing.evidence = [...new Set([...existing.evidence, ...edge.evidence])];
    if (existing.strength === "weak" && edge.strength !== "weak") {
      existing.strength = edge.strength;
    }
  }

  private inferRelation(
    sourceTable: string,
    targetTable: string,
  ): SchemaTableEdge | null {
    const sourceTokens = this.extractNameTokens(sourceTable);
    const targetTokens = this.extractNameTokens(targetTable);
    const sharedTokens = sourceTokens.filter((token) =>
      targetTokens.includes(token),
    );
    if (sharedTokens.length === 0) {
      return null;
    }

    const commonPrefixLength = this.getCommonPrefixLength(
      sourceTokens,
      targetTokens,
    );
    const sharedLeadingOnly =
      sharedTokens.length === 1 &&
      sourceTokens[0] === targetTokens[0] &&
      sharedTokens[0] === sourceTokens[0];

    const sourceKind = this.detectTableKind(sourceTable);
    const targetKind = this.detectTableKind(targetTable);
    if (sourceKind === "log" || targetKind === "log") {
      return {
        sourceTable,
        targetTable,
        relationType: "audit_or_log",
        strength: "weak",
        direction: "outbound",
        evidence: [`shared:${sharedTokens.join(",")}`],
      };
    }

    if (
      sourceKind === "config" ||
      sourceKind === "dict" ||
      targetKind === "config" ||
      targetKind === "dict"
    ) {
      return {
        sourceTable,
        targetTable,
        relationType: "config_or_dict",
        strength: "weak",
        direction: "outbound",
        evidence: [`shared:${sharedTokens.join(",")}`],
      };
    }

    if (sourceKind === "junction") {
      return {
        sourceTable,
        targetTable,
        relationType: "junction_table",
        strength: "medium",
        direction: "bidirectional",
        evidence: [`junction:${sharedTokens.join(",")}`],
      };
    }

    const extensionRelation = this.buildExtensionRelation(
      sourceTable,
      targetTable,
      sourceTokens,
      targetTokens,
      sharedTokens,
      commonPrefixLength,
    );
    if (extensionRelation) {
      return extensionRelation;
    }

    if (sharedLeadingOnly) {
      return null;
    }

    if (commonPrefixLength >= 2 || sharedTokens.length >= 2) {
      return {
        sourceTable,
        targetTable,
        relationType: "aggregate_child",
        strength: "medium",
        direction: "outbound",
        evidence: [`aggregate:${sharedTokens.join(",")}`],
      };
    }

    return null;
  }

  private detectTableKind(tableName: string): SchemaTableKind {
    const tokens = this.extractNameTokens(tableName);
    if (tokens.some((token) => LOG_SEGMENTS.has(token))) {
      return "log";
    }
    if (tokens.some((token) => CONFIG_SEGMENTS.has(token))) {
      return "config";
    }
    if (tokens.some((token) => JUNCTION_SEGMENTS.has(token))) {
      return "junction";
    }
    return "business_entity";
  }

  private parseForeignKey(
    foreignKey: string | undefined,
  ): { columnName: string; referencesTable: string } | null {
    if (!foreignKey) {
      return null;
    }

    const match = foreignKey.match(/(\w+)\s*→\s*(\w+)\.(\w+)/);
    if (!match) {
      return null;
    }

    return {
      columnName: match[1],
      referencesTable: match[2],
    };
  }

  private extractNameTokens(value: string): string[] {
    return value
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .split(/[_\W]+/)
      .filter(Boolean);
  }

  private getCommonPrefixLength(
    sourceTokens: string[],
    targetTokens: string[],
  ): number {
    const maxLength = Math.min(sourceTokens.length, targetTokens.length);
    let length = 0;
    while (
      length < maxLength &&
      sourceTokens[length] === targetTokens[length]
    ) {
      length += 1;
    }
    return length;
  }

  private buildExtensionRelation(
    sourceTable: string,
    targetTable: string,
    sourceTokens: string[],
    targetTokens: string[],
    sharedTokens: string[],
    commonPrefixLength: number,
  ): SchemaTableEdge | null {
    if (
      sourceTable.includes(`${targetTable}_`) ||
      targetTable.includes(`${sourceTable}_`)
    ) {
      return {
        sourceTable,
        targetTable,
        relationType: "extension_table",
        strength: "medium",
        direction: "outbound",
        evidence: [`prefix:${sharedTokens.join(",")}`],
      };
    }

    if (
      commonPrefixLength < Math.min(sourceTokens.length, targetTokens.length)
    ) {
      return null;
    }

    const sourceExtra = sourceTokens.slice(commonPrefixLength);
    const targetExtra = targetTokens.slice(commonPrefixLength);
    const hasExtensionSuffix =
      sourceExtra.some((token) => EXTENSION_SEGMENTS.has(token)) ||
      targetExtra.some((token) => EXTENSION_SEGMENTS.has(token));
    if (!hasExtensionSuffix) {
      return null;
    }

    return {
      sourceTable,
      targetTable,
      relationType: "extension_table",
      strength: "medium",
      direction: "outbound",
      evidence: [`suffix:${sharedTokens.join(",")}`],
    };
  }

  private resolveExplicitForeignKeyRelationType(
    targetKind: SchemaTableKind | undefined,
  ): SchemaTableEdge["relationType"] {
    if (targetKind === "log") {
      return "audit_or_log";
    }

    if (targetKind === "config" || targetKind === "dict") {
      return "config_or_dict";
    }

    return "explicit_fk";
  }
}

export function createSchemaRelationBuilder(): SchemaRelationBuilder {
  return new SchemaRelationBuilder();
}
