/**
 * 表锚点聚合器
 *
 * 以数据库表为唯一锚点聚合多个追溯路径：
 * - 同一张表被多个模块追溯 → isCrossModule = true → 置信度 +0.2
 * - 同一张表被多个入口点追溯 → 多场景覆盖 → 置信度加权
 * - 计算 aggregatedConfidence（跨模块 +0.2，多入口 +0.05 per kind）
 */

import type {
  TableAnchor,
  TableTraceSource,
  DiscoveryPathResult,
  ConceptTracePath,
  EntryPointInfo,
  EntityInfo,
  MapperInfo,
} from './types.js';

/**
 * 表锚点聚合器配置
 */
export interface TableAnchorAggregatorConfig {
  /** 跨模块置信度加成，默认 0.2 */
  crossModuleBonus?: number;
  /** 每种入口类型的置信度加成，默认 0.05 */
  entryPointKindBonus?: number;
  /** 基础置信度，默认 0.6 */
  baseConfidence?: number;
}

/**
 * 内部结构：追溯来源上下文
 */
interface TraceSourceContext {
  tracePath: ConceptTracePath;
  discoveryResult: DiscoveryPathResult;
  tableIndex: number;
}

/**
 * 表锚点聚合器
 *
 * 将多个发现途径的结果按表名聚合，识别跨模块候选和多入口覆盖。
 */
export class TableAnchorAggregator {
  private readonly config: Required<TableAnchorAggregatorConfig>;

  constructor(config?: TableAnchorAggregatorConfig) {
    this.config = {
      crossModuleBonus: config?.crossModuleBonus ?? 0.2,
      entryPointKindBonus: config?.entryPointKindBonus ?? 0.05,
      baseConfidence: config?.baseConfidence ?? 0.6,
    };
  }

  /**
   * 聚合发现结果
   *
   * @param discoveryResults - 多个发现途径的结果
   * @returns 按表名聚合的 TableAnchor 数组
   */
  aggregate(discoveryResults: DiscoveryPathResult[]): TableAnchor[] {
    // 按 tableName 分组所有追溯路径
    const tableGroups = this.groupByTable(discoveryResults);

    // 为每个表构建 TableAnchor
    const tableAnchors: TableAnchor[] = [];

    for (const [tableName, contexts] of Array.from(tableGroups.entries())) {
      const anchor = this.buildTableAnchor(tableName, contexts, discoveryResults);
      tableAnchors.push(anchor);
    }

    return tableAnchors;
  }

  /**
   * 按表名分组追溯路径
   */
  private groupByTable(
    discoveryResults: DiscoveryPathResult[],
  ): Map<string, TraceSourceContext[]> {
    const tableGroups = new Map<string, TraceSourceContext[]>();

    for (const result of discoveryResults) {
      for (const tracePath of result.tracePaths) {
        for (let tableIndex = 0; tableIndex < tracePath.tables.length; tableIndex++) {
          const table = tracePath.tables[tableIndex];
          const context: TraceSourceContext = {
            tracePath,
            discoveryResult: result,
            tableIndex,
          };

          const existing = tableGroups.get(table.tableName) || [];
          existing.push(context);
          tableGroups.set(table.tableName, existing);
        }
      }
    }

    return tableGroups;
  }

  /**
   * 构建 TableAnchor
   */
  private buildTableAnchor(
    tableName: string,
    contexts: TraceSourceContext[],
    discoveryResults: DiscoveryPathResult[],
  ): TableAnchor {
    // 构建 TableTraceSource 列表
    const traceSources = this.buildTableTraceSources(contexts);

    // 收集模块信息
    const moduleNames = new Set<string>();

    for (const source of traceSources) {
      if (source.moduleName) {
        moduleNames.add(source.moduleName);
      }
    }

    const isCrossModule = moduleNames.size > 1;

    // 收集入口类型
    const entryPointKinds = new Set<string>();
    for (const source of traceSources) {
      for (const ep of source.entryPoints) {
        entryPointKinds.add(ep.kind);
      }
    }

    // 计算聚合置信度
    const aggregatedConfidence = this.calculateAggregatedConfidence(
      isCrossModule,
      entryPointKinds.size,
      traceSources,
    );

    // 收集列信息
    const columns = this.collectColumns(contexts);

    // 收集 schema（如果存在）
    const schema = this.extractSchema(contexts);

    return {
      tableName,
      schema,
      columns,
      traceSources,
      isCrossModule,
      moduleCount: moduleNames.size,
      moduleNames: Array.from(moduleNames),
      aggregatedConfidence,
    };
  }

