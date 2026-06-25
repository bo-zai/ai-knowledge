/**
 * PartitionCandidate 构建器
 *
 * 将 TraceResult 转换为更保守的候选，优先稳定锚点并抑制聚合入口扩散。
 */

import { createHash } from "crypto";
import { getCurrentCommit } from "../engine/storage/git.js";
import { logger } from "../shared/logger.js";
import type {
  CandidateGroup,
  CandidateRelation,
  CandidateSnapshot,
  CandidateSnapshotEntry,
  DomainClusterInput,
  EntryPoint,
  PartitionCandidate,
  ProjectContext,
  SchemaRelationGraph,
  TableInfo,
  TraceResult,
} from "./types.js";
import { createSchemaRelationBuilder } from "./schema-relation-builder.js";
import { discoverSubjectCandidates } from "../partition/subject-discovery/index.js";
import type { EvidenceAtom } from "../partition/evidence/types.js";

const LOW_SIGNAL_ANCHORS = new Set(["unknown", "id"]);
const MAX_PRIMARY_MAPPERS_PER_RESULT = 2;
const PRIMARY_TABLE_SCORE_GAP = 2;
const PRIMARY_MAPPER_SCORE_GAP = 2;

interface TableClassificationResult {
  anchorTable: string;
  anchorQuality: "high" | "medium" | "low";
  isInfrastructureCandidate: boolean;
  coreTableNames: string[];
  supportingTableNames: string[];
  ownedTableNames: string[];
  dependencyTableNames: string[];
}

interface ScoredTable {
  tableName: string;
  score: number;
}

interface ScoredMapper {
  mapperName: string;
  score: number;
}

interface CandidateTableMetrics {
  tableName: string;
  touchedEntryPointCount: number;
  writeEntryPointCount: number;
  readEntryPointCount: number;
  mapperCount: number;
  primaryResultCount: number;
  primaryMapperCount: number;
}

export class CandidateBuilder {
  buildCandidates(traceResults: TraceResult[]): PartitionCandidate[] {
    const tableGroups = this.groupByAnchorTable(traceResults);
    const rawCandidates: PartitionCandidate[] = [];

    for (const [anchorTable, results] of tableGroups.entries()) {
      const resultGroups = this.partitionAnchorGroup(anchorTable, results);
      for (const resultGroup of resultGroups) {
        if (this.shouldTreatAsTechnicalCluster(resultGroup)) {
          continue;
        }
        const resolvedAnchorTable = this.resolveGroupAnchorTable(
          anchorTable,
          resultGroup,
        );
        rawCandidates.push(
          this.buildCandidate(resolvedAnchorTable, resultGroup),
        );
      }
    }

    const candidates = this.consolidateCandidates(rawCandidates);

    logger.info(
      `Built ${candidates.length} candidates from ${traceResults.length} trace results`,
    );

    return candidates;
  }

  private shouldTreatAsTechnicalCluster(results: TraceResult[]): boolean {
    const hasAnyTable = results.some((result) => result.tables.length > 0);
    const hasAnyMapper = results.some((result) => result.mappers.length > 0);
    const hasAnyService = results.some((result) => result.services.length > 0);
    const allUnknownAnchors = results.every(
      (result) => this.getPreferredAnchorTableForResult(result) === "unknown",
    );

    return allUnknownAnchors && !hasAnyTable && !hasAnyMapper && !hasAnyService;
  }

  private partitionAnchorGroup(
    anchorTable: string,
    results: TraceResult[],
  ): TraceResult[][] {
    if (results.length <= 1) {
      return [results];
    }

    const shouldSplit =
      results.length >= 6 ||
      new Set(results.map((result) => result.entryPoint.className)).size >= 4 ||
      new Set(
        results.flatMap((result) => this.getPrimaryTablesForResult(result)),
      ).size >= 4 ||
      new Set(
        results.flatMap((result) =>
          result.services.map((service) => service.className),
        ),
      ).size >= 6;

    if (!shouldSplit) {
      return [results];
    }

    const adjacency = new Map<number, Set<number>>();
    for (let index = 0; index < results.length; index += 1) {
      adjacency.set(index, new Set<number>());
    }

    for (let leftIndex = 0; leftIndex < results.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < results.length;
        rightIndex += 1
      ) {
        if (
          !this.shouldLinkTraceResults(results[leftIndex], results[rightIndex])
        ) {
          continue;
        }
        adjacency.get(leftIndex)?.add(rightIndex);
        adjacency.get(rightIndex)?.add(leftIndex);
      }
    }

    const visited = new Set<number>();
    const partitions: TraceResult[][] = [];

    for (let index = 0; index < results.length; index += 1) {
      if (visited.has(index)) {
        continue;
      }
      const componentIndexes = this.walkTraceComponent(
        index,
        adjacency,
        visited,
      );
      const component = componentIndexes.map(
        (componentIndex) => results[componentIndex],
      );
      partitions.push(component);
    }

    if (partitions.length <= 1) {
      return [results];
    }

