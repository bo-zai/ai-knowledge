/**
 * Partition 聚合器
 *
 * 核心逻辑：
 * 1. 按 Mapper 的 tablesOperated 合并：一个 Mapper 操作多表 → 合并为单 partition
 * 2. 按外键关系合并：子表外键指向主表 → 合并
 * 3. 识别跨模块：同一表被不同模块追溯 → isCrossModule = true
 * 4. 支持 LLM 决策合并：根据 DomainMergeDecision 执行精确合并
 */

import type {
  DomainPartition,
  TableInfo,
  TableRole,
  EntryPoint,
  MapperInfo,
  ServiceInfo,
  EntityInfo,
  SharedResources,
  BackendModule,
  TraceResult,
  CrossDomainRef,
  DomainDefinition,
  PartitionCandidate,
} from "./types.js";
import { createHash } from "crypto";
import { logger } from "../shared/logger.js";

/**
 * 从域名生成有效的 partitionId
 *
 * 中文域名转换为英文/拼音格式
 */
function generatePartitionId(domainName: string, anchorTable: string): string {
  const normalizedDomainName = domainName
    .normalize("NFKC")
    .trim()
    .replace(/域$/u, "");
  const asciiSlug = normalizedDomainName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (asciiSlug) {
    return `domain:${asciiSlug}`;
  }

  const anchorSlug = anchorTable
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const domainHash = createHash("sha1")
    .update(normalizedDomainName || anchorTable)
    .digest("hex")
    .slice(0, 8);

  return `domain:${anchorSlug || "unknown"}_${domainHash}`;
}

/**
 * PartitionAggregator - Partition 聚合器
 */
export class PartitionAggregator {
  private readonly algorithmVersion: string = "1.0.0";

  aggregateCandidates(candidates: PartitionCandidate[]): DomainPartition[] {
    const partitions = candidates
      .filter((candidate) => this.shouldMaterializeCandidate(candidate))
      .map((candidate) => this.buildPartitionFromCandidate(candidate));
    const mergedPartitions = this.mergeCandidatePartitions(partitions);

    for (const partition of mergedPartitions) {
      this.computeConfidence(partition);
      this.computeCrossDomainRefs(partition);
    }

    return mergedPartitions;
  }

  private shouldMaterializeCandidate(candidate: PartitionCandidate): boolean {
    if (
      candidate.anchorQuality === "low" &&
      candidate.coreTableNames.length === 0
    ) {
      return false;
    }

    if (candidate.anchorTable === "unknown" || candidate.anchorTable === "id") {
      return false;
    }

    if (
      candidate.isInfrastructureCandidate &&
      candidate.isAggregatorCandidate &&
      candidate.entryPoints.length > 3
    ) {
      return false;
    }

    return true;
  }

  /**
   * 聚合追溯结果为 DomainPartition
   */
  aggregate(traceResults: TraceResult[]): DomainPartition[] {
    // 1. 按表分组追溯结果
    const tableGroups = this.groupByTables(traceResults);

    // 2. 为每个表组构建 Partition
    const partitions: DomainPartition[] = [];

    for (const [anchorTable, results] of tableGroups.entries()) {
      const partition = this.buildPartition(anchorTable, results);
      partitions.push(partition);
    }

    // 3. 合并关联表（外键、分表）
    const mergedPartitions = this.mergeRelatedPartitions(partitions);

    // 4. 计算置信度和跨域引用
    for (const partition of mergedPartitions) {
      this.computeConfidence(partition);
      this.computeCrossDomainRefs(partition);
    }

    return mergedPartitions;
  }