  /**
   * 构建 TableTraceSource 列表
   *
   * 去重：同一模块对同一表的多次追溯只保留一次
   */
  private buildTableTraceSources(contexts: TraceSourceContext[]): TableTraceSource[] {
    const sourceMap = new Map<string, TableTraceSource>();

    for (const ctx of contexts) {
      const key = this.getSourceKey(ctx);

      if (!sourceMap.has(key)) {
        const source = this.buildTableTraceSource(ctx);
        sourceMap.set(key, source);
      }
    }

    return Array.from(sourceMap.values());
  }

  /**
   * 获取追溯来源的唯一键
   *
   * 使用 modulePath + entityClassName 作为键，确保同一模块对同一表的追溯去重
   */
  private getSourceKey(ctx: TraceSourceContext): string {
    const { tracePath } = ctx;
    const modulePath = this.extractModulePath(ctx);
    const entity = this.findRelatedEntity(ctx);
    const mapper = this.findRelatedMapper(ctx);

    return `${modulePath}:${entity?.className || mapper?.className || 'unknown'}`;
  }

  /**
   * 构建单个 TableTraceSource
   */
  private buildTableTraceSource(ctx: TraceSourceContext): TableTraceSource {
    const { tracePath, discoveryResult } = ctx;

    // 获取模块信息
    const modulePath = this.extractModulePath(ctx);
    const moduleName = this.extractModuleName(ctx);

    // 获取相关的 Entity 和 Mapper
    const entity = this.findRelatedEntity(ctx);
    const mapper = this.findRelatedMapper(ctx);

    // 收集入口点
    const entryPoints = this.collectEntryPoints(ctx);

    // 计算置信度
    const confidence = this.calculateTraceSourceConfidence(ctx);

    return {
      modulePath,
      moduleName,
      entityClassName: entity?.className || '',
      entityFilePath: entity?.filePath || '',
      entryPoints,
      mapperClassName: mapper?.className || '',
      mapperFilePath: mapper?.filePath || '',
      confidence,
    };
  }

  /**
   * 提取模块路径
   */
  private extractModulePath(ctx: TraceSourceContext): string {
    const { tracePath } = ctx;

    // 优先从入口点获取
    if (tracePath.entryPoints.length > 0) {
      return tracePath.entryPoints[0].modulePath;
    }

    // 从 Service 链获取
    if (tracePath.serviceChain && tracePath.serviceChain.length > 0) {
      return tracePath.serviceChain[0].modulePath;
    }

    // 从 Mapper 获取
    if (tracePath.mappers.length > 0) {
      return tracePath.mappers[0].modulePath;
    }

    // 从 Entity 获取
    if (tracePath.entities.length > 0) {
      return tracePath.entities[0].modulePath;
    }

    return '';
  }

  /**
   * 提取模块名称
   */
  private extractModuleName(ctx: TraceSourceContext): string {
    const { tracePath } = ctx;

    // 优先从入口点获取
    if (tracePath.entryPoints.length > 0) {
      return tracePath.entryPoints[0].moduleName;
    }

    // 从 Service 链获取
    if (tracePath.serviceChain && tracePath.serviceChain.length > 0) {
      return tracePath.serviceChain[0].moduleName;
    }

    // 从 Mapper 获取
    if (tracePath.mappers.length > 0) {
      return tracePath.mappers[0].moduleName;
    }

    // 从 Entity 获取
    if (tracePath.entities.length > 0) {
      return tracePath.entities[0].moduleName;
    }

    return '';
  }