    logger.info(
      `Split heterogeneous anchor group ${anchorTable} into ${partitions.length} result clusters`,
    );
    return partitions;
  }

  private shouldLinkTraceResults(
    left: TraceResult,
    right: TraceResult,
  ): boolean {
    const leftPrimaryTables = new Set(this.getPrimaryTablesForResult(left));
    const rightPrimaryTables = new Set(this.getPrimaryTablesForResult(right));
    const sharedPrimaryTableCount = [...leftPrimaryTables].filter((tableName) =>
      rightPrimaryTables.has(tableName),
    ).length;
    if (sharedPrimaryTableCount > 0) {
      return true;
    }

    if (left.entryPoint.className === right.entryPoint.className) {
      return true;
    }

    const leftServices = new Set(
      left.services.map((service) => service.className),
    );
    const sharedServiceCount = right.services.filter((service) =>
      leftServices.has(service.className),
    ).length;
    if (sharedServiceCount > 0) {
      return true;
    }

    const leftMapperNames = new Set(
      left.mappers.map((mapper) => mapper.className),
    );
    const sharedMapperCount = right.mappers.filter((mapper) =>
      leftMapperNames.has(mapper.className),
    ).length;
    if (sharedMapperCount > 0) {
      return true;
    }

    const leftTouchedTables = new Set(
      left.tables.map((table) => table.tableName),
    );
    const sharedTouchedTableCount = right.tables.filter((table) =>
      leftTouchedTables.has(table.tableName),
    ).length;
    return sharedTouchedTableCount >= 2;
  }

  private walkTraceComponent(
    startIndex: number,
    adjacency: Map<number, Set<number>>,
    visited: Set<number>,
  ): number[] {
    const stack = [startIndex];
    const component: number[] = [];

    while (stack.length > 0) {
      const currentIndex = stack.pop();
      if (currentIndex === undefined || visited.has(currentIndex)) {
        continue;
      }

      visited.add(currentIndex);
      component.push(currentIndex);

      for (const neighborIndex of adjacency.get(currentIndex) ?? []) {
        if (!visited.has(neighborIndex)) {
          stack.push(neighborIndex);
        }
      }
    }

    return component.sort((left, right) => left - right);
  }

  private resolveGroupAnchorTable(
    fallbackAnchorTable: string,
    results: TraceResult[],
  ): string {
    const writeDrivenAnchor = this.resolveWriteDrivenAnchorTable(results);
    if (writeDrivenAnchor) {
      return writeDrivenAnchor;
    }

    const preferredTables = results
      .flatMap((result) => this.getPrimaryTablesForResult(result))
      .filter((tableName) => !LOW_SIGNAL_ANCHORS.has(tableName));

    if (preferredTables.length > 0) {
      const counts = new Map<string, number>();
      for (const tableName of preferredTables) {
        counts.set(tableName, (counts.get(tableName) ?? 0) + 1);
      }
      const winner = [...counts.entries()].sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      })[0];
      if (winner) {
        return winner[0];
      }
    }

    const classification = this.classifyTables(
      this.mergeSourceTables(results),
      results,
    );
    return classification.anchorTable || fallbackAnchorTable;
  }

  private resolveWriteDrivenAnchorTable(
    results: TraceResult[],
  ): string | undefined {
    const scores = new Map<string, number>();

    for (const result of results) {
      for (const mapper of result.mappers) {
        const operations = new Set(mapper.operations ?? []);
        const tablesOperated = mapper.tablesOperated ?? [];
        for (const tableName of tablesOperated) {
          if (LOW_SIGNAL_ANCHORS.has(tableName)) {
            continue;
          }

          let score = scores.get(tableName) ?? 0;
          if (
            operations.has("insert") ||
            operations.has("update") ||
            operations.has("delete")
          ) {
            score += 4;
          } else {
            score += 1;
          }
          scores.set(tableName, score);
        }
      }
    }

    const winner = [...scores.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })[0];

    if (!winner || winner[1] < 4) {
      return undefined;
    }

    return winner[0];
  }

  private buildResultTableScores(result: TraceResult): ScoredTable[] {
    const scores = new Map<string, number>();
    const primaryTableNames = new Set(
      result.tables
        .filter((table) => table.role === "primary")
        .map((table) => table.tableName),
    );

    for (const mapper of result.mappers) {
      const operations = new Set(mapper.operations ?? []);
      const hasWriteOperation =
        operations.has("insert") ||
        operations.has("update") ||
        operations.has("delete");
      const baseScore = hasWriteOperation ? 6 : 2;

      for (const tableName of mapper.tablesOperated ?? []) {
        if (LOW_SIGNAL_ANCHORS.has(tableName)) {
          continue;
        }

        let score = scores.get(tableName) ?? 0;
        score += baseScore;
        if (primaryTableNames.has(tableName)) {
          score += 3;
        }
        scores.set(tableName, score);
      }
    }

    for (const table of result.tables) {
      if (LOW_SIGNAL_ANCHORS.has(table.tableName)) {
        continue;
      }

      let score = scores.get(table.tableName) ?? 0;
      if (table.role === "primary") {
        score += 4;
      } else if (table.role === "related") {
        score += 1;
      }
      scores.set(table.tableName, score);
    }

    return [...scores.entries()]
      .map(([tableName, score]) => ({ tableName, score }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.tableName.localeCompare(right.tableName);
      });
  }

  private buildResultMapperScores(result: TraceResult): ScoredMapper[] {
    const tableScoreByName = new Map(
      this.buildResultTableScores(result).map((item) => [
        item.tableName,
        item.score,
      ]),
    );
    const callChainOrder = new Map<string, number>();
    result.entryPoint.callChain
      .filter((node) => node.role === "data_layer")
      .forEach((node, index) => {
        if (!callChainOrder.has(node.className)) {
          callChainOrder.set(node.className, index);
        }
      });

    return result.mappers
      .map((mapper) => {
        let score = 0;
        for (const tableName of mapper.tablesOperated ?? []) {
          score += tableScoreByName.get(tableName) ?? 0;
        }

        const callOrder = callChainOrder.get(mapper.className);
        if (callOrder !== undefined) {
          score += Math.max(0, 3 - callOrder);
        }

        return {
          mapperName: mapper.className,
          score,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.mapperName.localeCompare(right.mapperName);
      });
  }

  private consolidateCandidates(
    candidates: PartitionCandidate[],
  ): PartitionCandidate[] {
    const sortedCandidates = [...candidates].sort((left, right) => {
      const scoreDiff =
        this.getCandidateStrengthScore(right) -
        this.getCandidateStrengthScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left.anchorTable.localeCompare(right.anchorTable);
    });
    const absorbedCandidateIds = new Set<string>();
    const normalizedCandidates: PartitionCandidate[] = [];

    for (const candidate of sortedCandidates) {
      if (absorbedCandidateIds.has(candidate.candidateId)) {
        continue;
      }

      let mergedCandidate = candidate;
      for (const other of sortedCandidates) {
        if (
          other.candidateId === mergedCandidate.candidateId ||
          absorbedCandidateIds.has(other.candidateId)
        ) {
          continue;
        }

        if (!this.shouldAbsorbCandidate(mergedCandidate, other)) {
          continue;
        }

        mergedCandidate = this.mergeCandidates(mergedCandidate, other);
        absorbedCandidateIds.add(other.candidateId);
      }

      normalizedCandidates.push(mergedCandidate);
    }

    return normalizedCandidates.sort((left, right) =>
      left.anchorTable.localeCompare(right.anchorTable),
    );
  }

  private groupByAnchorTable(
    traceResults: TraceResult[],
  ): Map<string, TraceResult[]> {
    const tableGroups = new Map<string, TraceResult[]>();
    const sortedResults = [...traceResults].sort((a, b) =>
      a.entryPoint.filePath.localeCompare(b.entryPoint.filePath),
    );

    for (const result of sortedResults) {
      const anchorTable = this.getPreferredAnchorTableForResult(result);
      const group = tableGroups.get(anchorTable) ?? [];
      group.push(result);
      tableGroups.set(anchorTable, group);
    }

    return tableGroups;
  }

  private buildCandidate(
    anchorTable: string,
    results: TraceResult[],
  ): PartitionCandidate {
    const scopedResults = this.selectCandidateResults(results);
    const preliminaryClassification = this.classifyTables(
      this.mergeSourceTables(scopedResults),
      scopedResults,
    );
    const primaryAlignedResults = this.selectPrimaryAlignedResults(
      scopedResults,
      anchorTable,
      preliminaryClassification.coreTableNames,
    );
    const candidateResults =
      primaryAlignedResults.length > 0 ? primaryAlignedResults : scopedResults;
    const entryPoints = this.mergeEntryPoints(candidateResults);
    const tableClassification = this.classifyTables(
      this.mergeSourceTables(candidateResults),
      candidateResults,
    );
    if (!tableClassification.coreTableNames.includes(anchorTable)) {
      tableClassification.coreTableNames = [
        anchorTable,
        ...tableClassification.coreTableNames,
      ];
      tableClassification.supportingTableNames =
        tableClassification.supportingTableNames.filter(
          (tableName) => tableName !== anchorTable,
        );
    }
    const tables = this.mergeTables(candidateResults, tableClassification);
    const mappers = this.mergeMappers(
      candidateResults,
      tableClassification.coreTableNames,
    );
    const services = this.mergeServices(candidateResults);
    const callChainSummary = this.computeCallChainSummary(candidateResults);

    const entryPointIds = entryPoints
      .map((ep) => this.generateEntryPointId(ep))
      .sort();
    const candidateId = this.generateStableCandidateId(
      anchorTable,
      entryPointIds,
    );
    const isAggregatorCandidate =
      entryPoints.some((entryPoint) => entryPoint.isAggregatorLike) ||
      callChainSummary.depth >= 6 ||
      tableClassification.coreTableNames.length === 0;

    return {
      candidateId,
      anchorTable,
      anchorQuality: tableClassification.anchorQuality,
      isInfrastructureCandidate: tableClassification.isInfrastructureCandidate,
      isAggregatorCandidate,
      coreTableNames: tableClassification.coreTableNames,
      supportingTableNames: tableClassification.supportingTableNames,
      ownedTableNames: tableClassification.ownedTableNames,
      dependencyTableNames: tableClassification.dependencyTableNames,
      entryPoints,
      tables,
      mappers,
      services,
      callChainSummary,
    };
  }

  generateEntryPointId(ep: PartitionCandidate["entryPoints"][0]): string {
    return `${ep.filePath}:${ep.kind}:${ep.className}:${ep.methodName}`;
  }

  private generateStableCandidateId(
    anchorTable: string,
    sortedEntryPointIds: string[],
  ): string {
    const hashInput = `${anchorTable}:${sortedEntryPointIds.join(",")}`;
    const hash = createHash("sha256")
      .update(hashInput)
      .digest("hex")
      .slice(0, 12);
    return `candidate_${anchorTable}_${hash}`;
  }

  private mergeEntryPoints(
    results: TraceResult[],
  ): PartitionCandidate["entryPoints"] {
    const entryPoints: PartitionCandidate["entryPoints"] = [];
    const addedKeys = new Set<string>();

    for (const result of [...results].sort((a, b) =>
      a.entryPoint.filePath.localeCompare(b.entryPoint.filePath),
    )) {
      const entryPoint = result.entryPoint;
      const key = this.generateRawEntryPointId(entryPoint);
      if (addedKeys.has(key)) {
        continue;
      }

      addedKeys.add(key);
      entryPoints.push({
        kind: entryPoint.kind,
        className: entryPoint.className,
        methodName: entryPoint.methodName,
        filePath: entryPoint.filePath,
        module: entryPoint.module,
        isAggregatorLike: this.isAggregatorEntryPoint(entryPoint, result),
        apiInfo:
          entryPoint.kind === "controller"
            ? { basePath: this.inferApiBasePath(entryPoint.className) }
            : undefined,
        mqInfo:
          entryPoint.kind === "mq_consumer" && entryPoint.mqType
            ? {
                mqType: entryPoint.mqType,
                topic: entryPoint.mqTopic,
              }
            : undefined,
      });
    }

    return entryPoints;
  }

  private generateRawEntryPointId(entryPoint: EntryPoint): string {
    return `${entryPoint.filePath}:${entryPoint.kind}:${entryPoint.className}:${entryPoint.methodName}`;
  }

  private inferApiBasePath(className: string): string {
    const baseName = className.replace(/Controller$/i, "").toLowerCase();
    return `/api/${baseName}`;
  }

  private mergeSourceTables(results: TraceResult[]): TableInfo[] {
    const mergedTables: TableInfo[] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const table of result.tables) {
        if (!addedNames.has(table.tableName)) {
          addedNames.add(table.tableName);
          mergedTables.push({ ...table });
        }
      }
    }

    return mergedTables;
  }

  private classifyTables(
    tables: TableInfo[],
    results: TraceResult[] = [],
  ): TableClassificationResult {
    const rankedTables = [...tables].sort((left, right) => {
      const leftScore = this.getTablePriority(left, results);
      const rightScore = this.getTablePriority(right, results);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return left.tableName.localeCompare(right.tableName);
    });

    const anchorTable = rankedTables[0]?.tableName ?? "unknown";
    const anchorQuality = this.getAnchorQuality(
      anchorTable,
      rankedTables[0],
      results,
    );
    const tableMetrics = this.buildCandidateTableMetrics(rankedTables, results);
    const ownedTableNames = rankedTables
      .filter((table) =>
        this.isOwnedTable(
          table,
          tableMetrics.get(table.tableName),
          anchorTable,
          results.length,
        ),
      )
      .map((table) => table.tableName);
    const effectiveOwnedTableNames =
      ownedTableNames.length > 0
        ? ownedTableNames
        : rankedTables.slice(0, 1).map((table) => table.tableName);
    const supportingTableNames = rankedTables
      .filter((table) =>
        this.isSupportingTable(
          table,
          tableMetrics.get(table.tableName),
          anchorTable,
          effectiveOwnedTableNames,
        ),
      )
      .map((table) => table.tableName)
      .filter((tableName) => !effectiveOwnedTableNames.includes(tableName));
    const dependencyTableNames = rankedTables
      .map((table) => table.tableName)
      .filter(
        (tableName) =>
          !effectiveOwnedTableNames.includes(tableName) &&
          !supportingTableNames.includes(tableName),
      );
    const coreTableNames = [
      ...new Set([...effectiveOwnedTableNames, ...supportingTableNames]),
    ];

    return {
      anchorTable,
      anchorQuality,
      isInfrastructureCandidate: this.isStructurallyPeripheralCandidate(
        rankedTables,
        results,
      ),
      coreTableNames,
      supportingTableNames,
      ownedTableNames: effectiveOwnedTableNames,
      dependencyTableNames,
    };
  }

  private getTablePriority(table: TableInfo, results: TraceResult[]): number {
    let score = 0;

    if (table.role === "primary") {
      score += 5;
    }
    score += 4;
    if (table.foreignKey) {
      score += 1;
    }

    for (const result of results) {
      const directMapperHit = result.mappers.some((mapper) =>
        mapper.tablesOperated?.includes(table.tableName),
      );
      if (directMapperHit) {
        score += 3;
      }
    }

    return score;
  }

  private getAnchorQuality(
    anchorTable: string,
    table: TableInfo | undefined,
    results: TraceResult[],
  ): "high" | "medium" | "low" {
    if (!table || LOW_SIGNAL_ANCHORS.has(anchorTable)) {
      return "low";
    }

    const hasDirectMapper = results.some((result) =>
      result.mappers.some((mapper) =>
        mapper.tablesOperated?.includes(anchorTable),
      ),
    );

    if (hasDirectMapper) {
      return "high";
    }

    if (
      results.some((result) =>
        result.tables.some((item) => item.role === "primary"),
      )
    ) {
      return "medium";
    }

    return "low";
  }

  private isCoreTable(table: TableInfo, results: TraceResult[]): boolean {
    if (LOW_SIGNAL_ANCHORS.has(table.tableName)) {
      return false;
    }

    if (table.role === "primary") {
      return true;
    }

    return results.some((result) =>
      this.getPrimaryTablesForResult(result).includes(table.tableName),
    );
  }

  private buildCandidateTableMetrics(
    tables: TableInfo[],
    results: TraceResult[],
  ): Map<string, CandidateTableMetrics> {
    const metrics = new Map<string, CandidateTableMetrics>();
    for (const table of tables) {
      metrics.set(table.tableName, {
        tableName: table.tableName,
        touchedEntryPointCount: 0,
        writeEntryPointCount: 0,
        readEntryPointCount: 0,
        mapperCount: 0,
        primaryResultCount: 0,
        primaryMapperCount: 0,
      });
    }

    for (const result of results) {
      const touchedTables = new Set<string>();
      const writeTables = new Set<string>();
      const readTables = new Set<string>();
      const primaryTables = new Set(this.getPrimaryTablesForResult(result));
      const primaryMappers = new Set(this.getPrimaryMapperNames(result));
      for (const mapper of result.mappers) {
        const operations = new Set(mapper.operations ?? []);
        const hasWriteOperation =
          operations.has("insert") ||
          operations.has("update") ||
          operations.has("delete");
        const hasReadOperation = operations.has("select");
        for (const tableName of mapper.tablesOperated ?? []) {
          const metric = metrics.get(tableName);
          if (!metric) {
            continue;
          }
          touchedTables.add(tableName);
          if (hasWriteOperation) {
            writeTables.add(tableName);
          }
          if (hasReadOperation) {
            readTables.add(tableName);
          }
          metric.mapperCount += 1;
          if (primaryMappers.has(mapper.className)) {
            metric.primaryMapperCount += 1;
          }
        }
      }

      for (const tableName of touchedTables) {
        const metric = metrics.get(tableName);
        if (metric) {
          metric.touchedEntryPointCount += 1;
        }
      }
      for (const tableName of writeTables) {
        const metric = metrics.get(tableName);
        if (metric) {
          metric.writeEntryPointCount += 1;
        }
      }
      for (const tableName of readTables) {
        const metric = metrics.get(tableName);
        if (metric) {
          metric.readEntryPointCount += 1;
        }
      }
      for (const tableName of primaryTables) {
        const metric = metrics.get(tableName);
        if (metric) {
          metric.primaryResultCount += 1;
        }
      }
    }

    return metrics;
  }

  private isOwnedTable(
    table: TableInfo,
    metrics: CandidateTableMetrics | undefined,
    anchorTable: string,
    resultCount: number,
  ): boolean {
    if (LOW_SIGNAL_ANCHORS.has(table.tableName) || !metrics) {
      return false;
    }
    if (table.tableName === anchorTable) {
      return true;
    }

    const touchedCoverage =
      resultCount > 0 ? metrics.touchedEntryPointCount / resultCount : 0;
    const writeCoverage =
      resultCount > 0 ? metrics.writeEntryPointCount / resultCount : 0;
    const primaryCoverage =
      resultCount > 0 ? metrics.primaryResultCount / resultCount : 0;

    return (
      touchedCoverage >= 0.5 &&
      (writeCoverage >= 0.3 || primaryCoverage >= 0.6) &&
      metrics.primaryMapperCount > 0
    );
  }

  private isSupportingTable(
    table: TableInfo,
    metrics: CandidateTableMetrics | undefined,
    anchorTable: string,
    ownedTableNames: string[],
  ): boolean {
    if (
      LOW_SIGNAL_ANCHORS.has(table.tableName) ||
      !metrics ||
      ownedTableNames.includes(table.tableName)
    ) {
      return false;
    }

    const belongsToAnchorFamily = this.shareTableFamily(
      anchorTable,
      table.tableName,
    );
    const hasWriteParticipation = metrics.writeEntryPointCount > 0;
    const hasPrimaryParticipation = metrics.primaryResultCount > 0;

    return (
      belongsToAnchorFamily &&
      (hasWriteParticipation || hasPrimaryParticipation)
    );
  }

  private shareTableFamily(
    leftTableName: string,
    rightTableName: string,
  ): boolean {
    const leftSegments = leftTableName.toLowerCase().split("_").filter(Boolean);
    const rightSegments = rightTableName
      .toLowerCase()
      .split("_")
      .filter(Boolean);
    if (leftSegments.length < 2 || rightSegments.length < 2) {
      return false;
    }

    return (
      leftSegments[0] === rightSegments[0] &&
      leftSegments[1] === rightSegments[1]
    );
  }

  private mergeTables(
    results: TraceResult[],
    tableClassification: TableClassificationResult,
  ): PartitionCandidate["tables"] {
    const mergedTables = this.mergeSourceTables(results);

    return mergedTables
      .filter((table) => {
        if (tableClassification.anchorQuality === "low") {
          return tableClassification.coreTableNames.includes(table.tableName);
        }

        const hasAggregatorSignal = results.some((result) =>
          this.isAggregatorEntryPoint(result.entryPoint, result),
        );
        if (hasAggregatorSignal) {
          return tableClassification.coreTableNames.includes(table.tableName);
        }

        return true;
      })
      .map((table) => ({
        tableName: table.tableName,
        role: table.role,
        tableType: table.tableType,
        foreignKeys: this.extractForeignKeysFromRelation(table),
      }));
  }

  private extractForeignKeysFromRelation(
    table: TableInfo,
  ): { columnName: string; referencesTable: string }[] | undefined {
    if (!table.foreignKey) {
      return undefined;
    }

    const foreignKeyMatch = table.foreignKey.match(/(\w+)\s*→\s*(\w+)\.(\w+)/);
    if (!foreignKeyMatch) {
      return undefined;
    }

    return [
      {
        columnName: foreignKeyMatch[1],
        referencesTable: foreignKeyMatch[2],
      },
    ];
  }

  private mergeMappers(
    results: TraceResult[],
    coreTableNames: string[],
  ): PartitionCandidate["mappers"] {
    const mappers: PartitionCandidate["mappers"] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const mapper of result.mappers) {
        if (addedNames.has(mapper.className)) {
          continue;
        }

        const tablesOperated = mapper.tablesOperated ?? [];
        const primaryMapperNames = this.getPrimaryMapperNames(result);
        const touchesCoreTable = tablesOperated.some((tableName) =>
          coreTableNames.includes(tableName),
        );
        const isPrimaryMapper =
          primaryMapperNames.length === 0 ||
          primaryMapperNames.includes(mapper.className);

        if (!touchesCoreTable || !isPrimaryMapper) {
          continue;
        }

        addedNames.add(mapper.className);
        mappers.push({
          className: mapper.className,
          filePath: mapper.filePath,
          xmlPath: mapper.xmlPath,
          tablesOperated,
        });
      }
    }

    return mappers;
  }

  private mergeServices(
    results: TraceResult[],
  ): PartitionCandidate["services"] {
    const services: PartitionCandidate["services"] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const service of result.services) {
        if (addedNames.has(service.className)) {
          continue;
        }

        addedNames.add(service.className);
        services.push({
          className: service.className,
          filePath: service.filePath,
        });
      }
    }

    return services;
  }

  private computeCallChainSummary(
    results: TraceResult[],
  ): PartitionCandidate["callChainSummary"] {
    let maxDepth = 0;
    let totalPaths = 0;

    for (const result of results) {
      maxDepth = Math.max(maxDepth, result.entryPoint.callChain.length);
      totalPaths += 1;
    }

    return {
      depth: maxDepth,
      pathCount: totalPaths,
    };
  }

  buildCandidateRelations(
    candidates: PartitionCandidate[],
  ): CandidateRelation[] {
    const relations: CandidateRelation[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      for (
        let compareIndex = index + 1;
        compareIndex < candidates.length;
        compareIndex += 1
      ) {
        const relation = this.computeRelation(
          candidates[index],
          candidates[compareIndex],
        );
        if (relation) {
          relations.push(relation);
        }
      }
    }

    logger.info(`Built ${relations.length} candidate relations`);
    return relations;
  }

  private computeRelation(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): CandidateRelation | null {
    const sharedTables = this.findSharedTables(left, right);
    const sharedCoreTables = left.coreTableNames.filter((tableName) =>
      right.coreTableNames.includes(tableName),
    );
    const sharedServices = this.findSharedServices(left, right);
    const sharedMappers = this.findSharedMappers(left, right);
    const tableForeignKeyRelations = this.findForeignKeyRelations(left, right);

    if (
      sharedCoreTables.length === 0 &&
      tableForeignKeyRelations.length === 0 &&
      sharedServices.length === 0 &&
      sharedMappers.length === 0
    ) {
      return null;
    }

    if (
      sharedCoreTables.length === 0 &&
      tableForeignKeyRelations.length === 0 &&
      sharedServices.length === 1 &&
      sharedMappers.length === 0
    ) {
      return null;
    }

    return {
      candidateIdA: left.candidateId,
      candidateIdB: right.candidateId,
      sharedTables,
      sharedCoreTables,
      sharedServices,
      sharedMappers,
      tableForeignKeyRelations,
    };
  }

  private findSharedTables(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): string[] {
    const rightTables = new Set(right.tables.map((table) => table.tableName));
    return left.tables
      .map((table) => table.tableName)
      .filter((tableName) => rightTables.has(tableName));
  }

  private findSharedServices(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): string[] {
    const rightServices = new Set(
      right.services.map((service) => service.className),
    );
    return left.services
      .map((service) => service.className)
      .filter((serviceName) => rightServices.has(serviceName));
  }

  private findSharedMappers(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): string[] {
    const rightMappers = new Set(
      right.mappers.map((mapper) => mapper.className),
    );
    return left.mappers
      .map((mapper) => mapper.className)
      .filter((mapperName) => rightMappers.has(mapperName));
  }

  private findForeignKeyRelations(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): CandidateRelation["tableForeignKeyRelations"] {
    const relations: CandidateRelation["tableForeignKeyRelations"] = [];
    const rightTables = new Set(right.tables.map((table) => table.tableName));
    const leftTables = new Set(left.tables.map((table) => table.tableName));

    for (const table of left.tables) {
      for (const foreignKey of table.foreignKeys ?? []) {
        if (rightTables.has(foreignKey.referencesTable)) {
          relations.push({
            fromTable: table.tableName,
            toTable: foreignKey.referencesTable,
            foreignKey: foreignKey.columnName,
          });
        }
      }
    }

    for (const table of right.tables) {
      for (const foreignKey of table.foreignKeys ?? []) {
        if (leftTables.has(foreignKey.referencesTable)) {
          relations.push({
            fromTable: table.tableName,
            toTable: foreignKey.referencesTable,
            foreignKey: foreignKey.columnName,
          });
        }
      }
    }

    return relations;
  }

  buildCandidateGroups(
    candidates: PartitionCandidate[],
    relations: CandidateRelation[],
  ): CandidateGroup[] {
    const groups: CandidateGroup[] = [];
    const assignedCandidateIds = new Set<string>();

    for (const relation of relations) {
      if (
        relation.sharedCoreTables.length === 0 &&
        relation.tableForeignKeyRelations.length === 0
      ) {
        continue;
      }

      if (
        assignedCandidateIds.has(relation.candidateIdA) ||
        assignedCandidateIds.has(relation.candidateIdB)
      ) {
        continue;
      }

      groups.push({
        groupId: `group_core_${groups.length}`,
        candidates: [relation.candidateIdA, relation.candidateIdB],
        groupReason:
          relation.sharedCoreTables.length > 0
            ? `共享核心表: ${relation.sharedCoreTables.join(", ")}`
            : `外键关联: ${relation.tableForeignKeyRelations
                .map(
                  (relationItem) =>
                    `${relationItem.fromTable}->${relationItem.toTable}`,
                )
                .join(", ")}`,
      });
      assignedCandidateIds.add(relation.candidateIdA);
      assignedCandidateIds.add(relation.candidateIdB);
    }

    for (const candidate of candidates) {
      if (assignedCandidateIds.has(candidate.candidateId)) {
        continue;
      }

      groups.push({
        groupId: `group_single_${groups.length}`,
        candidates: [candidate.candidateId],
        groupReason: `独立候选: ${candidate.anchorTable}`,
      });
      assignedCandidateIds.add(candidate.candidateId);
    }

    logger.info(`Built ${groups.length} candidate groups`);
    return groups;
  }

  buildDomainClusterInput(
    traceResults: TraceResult[],
    repoPath: string,
    moduleNames?: string[],
    schemaRelationGraph?: SchemaRelationGraph,
  ): DomainClusterInput {
    const schemaRelationBuilder = createSchemaRelationBuilder();
    const candidates = this.buildCandidates(traceResults);
    const relationGraph =
      schemaRelationGraph ?? schemaRelationBuilder.build(traceResults);
    const enrichedCandidates = candidates.map((candidate) => ({
      ...candidate,
      evidence: schemaRelationBuilder.buildCandidateEvidence(
        relationGraph,
        candidate,
        candidates,
      ),
    }));
    const candidateRelations = this.buildCandidateRelations(enrichedCandidates);
    const candidateGroups = this.buildCandidateGroups(
      enrichedCandidates,
      candidateRelations,
    );
    const projectContext: ProjectContext = {
      repoPath,
      moduleNames,
    };

    return {
      candidates: enrichedCandidates,
      candidateRelations,
      candidateGroups,
      schemaRelationGraph: relationGraph,
      projectContext,
    };
  }

  computeCandidateContentHash(candidate: PartitionCandidate): string {
    const content = {
      anchorTable: candidate.anchorTable,
      anchorQuality: candidate.anchorQuality,
      ownedTableNames: [...candidate.ownedTableNames].sort(),
      coreTableNames: [...candidate.coreTableNames].sort(),
      supportingTableNames: [...candidate.supportingTableNames].sort(),
      dependencyTableNames: [...candidate.dependencyTableNames].sort(),
      services: candidate.services.map((service) => service.className).sort(),
      mappers: candidate.mappers.map((mapper) => mapper.className).sort(),
    };

    return `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16)}`;
  }

  buildCandidateSnapshot(
    candidates: PartitionCandidate[],
    repoPath: string,
  ): CandidateSnapshot {
    const commitHash = getCurrentCommit(repoPath);
    const entries: CandidateSnapshotEntry[] = candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      entryPointIds: candidate.entryPoints
        .map((entryPoint) => this.generateEntryPointId(entryPoint))
        .sort(),
      contentHash: this.computeCandidateContentHash(candidate),
    }));

    return {
      candidates: entries,
      createdAt: new Date().toISOString(),
      commitHash,
    };
  }

  private isAggregatorEntryPoint(
    entryPoint: EntryPoint,
    result: TraceResult,
  ): boolean {
    const touchedTableCount = result.tables.length;
    const touchedServiceCount = result.services.length;
    const touchedMapperCount = result.mappers.length;
    const callChainDepth = entryPoint.callChain.length;
    const crossDomainCallCount = entryPoint.crossDomainCalls?.length ?? 0;
    const uniqueMapperTables = new Set(
      result.mappers.flatMap((mapper) => mapper.tablesOperated ?? []),
    ).size;

    if (
      touchedTableCount >= 8 ||
      touchedServiceCount >= 3 ||
      touchedMapperCount >= 4 ||
      callChainDepth >= 7 ||
      crossDomainCallCount >= 2 ||
      uniqueMapperTables >= 6
    ) {
      return true;
    }

    return false;
  }

  private selectCandidateResults(results: TraceResult[]): TraceResult[] {
    const domainResults = results.filter(
      (result) => !this.isAggregatorEntryPoint(result.entryPoint, result),
    );

    return domainResults.length > 0 ? domainResults : results;
  }

  private selectPrimaryAlignedResults(
    results: TraceResult[],
    anchorTable: string,
    coreTableNames: string[],
  ): TraceResult[] {
    const affinityTables = new Set([anchorTable, ...coreTableNames]);
    const alignedResults = results.filter((result) => {
      const primaryTables = this.getPrimaryTablesForResult(result);
      if (!primaryTables.some((tableName) => affinityTables.has(tableName))) {
        return false;
      }

      return this.hasStrongAnchorAffinity(result, affinityTables);
    });

    if (alignedResults.length > 0) {
      return alignedResults;
    }

    const fallbackResults = results.filter((result) =>
      result.tables.some((table) => affinityTables.has(table.tableName)),
    );
    return fallbackResults;
  }

  private hasStrongAnchorAffinity(
    result: TraceResult,
    affinityTables: Set<string>,
  ): boolean {
    const operatedTables = result.mappers.flatMap(
      (mapper) => mapper.tablesOperated ?? [],
    );
    const uniqueOperatedTables = [...new Set(operatedTables)];
    if (uniqueOperatedTables.length === 0) {
      return result.tables.some((table) => affinityTables.has(table.tableName));
    }

    const affinityTableCount = uniqueOperatedTables.filter((tableName) =>
      affinityTables.has(tableName),
    ).length;
    if (affinityTableCount === 0) {
      return false;
    }

    if (affinityTableCount === uniqueOperatedTables.length) {
      return true;
    }

    const primaryTables = this.getPrimaryTablesForResult(result);
    if (
      primaryTables.length > 0 &&
      primaryTables.every((tableName) => affinityTables.has(tableName))
    ) {
      return true;
    }

    return affinityTableCount / uniqueOperatedTables.length >= 0.5;
  }

  private getPrimaryMapperNames(result: TraceResult): string[] {
    const scoredMappers = this.buildResultMapperScores(result);
    const winnerScore = scoredMappers[0]?.score;
    if (winnerScore === undefined) {
      return result.mappers
        .filter((mapper) => (mapper.tablesOperated?.length ?? 0) > 0)
        .slice(0, MAX_PRIMARY_MAPPERS_PER_RESULT)
        .map((mapper) => mapper.className);
    }

    return scoredMappers
      .filter((item, index) => {
        if (index >= MAX_PRIMARY_MAPPERS_PER_RESULT) {
          return false;
        }
        return winnerScore - item.score <= PRIMARY_MAPPER_SCORE_GAP;
      })
      .map((item) => item.mapperName);
  }

  private getPrimaryTablesForResult(result: TraceResult): string[] {
    const scoredTables = this.buildResultTableScores(result);
    const winnerScore = scoredTables[0]?.score;
    if (winnerScore === undefined) {
      return [];
    }

    return scoredTables
      .filter((item) => winnerScore - item.score <= PRIMARY_TABLE_SCORE_GAP)
      .map((item) => item.tableName);
  }

  private getPreferredAnchorTableForResult(result: TraceResult): string {
    const primaryTables = this.getPrimaryTablesForResult(result).filter(
      (tableName) => !LOW_SIGNAL_ANCHORS.has(tableName),
    );

    const fallbackPrimaryTable = primaryTables[0];
    if (fallbackPrimaryTable) {
      return fallbackPrimaryTable;
    }

    return this.classifyTables(result.tables, [result]).anchorTable;
  }

  private shouldAbsorbCandidate(
    target: PartitionCandidate,
    source: PartitionCandidate,
  ): boolean {
    if (source.anchorTable === "unknown" || source.anchorTable === "id") {
      return false;
    }

    const targetTableNames = new Set(
      target.tables.map((table) => table.tableName),
    );
    const sourceTableNames = source.tables.map((table) => table.tableName);
    const targetContainsSourceAnchor = targetTableNames.has(source.anchorTable);
    const sourceTableSubset =
      sourceTableNames.length > 0 &&
      sourceTableNames.every((tableName) => targetTableNames.has(tableName));
    if (!targetContainsSourceAnchor && !sourceTableSubset) {
      return false;
    }

    if (!sourceTableSubset && !this.isAbsorbableSupportCandidate(source)) {
      return false;
    }

    return (
      this.shareApiBasePath(target, source) ||
      this.shareControllerClass(target, source) ||
      this.shareService(target, source) ||
      this.shareMapper(target, source)
    );
  }

  private mergeCandidates(
    target: PartitionCandidate,
    source: PartitionCandidate,
  ): PartitionCandidate {
    const entryPoints = this.mergeUniqueByKey(
      [...target.entryPoints, ...source.entryPoints],
      (entryPoint) =>
        `${entryPoint.filePath}:${entryPoint.kind}:${entryPoint.className}:${entryPoint.methodName}`,
    ).sort((left, right) =>
      this.generateEntryPointId(left).localeCompare(
        this.generateEntryPointId(right),
      ),
    );
    const tables = this.mergeUniqueByKey(
      [...target.tables, ...source.tables],
      (table) => table.tableName,
    ).sort((left, right) => left.tableName.localeCompare(right.tableName));
    const mappers = this.mergeUniqueByKey(
      [...target.mappers, ...source.mappers],
      (mapper) => mapper.className,
    ).sort((left, right) => left.className.localeCompare(right.className));
    const services = this.mergeUniqueByKey(
      [...target.services, ...source.services],
      (service) => service.className,
    ).sort((left, right) => left.className.localeCompare(right.className));
    const coreTableNames = [
      ...new Set([...target.coreTableNames, ...source.coreTableNames]),
    ].sort();
    const supportingTableNames = [
      ...new Set([
        ...target.supportingTableNames,
        ...source.supportingTableNames,
      ]),
    ]
      .filter((tableName) => !coreTableNames.includes(tableName))
      .sort();
    const ownedTableNames = [
      ...new Set([...target.ownedTableNames, ...source.ownedTableNames]),
    ].sort();
    const dependencyTableNames = [
      ...new Set([
        ...target.dependencyTableNames,
        ...source.dependencyTableNames,
      ]),
    ]
      .filter(
        (tableName) =>
          !ownedTableNames.includes(tableName) &&
          !supportingTableNames.includes(tableName),
      )
      .sort();

    return {
      ...target,
      anchorQuality:
        target.anchorQuality === "high" || source.anchorQuality === "high"
          ? "high"
          : target.anchorQuality === "medium" ||
              source.anchorQuality === "medium"
            ? "medium"
            : "low",
      isInfrastructureCandidate:
        target.isInfrastructureCandidate && source.isInfrastructureCandidate,
      isAggregatorCandidate:
        target.isAggregatorCandidate || source.isAggregatorCandidate,
      coreTableNames,
      supportingTableNames,
      ownedTableNames,
      dependencyTableNames,
      entryPoints,
      tables,
      mappers,
      services,
      callChainSummary: {
        depth: Math.max(
          target.callChainSummary.depth,
          source.callChainSummary.depth,
        ),
        pathCount:
          target.callChainSummary.pathCount + source.callChainSummary.pathCount,
      },
    };
  }

  private getCandidateStrengthScore(candidate: PartitionCandidate): number {
    const anchorScore =
      candidate.anchorQuality === "high"
        ? 30
        : candidate.anchorQuality === "medium"
          ? 20
          : 10;
    return (
      anchorScore +
      candidate.entryPoints.length * 4 +
      candidate.coreTableNames.length * 3 +
      candidate.services.length * 2 +
      candidate.mappers.length * 2
    );
  }

  private isAbsorbableSupportCandidate(candidate: PartitionCandidate): boolean {
    const hasSingleCoreTable = candidate.coreTableNames.length <= 1;
    const hasNarrowEntrySurface = candidate.entryPoints.length <= 3;
    const hasNarrowServiceSurface = candidate.services.length <= 2;
    const hasNarrowMapperSurface = candidate.mappers.length <= 2;

    return (
      hasSingleCoreTable &&
      hasNarrowEntrySurface &&
      hasNarrowServiceSurface &&
      hasNarrowMapperSurface
    );
  }

  private shareApiBasePath(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): boolean {
    const basePaths = new Set(
      left.entryPoints
        .map((entryPoint) => entryPoint.apiInfo?.basePath)
        .filter((basePath): basePath is string => Boolean(basePath)),
    );
    return right.entryPoints.some((entryPoint) =>
      entryPoint.apiInfo?.basePath
        ? basePaths.has(entryPoint.apiInfo.basePath)
        : false,
    );
  }

  private shareControllerClass(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): boolean {
    const classes = new Set(
      left.entryPoints.map((entryPoint) => entryPoint.className),
    );
    return right.entryPoints.some((entryPoint) =>
      classes.has(entryPoint.className),
    );
  }

  private shareService(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): boolean {
    const services = new Set(left.services.map((service) => service.className));
    return right.services.some((service) => services.has(service.className));
  }

  private shareMapper(
    left: PartitionCandidate,
    right: PartitionCandidate,
  ): boolean {
    const mappers = new Set(left.mappers.map((mapper) => mapper.className));
    return right.mappers.some((mapper) => mappers.has(mapper.className));
  }

  private mergeUniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
    const itemMap = new Map<string, T>();
    for (const item of items) {
      itemMap.set(getKey(item), item);
    }
    return [...itemMap.values()];
  }

  private isStructurallyPeripheralCandidate(
    tables: TableInfo[],
    results: TraceResult[],
  ): boolean {
    const directPrimaryTableCount = results.filter(
      (result) => this.getPrimaryTablesForResult(result).length > 0,
    ).length;
    const distinctEntryPointCount = new Set(
      results.map((result) => this.generateRawEntryPointId(result.entryPoint)),
    ).size;

    return (
      tables.length <= 1 &&
      distinctEntryPointCount <= 2 &&
      directPrimaryTableCount === 0
    );
  }
}

export function createCandidateBuilder(): CandidateBuilder {
  return new CandidateBuilder();
}

export function buildSubjectCandidatesFromClusterInput(
  clusterInput: DomainClusterInput,
  atoms: EvidenceAtom[],
) {
  return discoverSubjectCandidates({
    clusterInput,
    atoms,
  });
}