  private buildPartitionFromCandidate(
    candidate: PartitionCandidate,
  ): DomainPartition {
    const tables = (candidate.tables.map((table) => ({
      ...table,
      role: (table.tableName === candidate.anchorTable
        ? "primary"
        : table.role === "primary"
          ? "related"
          : table.role || "related") as TableRole,
    })) as unknown) as TableInfo[];
    const entryPoints = candidate.entryPoints.map((ep) => ({
      ...ep,
      startLine: 0,
      callChain: [],
    })) as unknown as EntryPoint[];
    const backendModules = entryPoints.reduce<BackendModule[]>(
      (modules, entryPoint) => {
        if (modules.some((module) => module.name === entryPoint.module)) {
          return modules;
        }

        modules.push({
          name: entryPoint.module,
          path: entryPoint.filePath.split("/").slice(0, -1).join("/"),
          role: "entry_and_logic_provider",
        });
        return modules;
      },
      [],
    );

    return {
      partitionId: `domain:${candidate.anchorTable}`,
      partitionHash: this.computePartitionHash(
        candidate.anchorTable,
        tables,
        entryPoints,
      ),
      algorithmVersion: this.algorithmVersion,
      tables,
      entryPoints,
      sharedResources: {
        coreLogic: candidate.services.map((service) => ({
          className: service.className,
          filePath: service.filePath,
          module:
            backendModules.find((module) =>
              service.filePath.includes(module.name),
            )?.name ??
            backendModules[0]?.name ??
            "unknown",
        })),
        dataLayer: candidate.mappers.map((mapper) => ({
          className: mapper.className,
          filePath: mapper.filePath,
          xmlPath: mapper.xmlPath,
          module:
            backendModules.find((module) =>
              mapper.filePath.includes(module.name),
            )?.name ??
            backendModules[0]?.name ??
            "unknown",
          tablesOperated: mapper.tablesOperated,
        })),
      },
      backendModules,
      confidenceBreakdown: {
        traceDepth: candidate.callChainSummary.depth >= 4 ? 0.7 : 0.55,
        multiEntryPoint: Math.min(
          0.15,
          Math.max(0, candidate.entryPoints.length - 1) * 0.05,
        ),
        tableRelation: Math.min(
          0.1,
          Math.max(0, candidate.coreTableNames.length - 1) * 0.03,
        ),
      },
      contentHash: this.computeContentHash(
        entryPoints,
        candidate.mappers.map((mapper) => ({
          className: mapper.className,
          filePath: mapper.filePath,
          xmlPath: mapper.xmlPath,
          module: "unknown",
          tablesOperated: mapper.tablesOperated,
        })),
      ),
      lastCommitHash: "",
      updatedAt: new Date().toISOString(),
    };
  }

  private mergeCandidatePartitions(
    partitions: DomainPartition[],
  ): DomainPartition[] {
    const mergedPartitions: DomainPartition[] = [];
    const consumedPartitionIds = new Set<string>();

    for (const partition of partitions) {
      if (consumedPartitionIds.has(partition.partitionId)) {
        continue;
      }

      const mergeGroup = [partition];
      for (const candidate of partitions) {
        if (
          candidate.partitionId === partition.partitionId ||
          consumedPartitionIds.has(candidate.partitionId)
        ) {
          continue;
        }

        if (this.shouldConservativelyMerge(partition, candidate)) {
          mergeGroup.push(candidate);
          consumedPartitionIds.add(candidate.partitionId);
        }
      }

      if (mergeGroup.length > 1) {
        mergedPartitions.push(this.mergeMultiplePartitions(mergeGroup));
      } else {
        mergedPartitions.push(partition);
      }

      consumedPartitionIds.add(partition.partitionId);
    }

    return mergedPartitions;
  }

  private shouldConservativelyMerge(
    left: DomainPartition,
    right: DomainPartition,
  ): boolean {
    const leftPrimaryTable = left.tables.find(
      (table) => table.role === "primary",
    );
    const rightPrimaryTable = right.tables.find(
      (table) => table.role === "primary",
    );
    if (!leftPrimaryTable || !rightPrimaryTable) {
      return false;
    }

    const sharedPrimaryTable =
      leftPrimaryTable.tableName === rightPrimaryTable.tableName;
    if (sharedPrimaryTable) {
      return true;
    }

    const leftPrimaryTouchesRight = left.tables.some((table) =>
      table.foreignKey?.includes(rightPrimaryTable.tableName),
    );
    const rightPrimaryTouchesLeft = right.tables.some((table) =>
      table.foreignKey?.includes(leftPrimaryTable.tableName),
    );

    if (leftPrimaryTouchesRight && rightPrimaryTouchesLeft) {
      return true;
    }
    return false;
  }