  /**
   * 查找与表相关的 Entity
   *
   * 策略：
   * 1. 如果只有一个 Entity，假设它对所有表相关
   * 2. 如果有多个 Entity，尝试通过命名约定匹配
   */
  private findRelatedEntity(ctx: TraceSourceContext): EntityInfo | undefined {
    const { tracePath, tableIndex } = ctx;

    if (tracePath.entities.length === 0) {
      return undefined;
    }

    // 如果只有一个 Entity 或表数量与 Entity 数量匹配
    if (tracePath.entities.length === 1 || tracePath.entities.length === tracePath.tables.length) {
      return tracePath.entities[Math.min(tableIndex, tracePath.entities.length - 1)];
    }

    // 默认返回第一个
    return tracePath.entities[0];
  }

  /**
   * 查找与表相关的 Mapper
   */
  private findRelatedMapper(ctx: TraceSourceContext): MapperInfo | undefined {
    const { tracePath, tableIndex } = ctx;

    if (tracePath.mappers.length === 0) {
      return undefined;
    }

    // 如果只有一个 Mapper 或表数量与 Mapper 数量匹配
    if (tracePath.mappers.length === 1 || tracePath.mappers.length === tracePath.tables.length) {
      return tracePath.mappers[Math.min(tableIndex, tracePath.mappers.length - 1)];
    }

    // 默认返回第一个
    return tracePath.mappers[0];
  }

  /**
   * 收集入口点信息
   */
  private collectEntryPoints(ctx: TraceSourceContext): EntryPointInfo[] {
    return ctx.tracePath.entryPoints;
  }

  /**
   * 计算单个追溯来源的置信度
   */
  private calculateTraceSourceConfidence(ctx: TraceSourceContext): number {
    const { tracePath } = ctx;
    let confidence = this.config.baseConfidence;

    // 有完整的 Service 链
    if (tracePath.serviceChain && tracePath.serviceChain.length > 0) {
      confidence += 0.1;
    }

    // 有 Mapper
    if (tracePath.mappers.length > 0) {
      confidence += 0.1;
    }

    // 有 Entity
    if (tracePath.entities.length > 0) {
      confidence += 0.1;
    }

    // 多个入口点
    if (tracePath.entryPoints.length > 1) {
      confidence += 0.05;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * 计算聚合置信度
   *
   * - 基础值：所有来源置信度的平均值
   * - 跨模块加成：+0.2
   * - 多入口类型加成：每种类型 +0.05
   */
  private calculateAggregatedConfidence(
    isCrossModule: boolean,
    entryPointKindCount: number,
    sources: TableTraceSource[],
  ): number {
    if (sources.length === 0) {
      return 0;
    }

    // 基础置信度取所有来源的平均值
    let confidence = 0;
    for (const source of sources) {
      confidence += source.confidence;
    }
    confidence = confidence / sources.length;

    // 跨模块加成
    if (isCrossModule) {
      confidence += this.config.crossModuleBonus;
    }

    // 多入口类型加成（每种类型 +0.05）
    if (entryPointKindCount > 1) {
      confidence += (entryPointKindCount - 1) * this.config.entryPointKindBonus;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * 收集列信息
   */
  private collectColumns(contexts: TraceSourceContext[]): string[] {
    const columns = new Set<string>();

    for (const ctx of contexts) {
      const table = ctx.tracePath.tables[ctx.tableIndex];
      if (table.columns) {
        for (const col of table.columns) {
          columns.add(col);
        }
      }
    }

    return Array.from(columns);
  }

  /**
   * 提取 schema
   */
  private extractSchema(contexts: TraceSourceContext[]): string | undefined {
    for (const ctx of contexts) {
      const table = ctx.tracePath.tables[ctx.tableIndex];
      if (table.schema) {
        return table.schema;
      }
    }
    return undefined;
  }
}

/**
 * 创建 TableAnchorAggregator 实例的便捷函数
 *
 * @param config - 配置选项
 * @returns TableAnchorAggregator 实例
 */
export function createTableAnchorAggregator(
  config?: TableAnchorAggregatorConfig,
): TableAnchorAggregator {
  return new TableAnchorAggregator(config);
}