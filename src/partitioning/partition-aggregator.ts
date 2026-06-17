/**
 * Partition 聚合器
 *
 * 核心逻辑：
 * 1. 按 Mapper 的 tablesOperated 合并：一个 Mapper 操作多表 → 合并为单 partition
 * 2. 按外键关系合并：oms_order_item.order_id → oms_order.id → 合并
 * 3. 识别跨模块：同一表被不同模块追溯 → isCrossModule = true
 * 4. 支持 LLM 决策合并：根据 DomainMergeDecision 执行精确合并
 */

import type {
  DomainPartition,
  TableInfo,
  EntryPoint,
  MapperInfo,
  ServiceInfo,
  EntityInfo,
  SharedResources,
  BackendModule,
  TraceResult,
  CrossDomainRef,
  ConfidenceBreakdown,
  DomainMergeDecision,
  PartitionCandidate,
  DomainClusterInput,
} from './types.js';
import { createHash } from 'crypto';
import { logger } from '../shared/logger.js';

/**
 * 从域名生成有效的 partitionId
 *
 * 中文域名转换为英文/拼音格式
 */
function generatePartitionId(domainName: string, anchorTable: string): string {
  // 中文到英文/拼音的映射表
  const domainNameMap: Record<string, string> = {
    '教学域': 'teaching',
    '商城域': 'mall',
    '用户与认证域': 'user_auth',
    '积分运营域': 'integral',
    '新闻资讯域': 'news',
    '横幅管理域': 'banner',
    '订单管理域': 'order',
    '支付域': 'payment',
    '课程域': 'course',
    '用户域': 'user',
    '认证域': 'auth',
    '商品域': 'goods',
    '购物车域': 'cart',
    '优惠券域': 'coupon',
    '地址域': 'address',
    '分类域': 'category',
    '模板域': 'template',
    '班级域': 'class',
    '学生域': 'student',
    '教师域': 'teacher',
    '记录域': 'record',
    '上传域': 'upload',
    '会员域': 'member',
    '首页域': 'index',
    '宠物域': 'pet',
    '健康域': 'health',
    '运营域': 'operation',
    '区域域': 'region',
    '商品产品域': 'goods_product',
    '课程模板域': 'course_template',
    '用户课程域': 'user_course',
    '用户班级域': 'user_class',
    '用户时间表域': 'user_timetable',
    '教学内容域': 'teach_content',
  };

  // 尝试从映射表获取
  const mappedName = domainNameMap[domainName];
  if (mappedName) {
    return `domain:${mappedName}`;
  }

  // 尝试从 domainName 提取关键词（去除"域"后缀）
  const baseName = domainName.replace(/域$/i, '').toLowerCase();

  // 如果是纯英文，直接使用
  if (/^[a-z0-9_]+$/.test(baseName)) {
    return `domain:${baseName}`;
  }

  // 否则使用 anchorTable 作为 fallback
  const sanitizedAnchor = anchorTable.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `domain:${sanitizedAnchor}`;
}

/**
 * PartitionAggregator - Partition 聚合器
 */
export class PartitionAggregator {
  private readonly algorithmVersion: string = '1.0.0';

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