  /**
   * 按表分组追溯结果
   */
  private groupByTables(
    traceResults: TraceResult[],
  ): Map<string, TraceResult[]> {
    const tableGroups = new Map<string, TraceResult[]>();

    for (const result of traceResults) {
      for (const table of result.tables) {
        const key = table.tableName;

        if (!tableGroups.has(key)) {
          tableGroups.set(key, []);
        }

        tableGroups.get(key)!.push(result);
      }
    }

    return tableGroups;
  }

  /**
   * 构建单个 Partition
   */
  private buildPartition(
    anchorTable: string,
    results: TraceResult[],
  ): DomainPartition {
    // 合并所有追溯结果
    const mergedTables: TableInfo[] = [];
    const mergedEntryPoints: EntryPoint[] = [];
    const mergedMappers: MapperInfo[] = [];
    const mergedServices: ServiceInfo[] = [];
    const mergedEntities: EntityInfo[] = [];
    const backendModules: BackendModule[] = [];

    const tableSet = new Set<string>();
    const entryPointSet = new Set<string>();
    const mapperSet = new Set<string>();
    const serviceSet = new Set<string>();
    const entitySet = new Set<string>();
    const moduleSet = new Set<string>();

    for (const result of results) {
      // Tables
      for (const table of result.tables) {
        if (!tableSet.has(table.tableName)) {
          tableSet.add(table.tableName);
          mergedTables.push(table);
        }
      }

      // EntryPoints
      const entryKey = `${result.entryPoint.kind}:${result.entryPoint.className}:${result.entryPoint.filePath}`;
      if (!entryPointSet.has(entryKey)) {
        entryPointSet.add(entryKey);
        mergedEntryPoints.push(result.entryPoint);
      }

      // Mappers
      for (const mapper of result.mappers) {
        if (!mapperSet.has(mapper.className)) {
          mapperSet.add(mapper.className);
          mergedMappers.push(mapper);
        }
      }

      // Services
      for (const service of result.services) {
        if (!serviceSet.has(service.className)) {
          serviceSet.add(service.className);
          mergedServices.push(service);
        }
      }

      // Entities
      for (const entity of result.entities) {
        if (!entitySet.has(entity.className)) {
          entitySet.add(entity.className);
          mergedEntities.push(entity);
        }
      }

      // Modules
      const moduleName = result.entryPoint.module;
      if (!moduleSet.has(moduleName)) {
        moduleSet.add(moduleName);
        backendModules.push({
          name: moduleName,
          path: result.entryPoint.filePath.split("/").slice(0, -1).join("/"),
          role: this.determineModuleRole(result.entryPoint),
        });
      }
    }

    // 确定主表角色
    const primaryTable = mergedTables.find((t) => t.tableName === anchorTable);
    if (primaryTable) {
      primaryTable.role = "primary";
    }

    // 其他表标记为 related
    for (const table of mergedTables) {
      if (table.tableName !== anchorTable && table.role === "primary") {
        table.role = "related";
      }
    }

    // 构建共享资源
    const sharedResources: SharedResources = {
      coreLogic: mergedServices,
      dataLayer: mergedMappers,
      entities: mergedEntities,
    };

    // 计算 partitionHash
    const partitionHash = this.computePartitionHash(
      anchorTable,
      mergedTables,
      mergedEntryPoints,
    );

    // 构建 DomainPartition
    const partition: DomainPartition = {
      partitionId: `domain:${anchorTable}`,
      partitionHash,
      algorithmVersion: this.algorithmVersion,

      tables: mergedTables,
      entryPoints: mergedEntryPoints,
      sharedResources,
      backendModules,

      confidenceBreakdown: {
        traceDepth: 0.5,
      },

      contentHash: this.computeContentHash(mergedEntryPoints, mergedMappers),
      lastCommitHash: "", // 后续填充
      updatedAt: new Date().toISOString(),
    };

    return partition;
  }

  /**
   * 合并关联 Partition（外键、分表）
   */
  private mergeRelatedPartitions(
    partitions: DomainPartition[],
  ): DomainPartition[] {
    const result: DomainPartition[] = [];
    const merged = new Set<string>();

    for (const partition of partitions) {
      if (merged.has(partition.partitionId)) continue;

      // 查找需要合并的 Partition
      const toMerge: DomainPartition[] = [partition];

      for (const other of partitions) {
        if (other.partitionId === partition.partitionId) continue;
        if (merged.has(other.partitionId)) continue;

        // 检查是否需要合并
        if (this.shouldMerge(partition, other)) {
          toMerge.push(other);
          merged.add(other.partitionId);
        }
      }

      // 合并多个 Partition
      if (toMerge.length > 1) {
        const mergedPartition = this.mergeMultiplePartitions(toMerge);
        result.push(mergedPartition);
        merged.add(partition.partitionId);
      } else {
        result.push(partition);
        merged.add(partition.partitionId);
      }
    }

    return result;
  }

  /**
   * 判断是否需要合并
   */
  private shouldMerge(a: DomainPartition, b: DomainPartition): boolean {
    // 1. 外键关系：a 有表指向 b 的主表
    for (const table of a.tables) {
      if (
        table.foreignKey &&
        table.foreignKey.includes(b.tables[0]?.tableName)
      ) {
        return true;
      }
    }

    // 2. 分表关系：a 的表是 b 主表的分表
    for (const table of a.tables) {
      if (
        table.role === "shard" &&
        table.shardGroup === b.tables[0]?.tableName
      ) {
        return true;
      }
    }

    // 3. Mapper 多表：同一个 Mapper 操作两个 Partition 的主表
    for (const mapperA of a.sharedResources?.dataLayer ?? []) {
      for (const mapperB of b.sharedResources?.dataLayer ?? []) {
        if (mapperA.className === mapperB.className) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 合并多个 Partition
   */
  private mergeMultiplePartitions(
    partitions: DomainPartition[],
  ): DomainPartition {
    const anchorTable =
      partitions[0].tables.find((t) => t.role === "primary")?.tableName ??
      partitions[0].tables[0].tableName;

    const mergedTables: TableInfo[] = [];
    const mergedEntryPoints: EntryPoint[] = [];
    const mergedMappers: MapperInfo[] = [];
    const mergedServices: ServiceInfo[] = [];
    const mergedEntities: EntityInfo[] = [];
    const mergedModules: BackendModule[] = [];

    const tableSet = new Set<string>();
    const entryPointSet = new Set<string>();
    const mapperSet = new Set<string>();
    const serviceSet = new Set<string>();
    const entitySet = new Set<string>();
    const moduleSet = new Set<string>();

    for (const partition of partitions) {
      for (const table of partition.tables) {
        if (!tableSet.has(table.tableName)) {
          tableSet.add(table.tableName);
          // 主表只保留第一个
          if (
            table.role === "primary" &&
            mergedTables.some((t) => t.role === "primary")
          ) {
            table.role = "related";
          }
          mergedTables.push(table);
        }
      }

      for (const ep of partition.entryPoints) {
        const key = `${ep.kind}:${ep.className}:${ep.filePath}`;
        if (!entryPointSet.has(key)) {
          entryPointSet.add(key);
          mergedEntryPoints.push(ep);
        }
      }

      for (const mapper of partition.sharedResources?.dataLayer ?? []) {
        if (!mapperSet.has(mapper.className)) {
          mapperSet.add(mapper.className);
          mergedMappers.push(mapper);
        }
      }

      for (const service of partition.sharedResources?.coreLogic ?? []) {
        if (!serviceSet.has(service.className)) {
          serviceSet.add(service.className);
          mergedServices.push(service);
        }
      }

      for (const entity of partition.sharedResources?.entities ?? []) {
        if (!entitySet.has(entity.className)) {
          entitySet.add(entity.className);
          mergedEntities.push(entity);
        }
      }

      for (const module of partition.backendModules) {
        if (!moduleSet.has(module.name)) {
          moduleSet.add(module.name);
          mergedModules.push(module);
        }
      }
    }

    return {
      partitionId: `domain:${anchorTable}`,
      partitionHash: this.computePartitionHash(
        anchorTable,
        mergedTables,
        mergedEntryPoints,
      ),
      algorithmVersion: this.algorithmVersion,

      tables: mergedTables,
      entryPoints: mergedEntryPoints,
      sharedResources: {
        coreLogic: mergedServices,
        dataLayer: mergedMappers,
        entities: mergedEntities,
      },
      backendModules: mergedModules,

      confidenceBreakdown: {
        traceDepth: 0.7,
        crossModule: moduleSet.size > 1 ? 0.2 : 0,
        multiEntryPoint: entryPointSet.size > 1 ? 0.15 : 0,
      },

      contentHash: this.computeContentHash(mergedEntryPoints, mergedMappers),
      lastCommitHash: "",
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 计算置信度
   */
  private computeConfidence(partition: DomainPartition): void {
    const entryPointCount = partition.entryPoints.length;
    const moduleCount = partition.backendModules.length;
    const serviceCount = partition.sharedResources?.coreLogic?.length ?? 0;
    const mapperCount = partition.sharedResources?.dataLayer?.length ?? 0;
    const entityCount = partition.sharedResources?.entities?.length ?? 0;

    // 追溯深度（0.5 - 1.0）
    const traceDepth = Math.min(
      1,
      0.5 +
        (serviceCount > 0 ? 0.2 : 0) +
        (mapperCount > 0 ? 0.2 : 0) +
        (entityCount > 0 ? 0.1 : 0),
    );

    // 跨模块加成（0 - 0.2）
    const crossModule = moduleCount > 1 ? 0.2 : 0;

    // 多入口点加成（0 - 0.15）
    const multiEntryPoint = Math.min(0.15, (entryPointCount - 1) * 0.05);

    // 表关联加成（0 - 0.1）
    const tableRelation =
      partition.tables.length > 1
        ? Math.min(0.1, (partition.tables.length - 1) * 0.02)
        : 0;

    partition.confidenceBreakdown = {
      traceDepth,
      crossModule,
      multiEntryPoint,
      tableRelation,
    };
  }

  /**
   * 计算跨域引用
   */
  private computeCrossDomainRefs(partition: DomainPartition): void {
    const crossDomainRefs: CrossDomainRef[] = [];

    for (const ep of partition.entryPoints) {
      for (const call of ep.crossDomainCalls ?? []) {
        if (
          !crossDomainRefs.some((ref) => ref.targetDomain === call.targetDomain)
        ) {
          crossDomainRefs.push({
            targetDomain: call.targetDomain,
            relationType: "service_call",
          });
        }
      }
    }

    partition.crossDomainRefs =
      crossDomainRefs.length > 0 ? crossDomainRefs : undefined;
  }

  /**
   * 确定模块角色
   */
  private determineModuleRole(
    entryPoint: EntryPoint,
  ):
    | "entry_and_logic_provider"
    | "entry_provider"
    | "logic_provider"
    | "data_provider" {
    const kind = entryPoint.kind;

    if (kind === "controller") {
      return "entry_and_logic_provider";
    }

    if (kind === "scheduled" || kind === "mq_consumer") {
      return "entry_provider";
    }

    return "entry_provider";
  }

  /**
   * 计算 Partition Hash
   */
  private computePartitionHash(
    anchorTable: string,
    tables: TableInfo[],
    entryPoints: EntryPoint[],
  ): string {
    const data = JSON.stringify({
      anchorTable,
      tableCount: tables.length,
      entryPointCount: entryPoints.length,
      tableNames: tables.map((t) => t.tableName).sort(),
    });

    return `sha256:${createHash("sha256").update(data).digest("hex").slice(0, 16)}`;
  }

  /**
   * 计算 Content Hash
   */
  private computeContentHash(
    entryPoints: EntryPoint[],
    mappers: MapperInfo[],
  ): string {
    const filePaths = [
      ...entryPoints.map((ep) => ep.filePath),
      ...mappers.map((m) => m.filePath),
    ].sort();

    const data = JSON.stringify(filePaths);
    return `sha256:${createHash("sha256").update(data).digest("hex").slice(0, 16)}`;
  }
}

/**
 * 创建 PartitionAggregator 实例
 */
export function createPartitionAggregator(): PartitionAggregator {
  return new PartitionAggregator();
}

/**
 * 根据 LLM 决策聚合 Partition
 *
 * 使用 DomainMergeDecision 精确合并候选，而非静态规则
 */
export function aggregateWithLLMDecisions(
  candidates: PartitionCandidate[],
  decisions: DomainDefinition[],
): DomainPartition[] {
  const partitions: DomainPartition[] = [];

  // 根据决策合并
  for (const decision of decisions) {
    const mergedPartition = mergeCandidatesByDecision(decision, candidates);

    if (mergedPartition) {
      // 设置置信度
      mergedPartition.confidenceBreakdown.llmConfidence = decision.confidence;
      mergedPartition.domainKeywords = [decision.domainName];

      partitions.push(mergedPartition);
    }
  }

  // 计算跨域引用
  for (const partition of partitions) {
    computeCrossDomainRefsForPartition(partition);
  }

  logger.info(
    `LLM aggregation: ${decisions.length} decisions → ${partitions.length} partitions`,
  );

  return partitions;
}

/**
 * 根据决策合并候选
 */
function mergeCandidatesByDecision(
  decision: DomainDefinition,
  candidates: PartitionCandidate[],
): DomainPartition | null {
  const includedCandidateIds = [
    ...decision.coreCandidateIds,
    ...decision.supportingCandidateIds,
  ];
  if (includedCandidateIds.length === 0) return null;

  const selectedCandidates = includedCandidateIds
    .map((candidateId) =>
      candidates.find((candidate) => candidate.candidateId === candidateId),
    )
    .filter((candidate): candidate is PartitionCandidate => Boolean(candidate));
  if (selectedCandidates.length === 0) {
    return null;
  }

  const mergedTables: TableInfo[] = [];
  const mergedEntryPoints: EntryPoint[] = [];
  const mergedMappers: MapperInfo[] = [];
  const mergedServices: ServiceInfo[] = [];
  const mergedModules: BackendModule[] = [];
  const crossDomainRefs: CrossDomainRef[] = [];

  const tableSet = new Set<string>();
  const entryPointSet = new Set<string>();
  const mapperSet = new Set<string>();
  const serviceSet = new Set<string>();
  const moduleSet = new Set<string>();
  const includedCandidateIdSet = new Set(includedCandidateIds);
  const allowedTableNames = new Set([
    ...decision.coreTables,
    ...decision.supportingTables,
  ]);
  const domainTokens = new Set([
    ...extractNameTokens(decision.domainName),
    ...[...allowedTableNames].flatMap((tableName) =>
      extractNameTokens(tableName),
    ),
  ]);

  for (const candidate of selectedCandidates) {
    for (const table of candidate.tables) {
      if (
        allowedTableNames.size > 0 &&
        !allowedTableNames.has(table.tableName)
      ) {
        continue;
      }
      if (!tableSet.has(table.tableName)) {
        tableSet.add(table.tableName);
        mergedTables.push({
          tableName: table.tableName,
          role: "related",
          tableType: table.tableType,
          foreignKey: table.foreignKeys
            ?.map(
              (foreignKey) =>
                `${foreignKey.columnName} → ${foreignKey.referencesTable}.id`,
            )
            .join(", "),
        });
      }
    }

    for (const entryPoint of candidate.entryPoints) {
      if (
        !shouldIncludeEntryPointForDecision(
          candidate,
          entryPoint,
          allowedTableNames,
          domainTokens,
        )
      ) {
        continue;
      }

      const entryKey = `${entryPoint.kind}:${entryPoint.className}:${entryPoint.filePath}:${entryPoint.methodName}`;
      if (entryPointSet.has(entryKey)) {
        continue;
      }

      entryPointSet.add(entryKey);
      mergedEntryPoints.push({
        ...entryPoint,
        startLine: 0,
        callChain: [],
      } as unknown as EntryPoint);
    }

    for (const mapper of candidate.mappers) {
      if (
        allowedTableNames.size > 0 &&
        mapper.tablesOperated.length > 0 &&
        !mapper.tablesOperated.some((tableName) =>
          allowedTableNames.has(tableName),
        )
      ) {
        continue;
      }

      if (!mapperSet.has(mapper.className)) {
        mapperSet.add(mapper.className);
        mergedMappers.push({
          className: mapper.className,
          filePath: mapper.filePath,
          xmlPath: mapper.xmlPath,
          module: "unknown",
          tablesOperated: mapper.tablesOperated,
        });
      }
    }

    for (const service of candidate.services) {
      if (
        allowedTableNames.size > 0 &&
        !shouldIncludeServiceForDecision(
          service.className,
          candidate,
          domainTokens,
        )
      ) {
        continue;
      }

      if (!serviceSet.has(service.className)) {
        serviceSet.add(service.className);
        mergedServices.push({
          className: service.className,
          filePath: service.filePath,
          module: "unknown",
        });
      }
    }

    for (const entryPoint of candidate.entryPoints) {
      if (
        !shouldIncludeEntryPointForDecision(
          candidate,
          entryPoint,
          allowedTableNames,
          domainTokens,
        )
      ) {
        continue;
      }

      const moduleName = entryPoint.module;
      if (!moduleSet.has(moduleName)) {
        moduleSet.add(moduleName);
        mergedModules.push({
          name: moduleName,
          path: entryPoint.filePath.split("/").slice(0, -1).join("/"),
          role: determineModuleRole({
            ...entryPoint,
            startLine: 0,
            callChain: [],
          } as unknown as EntryPoint),
        });
      }
    }

    for (const dependency of decision.crossDomainDependencies) {
      if (
        !crossDomainRefs.some(
          (item) =>
            item.targetDomain === dependency.targetDomainHint &&
            item.relationType === dependency.relationType,
        )
      ) {
        crossDomainRefs.push({
          targetDomain: dependency.targetDomainHint,
          relationType: dependency.relationType,
          evidence: dependency.evidence,
        });
      }
    }

    appendSchemaDerivedCrossDomainRefs(
      crossDomainRefs,
      candidate,
      includedCandidateIdSet,
      candidates,
      allowedTableNames,
    );
  }

  const firstCandidate = selectedCandidates[0];
  const anchorTable =
    decision.coreTables[0] ??
    firstCandidate?.anchorTable ??
    mergedTables[0]?.tableName ??
    "unknown";

  if (mergedTables.length === 0) {
    return null;
  }

  for (const table of mergedTables) {
    table.role = table.tableName === anchorTable ? "primary" : "related";
  }

  // 构建 partitionId（从 domainName 生成有效 ID）
  const partitionId = generatePartitionId(decision.domainName, anchorTable);

  return {
    partitionId,
    partitionHash: computePartitionHash(
      anchorTable,
      mergedTables,
      mergedEntryPoints,
    ),
    algorithmVersion: "2.0.0-llm",

    tables: mergedTables,
    entryPoints: mergedEntryPoints,
    sharedResources: {
      coreLogic: mergedServices,
      dataLayer: mergedMappers,
    },
    backendModules: mergedModules,
    crossDomainRefs: crossDomainRefs.length > 0 ? crossDomainRefs : undefined,

    confidenceBreakdown: {
      traceDepth: Math.min(
        1,
        0.5 +
          (mergedServices.length > 0 ? 0.2 : 0) +
          (mergedMappers.length > 0 ? 0.2 : 0),
      ),
      crossModule: moduleSet.size > 1 ? 0.2 : 0,
      multiEntryPoint: Math.min(0.15, (mergedEntryPoints.length - 1) * 0.05),
      llmConfidence: decision.confidence,
    },

    contentHash: computeContentHash(mergedEntryPoints, mergedMappers),
    lastCommitHash: "",
    updatedAt: new Date().toISOString(),
  };
}

function appendSchemaDerivedCrossDomainRefs(
  refs: CrossDomainRef[],
  candidate: PartitionCandidate,
  includedCandidateIdSet: Set<string>,
  allCandidates: PartitionCandidate[],
  allowedTableNames: Set<string>,
): void {
  const evidence = candidate.evidence;
  if (!evidence) {
    return;
  }

  const candidateByTable = new Map<string, PartitionCandidate>();
  for (const item of allCandidates) {
    for (const table of item.tables) {
      if (!candidateByTable.has(table.tableName)) {
        candidateByTable.set(table.tableName, item);
      }
    }
  }

  const relatedRelations = [
    ...evidence.outboundRelations,
    ...evidence.inboundRelations,
  ];

  for (const relation of relatedRelations) {
    const localTable = allowedTableNames.has(relation.sourceTable)
      ? relation.sourceTable
      : allowedTableNames.has(relation.targetTable)
        ? relation.targetTable
        : null;
    if (!localTable) {
      continue;
    }

    const remoteTable =
      localTable === relation.sourceTable
        ? relation.targetTable
        : relation.sourceTable;
    const targetCandidate = candidateByTable.get(remoteTable);
    if (!targetCandidate) {
      continue;
    }
    if (includedCandidateIdSet.has(targetCandidate.candidateId)) {
      continue;
    }

    const relationType = mapSchemaRelationToCrossDomainRelation(
      relation.relationType,
    );
    if (
      refs.some(
        (item) =>
          item.targetDomain === targetCandidate.anchorTable &&
          item.relationType === relationType,
      )
    ) {
      continue;
    }

    refs.push({
      targetDomain: targetCandidate.anchorTable,
      relationType,
      evidence: relation.evidence,
    });
  }
}

function mapSchemaRelationToCrossDomainRelation(
  relationType: string,
): CrossDomainRef["relationType"] {
  switch (relationType) {
    case "explicit_fk":
    case "implicit_fk":
    case "extension_table":
      return "shared_table_reference";
    case "aggregate_child":
      return "aggregate_dependency";
    case "junction_table":
      return "junction_dependency";
    case "weak_reference":
      return "weak_identity_reference";
    default:
      return "shared_table_reference";
  }
}

function shouldIncludeEntryPointForDecision(
  candidate: PartitionCandidate,
  entryPoint: PartitionCandidate["entryPoints"][number],
  allowedTableNames: Set<string>,
  domainTokens: Set<string>,
): boolean {
  if (allowedTableNames.size === 0) {
    return true;
  }

  if (allowedTableNames.has(candidate.anchorTable)) {
    return true;
  }

  if (candidate.entryPoints.length === 1) {
    return true;
  }

  const entryPointTokens = new Set([
    ...extractNameTokens(entryPoint.className),
    ...extractNameTokens(entryPoint.methodName),
    ...extractNameTokens(entryPoint.apiInfo?.basePath ?? ""),
  ]);

  return hasTokenOverlap(entryPointTokens, domainTokens);
}

function shouldIncludeServiceForDecision(
  serviceClassName: string,
  candidate: PartitionCandidate,
  domainTokens: Set<string>,
): boolean {
  if (candidate.coreTableNames.length <= 1) {
    return true;
  }

  return hasTokenOverlap(
    new Set(extractNameTokens(serviceClassName)),
    domainTokens,
  );
}

function hasTokenOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const token of left) {
    if (right.has(token)) {
      return true;
    }
  }
  return false;
}

function extractNameTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2);
}

/**
 * 计算跨域引用（独立函数）
 */
function computeCrossDomainRefsForPartition(partition: DomainPartition): void {
  const crossDomainRefs: CrossDomainRef[] = [];

  for (const ep of partition.entryPoints) {
    for (const call of ep.crossDomainCalls ?? []) {
      if (
        !crossDomainRefs.some((ref) => ref.targetDomain === call.targetDomain)
      ) {
        crossDomainRefs.push({
          targetDomain: call.targetDomain,
          relationType: "service_call",
        });
      }
    }
  }

  partition.crossDomainRefs =
    crossDomainRefs.length > 0 ? crossDomainRefs : undefined;
}

/**
 * 确定模块角色（独立函数）
 */
function determineModuleRole(
  entryPoint: EntryPoint,
):
  | "entry_and_logic_provider"
  | "entry_provider"
  | "logic_provider"
  | "data_provider" {
  const kind = entryPoint.kind;

  if (kind === "controller") {
    return "entry_and_logic_provider";
  }

  if (kind === "scheduled" || kind === "mq_consumer") {
    return "entry_provider";
  }

  return "entry_provider";
}

/**
 * 计算 Partition Hash（独立函数）
 */
function computePartitionHash(
  anchorTable: string,
  tables: TableInfo[],
  entryPoints: EntryPoint[],
): string {
  const data = JSON.stringify({
    anchorTable,
    tableCount: tables.length,
    entryPointCount: entryPoints.length,
    tableNames: tables.map((t) => t.tableName).sort(),
  });

  return `sha256:${createHash("sha256").update(data).digest("hex").slice(0, 16)}`;
}

/**
 * 计算 Content Hash（独立函数）
 */
function computeContentHash(
  entryPoints: EntryPoint[],
  mappers: MapperInfo[],
): string {
  const filePaths = [
    ...entryPoints.map((ep) => ep.filePath),
    ...mappers.map((m) => m.filePath),
  ].sort();

  const data = JSON.stringify(filePaths);
  return `sha256:${createHash("sha256").update(data).digest("hex").slice(0, 16)}`;
}