  /**
   * 按表分组追溯结果
   */
  private groupByTables(traceResults: TraceResult[]): Map<string, TraceResult[]> {
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
  private buildPartition(anchorTable: string, results: TraceResult[]): DomainPartition {
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
          path: result.entryPoint.filePath.split('/').slice(0, -1).join('/'),
          role: this.determineModuleRole(result.entryPoint),
        });
      }
    }

    // 确定主表角色
    const primaryTable = mergedTables.find(t => t.tableName === anchorTable);
    if (primaryTable) {
      primaryTable.role = 'primary';
    }

    // 其他表标记为 related
    for (const table of mergedTables) {
      if (table.tableName !== anchorTable && table.role === 'primary') {
        table.role = 'related';
      }
    }

    // 构建共享资源
    const sharedResources: SharedResources = {
      coreLogic: mergedServices,
      dataLayer: mergedMappers,
      entities: mergedEntities,
    };

    // 计算 partitionHash
    const partitionHash = this.computePartitionHash(anchorTable, mergedTables, mergedEntryPoints);

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
      lastCommitHash: '', // 后续填充
      updatedAt: new Date().toISOString(),
    };

    return partition;
  }

  /**
   * 合并关联 Partition（外键、分表）
   */
  private mergeRelatedPartitions(partitions: DomainPartition[]): DomainPartition[] {
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
      if (table.foreignKey && table.foreignKey.includes(b.tables[0]?.tableName)) {
        return true;
      }
    }

    // 2. 分表关系：a 的表是 b 主表的分表
    for (const table of a.tables) {
      if (table.role === 'shard' && table.shardGroup === b.tables[0]?.tableName) {
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
  private mergeMultiplePartitions(partitions: DomainPartition[]): DomainPartition {
    const anchorTable = partitions[0].tables.find(t => t.role === 'primary')?.tableName ?? partitions[0].tables[0].tableName;

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
          if (table.role === 'primary' && mergedTables.some(t => t.role === 'primary')) {
            table.role = 'related';
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
      partitionHash: this.computePartitionHash(anchorTable, mergedTables, mergedEntryPoints),
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
      lastCommitHash: '',
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
    const traceDepth = Math.min(1, 0.5 + (serviceCount > 0 ? 0.2 : 0) + (mapperCount > 0 ? 0.2 : 0) + (entityCount > 0 ? 0.1 : 0));

    // 跨模块加成（0 - 0.2）
    const crossModule = moduleCount > 1 ? 0.2 : 0;

    // 多入口点加成（0 - 0.15）
    const multiEntryPoint = Math.min(0.15, (entryPointCount - 1) * 0.05);

    // 表关联加成（0 - 0.1）
    const tableRelation = partition.tables.length > 1 ? Math.min(0.1, (partition.tables.length - 1) * 0.02) : 0;

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
        if (!crossDomainRefs.some(ref => ref.targetDomain === call.targetDomain)) {
          crossDomainRefs.push({
            targetDomain: call.targetDomain,
            relationType: 'service_call',
          });
        }
      }
    }

    partition.crossDomainRefs = crossDomainRefs.length > 0 ? crossDomainRefs : undefined;
  }

  /**
   * 确定模块角色
   */
  private determineModuleRole(entryPoint: EntryPoint): 'entry_and_logic_provider' | 'entry_provider' | 'logic_provider' | 'data_provider' {
    const kind = entryPoint.kind;

    if (kind === 'controller') {
      return 'entry_and_logic_provider';
    }

    if (kind === 'scheduled' || kind === 'mq_consumer') {
      return 'entry_provider';
    }

    return 'entry_provider';
  }

  /**
   * 计算 Partition Hash
   */
  private computePartitionHash(anchorTable: string, tables: TableInfo[], entryPoints: EntryPoint[]): string {
    const data = JSON.stringify({
      anchorTable,
      tableCount: tables.length,
      entryPointCount: entryPoints.length,
      tableNames: tables.map(t => t.tableName).sort(),
    });

    return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
  }

  /**
   * 计算 Content Hash
   */
  private computeContentHash(entryPoints: EntryPoint[], mappers: MapperInfo[]): string {
    const filePaths = [
      ...entryPoints.map(ep => ep.filePath),
      ...mappers.map(m => m.filePath),
    ].sort();

    const data = JSON.stringify(filePaths);
    return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
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
  traceResults: TraceResult[],
  candidates: PartitionCandidate[],
  decisions: DomainMergeDecision[]
): DomainPartition[] {
  const partitions: DomainPartition[] = [];

  // 构建入口点到 TraceResult 的映射（标准化路径格式）
  const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase();

  const entryPointToResult = new Map<string, TraceResult>();
  for (const result of traceResults) {
    const ep = result.entryPoint;
    // 使用 filePath:kind:className 作为 key（不含 methodName）
    const entryPointKey = `${normalizePath(ep.filePath)}:${ep.kind}:${ep.className}`;
    entryPointToResult.set(entryPointKey, result);
  }

  // 构建候选 ID 到 TraceResult 的映射
  const candidateToResults = new Map<string, TraceResult[]>();
  for (const candidate of candidates) {
    const results: TraceResult[] = [];

    // 优先使用入口点匹配
    for (const ep of candidate.entryPoints) {
      const entryPointKey = `${normalizePath(ep.filePath)}:${ep.kind}:${ep.className}`;
      const result = entryPointToResult.get(entryPointKey);
      if (result) {
        results.push(result);
      }
    }

    // 如果入口点匹配失败，回退到 anchorTable 匹配
    if (results.length === 0) {
      const matchingResults = traceResults.filter(r =>
        r.tables.some(t => t.tableName === candidate.anchorTable)
      );
      results.push(...matchingResults);
    }

    candidateToResults.set(candidate.candidateId, results);
  }

  // 根据决策合并
  for (const decision of decisions) {
    const mergedPartition = mergeCandidatesByDecision(
      decision,
      candidates,
      candidateToResults
    );

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

  logger.info(`LLM aggregation: ${decisions.length} decisions → ${partitions.length} partitions`);

  return partitions;
}

/**
 * 根据决策合并候选
 */
function mergeCandidatesByDecision(
  decision: DomainMergeDecision,
  candidates: PartitionCandidate[],
  candidateToResults: Map<string, TraceResult[]>
): DomainPartition | null {
  if (decision.mergeGroup.length === 0) return null;

  // 收集所有涉及的 TraceResult
  const allResults: TraceResult[] = [];
  for (const candidateId of decision.mergeGroup) {
    const results = candidateToResults.get(candidateId);
    if (results) {
      allResults.push(...results);
    }
  }

  if (allResults.length === 0) return null;

  // 合并数据
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

  for (const result of allResults) {
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
      mergedModules.push({
        name: moduleName,
        path: result.entryPoint.filePath.split('/').slice(0, -1).join('/'),
        role: determineModuleRole(result.entryPoint),
      });
    }
  }

  // 确定 anchorTable（使用第一个候选的 anchorTable）
  const firstCandidate = candidates.find(c => c.candidateId === decision.mergeGroup[0]);
  const anchorTable = firstCandidate?.anchorTable ?? mergedTables[0]?.tableName ?? 'unknown';

  // 设置主表角色
  const primaryTable = mergedTables.find(t => t.tableName === anchorTable);
  if (primaryTable) {
    primaryTable.role = 'primary';
  }

  // 其他表标记为 related
  for (const table of mergedTables) {
    if (table.tableName !== anchorTable && table.role === 'primary') {
      table.role = 'related';
    }
  }

  // 构建 partitionId（从 domainName 生成有效 ID）
  const partitionId = generatePartitionId(decision.domainName, anchorTable);

  return {
    partitionId,
    partitionHash: computePartitionHash(anchorTable, mergedTables, mergedEntryPoints),
    algorithmVersion: '2.0.0-llm',

    tables: mergedTables,
    entryPoints: mergedEntryPoints,
    sharedResources: {
      coreLogic: mergedServices,
      dataLayer: mergedMappers,
      entities: mergedEntities,
    },
    backendModules: mergedModules,

    confidenceBreakdown: {
      traceDepth: Math.min(1, 0.5 + (mergedServices.length > 0 ? 0.2 : 0) + (mergedMappers.length > 0 ? 0.2 : 0)),
      crossModule: moduleSet.size > 1 ? 0.2 : 0,
      multiEntryPoint: Math.min(0.15, (mergedEntryPoints.length - 1) * 0.05),
      llmConfidence: decision.confidence,
    },

    contentHash: computeContentHash(mergedEntryPoints, mergedMappers),
    lastCommitHash: '',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 计算跨域引用（独立函数）
 */
function computeCrossDomainRefsForPartition(partition: DomainPartition): void {
  const crossDomainRefs: CrossDomainRef[] = [];

  for (const ep of partition.entryPoints) {
    for (const call of ep.crossDomainCalls ?? []) {
      if (!crossDomainRefs.some(ref => ref.targetDomain === call.targetDomain)) {
        crossDomainRefs.push({
          targetDomain: call.targetDomain,
          relationType: 'service_call',
        });
      }
    }
  }

  partition.crossDomainRefs = crossDomainRefs.length > 0 ? crossDomainRefs : undefined;
}

/**
 * 确定模块角色（独立函数）
 */
function determineModuleRole(entryPoint: EntryPoint): 'entry_and_logic_provider' | 'entry_provider' | 'logic_provider' | 'data_provider' {
  const kind = entryPoint.kind;

  if (kind === 'controller') {
    return 'entry_and_logic_provider';
  }

  if (kind === 'scheduled' || kind === 'mq_consumer') {
    return 'entry_provider';
  }

  return 'entry_provider';
}

/**
 * 计算 Partition Hash（独立函数）
 */
function computePartitionHash(anchorTable: string, tables: TableInfo[], entryPoints: EntryPoint[]): string {
  const data = JSON.stringify({
    anchorTable,
    tableCount: tables.length,
    entryPointCount: entryPoints.length,
    tableNames: tables.map(t => t.tableName).sort(),
  });

  return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
}

/**
 * 计算 Content Hash（独立函数）
 */
function computeContentHash(entryPoints: EntryPoint[], mappers: MapperInfo[]): string {
  const filePaths = [
    ...entryPoints.map(ep => ep.filePath),
    ...mappers.map(m => m.filePath),
  ].sort();

  const data = JSON.stringify(filePaths);
  return `sha256:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
}