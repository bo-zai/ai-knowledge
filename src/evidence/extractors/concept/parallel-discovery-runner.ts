/**
 * 并行发现运行器
 *
 * 协调多种发现途径并行执行，整合发现结果。
 * 支持：
 * - 并行执行 Controller、Scheduled、MQ Consumer 路径发现
 * - 聚合 TableAnchor（跨模块识别）
 * - 补充表关联关系（Stub，Task 7）
 * - 增强 Git Commit 信息（Stub，Task 8）
 * - 定义业务域（Stub，Task 8）
 */

import type {
  LanguageAdapter,
  EntryPointInfo,
  DiscoveryPathResult,
  TableAnchor,
  ConceptCandidate,
  BusinessDomain,
  GitCommitEvidence,
  ConceptTracePath,
  ServiceChainNode,
  MapperInfo,
  TableInfo,
  EntityInfo,
} from './types.js';
import { createLanguageAdapter, isLanguageSupported } from './language-adapters/index.js';
import {
  ControllerPathDiscovery,
  ScheduledPathDiscovery,
  MqConsumerPathDiscovery,
} from './discovery-paths/index.js';
import { TableAnchorAggregator, createTableAnchorAggregator } from './table-anchor-aggregator.js';

/**
 * 并行发现配置
 */
export interface ParallelDiscoveryConfig {
  /** 仓库根路径 */
  repoPath: string;
  /** 模块路径列表 */
  modulePaths: string[];
  /** 语言标识（java, typescript 等） */
  language: string;
  /** 启用的发现途径（默认全部启用） */
  pathways?: ('controller' | 'scheduled' | 'mq_consumer')[];
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 是否启用 Git Commit 增强（默认 true） */
  enableGitEnhancement?: boolean;
  /** 是否启用业务域定义（默认 true） */
  enableDomainDefinition?: boolean;
  /** 是否启用表关联补充（默认 true） */
  enableTableRelation?: boolean;
}

/**
 * 并行发现结果
 */
export interface ParallelDiscoveryResult {
  /** 发现的表锚点（聚合后的） */
  tableAnchors: TableAnchor[];
  /** 概念候选列表（从表锚点生成） */
  candidates: ConceptCandidate[];
  /** 业务域列表 */
  domains: BusinessDomain[];
  /** 各发现途径的原始结果 */
  pathResults: DiscoveryPathResult[];
  /** 所有入口点汇总 */
  allEntryPoints: EntryPointInfo[];
  /** 错误信息 */
  errors: string[];
  /** 运行统计 */
  stats: {
    /** 总模块数 */
    totalModules: number;
    /** 总入口点数 */
    totalEntryPoints: number;
    /** 总追溯路径数 */
    totalTracePaths: number;
    /** 总表锚点数 */
    totalTableAnchors: number;
    /** 跨模块表数 */
    crossModuleTables: number;
    /** 运行时间（毫秒） */
    runTimeMs: number;
  };
}

/**
 * 表关联补充器（Stub，Task 7 实现）
 *
 * 分析表之间的关联关系，补充外键、关联密度等信息
 */
export interface TableRelationSupplement {
  /** 补充表关联信息 */
  supplement(tableAnchors: TableAnchor[]): Promise<TableAnchor[]>;
}

/**
 * Service 调用链聚类（Stub，Task 7 实现）
 *
 * 分析 Service 调用链，聚类相关服务
 */
export interface ServiceCallCluster {
  /** 聚类 Service 调用链 */
  cluster(tracePaths: DiscoveryPathResult[]): Promise<Map<string, string[]>>;
}

/**
 * Git Commit 增强器（Stub，Task 8 实现）
 *
 * 从 Git 历史提取与表相关的 Commit 信息
 */
export interface GitCommitEnhancer {
  /** 增强 Git Commit 信息 */
  enhance(tableAnchors: TableAnchor[], repoPath: string): Promise<Map<string, GitCommitEvidence[]>>;
}

/**
 * 业务域定义器（Stub，Task 8 实现）
 *
 * 根据表锚点和候选定义业务域
 */
export interface BusinessDomainDefiner {
  /** 定义业务域 */
  define(tableAnchors: TableAnchor[], candidates: ConceptCandidate[]): Promise<BusinessDomain[]>;
}

/**
 * Stub 实现：表关联补充器
 */
class StubTableRelationSupplement implements TableRelationSupplement {
  async supplement(tableAnchors: TableAnchor[]): Promise<TableAnchor[]> {
    // Stub: 直接返回原始锚点，不做额外补充
    return tableAnchors;
  }
}

/**
 * Stub 实现：Service 调用链聚类
 */
class StubServiceCallCluster implements ServiceCallCluster {
  async cluster(tracePaths: DiscoveryPathResult[]): Promise<Map<string, string[]>> {
    // Stub: 返回空聚类
    return new Map();
  }
}

/**
 * Stub 实现：Git Commit 增强器
 */
class StubGitCommitEnhancer implements GitCommitEnhancer {
  async enhance(tableAnchors: TableAnchor[], repoPath: string): Promise<Map<string, GitCommitEvidence[]>> {
    // Stub: 返回空的 Git Commit 映射
    return new Map();
  }
}

/**
 * Stub 实现：业务域定义器
 */
class StubBusinessDomainDefiner implements BusinessDomainDefiner {
  async define(tableAnchors: TableAnchor[], candidates: ConceptCandidate[]): Promise<BusinessDomain[]> {
    // Stub: 从表锚点生成简单的业务域
    const domains: BusinessDomain[] = [];

    for (const anchor of tableAnchors) {
      domains.push({
        domainId: `domain-${anchor.tableName}`,
        domainName: this.inferDomainName(anchor.tableName),
        coreTables: [anchor],
        relatedTables: [],
        coveredModules: anchor.moduleNames.map((name, idx) => ({
          moduleName: name,
          modulePath: anchor.traceSources[idx]?.modulePath || '',
          role: idx === 0 ? 'primary' : 'supporting',
          entryPointCount: anchor.traceSources[idx]?.entryPoints.length || 0,
        })),
        isCrossModuleDomain: anchor.isCrossModule,
        candidates: candidates.filter(c => c.tableAnchor.tableName === anchor.tableName),
        gitCommits: [],
      });
    }

    return domains;
  }

  /**
   * 根据表名推断业务域名称（Stub）
   */
  private inferDomainName(tableName: string): string {
    // 简单的命名推断：去除后缀，转为中文描述
    const baseName = tableName.replace(/_(?:order|info|detail|record|log|config|setting|data)$/i, '');
    return `${baseName}管理域`;
  }
}

/**
 * 并行发现运行器
 *
 * 协调多种发现途径并行执行，整合发现结果。
 */
export class ParallelDiscoveryRunner {
  private readonly config: Required<ParallelDiscoveryConfig>;
  private readonly adapter: LanguageAdapter;
  private readonly aggregator: TableAnchorAggregator;
  private tableRelationSupplement: TableRelationSupplement;
  private serviceCallCluster: ServiceCallCluster;
  private gitCommitEnhancer: GitCommitEnhancer;
  private businessDomainDefiner: BusinessDomainDefiner;

  /**
   * 创建 ParallelDiscoveryRunner 实例
   *
   * @param config - 配置选项
   * @throws 如果语言不支持
   */
  constructor(config: ParallelDiscoveryConfig) {
    // 验证语言支持
    if (!isLanguageSupported(config.language)) {
      throw new Error(`不支持的语言: ${config.language}。支持的语言: java`);
    }

    // 创建语言适配器
    const adapter = createLanguageAdapter(config.language);
    if (!adapter) {
      throw new Error(`无法创建语言适配器: ${config.language}`);
    }

    this.adapter = adapter;

    // 设置默认配置
    this.config = {
      repoPath: config.repoPath,
      modulePaths: config.modulePaths,
      language: config.language,
      pathways: config.pathways ?? ['controller', 'scheduled', 'mq_consumer'],
      maxConcurrency: config.maxConcurrency ?? 5,
      enableGitEnhancement: config.enableGitEnhancement ?? true,
      enableDomainDefinition: config.enableDomainDefinition ?? true,
      enableTableRelation: config.enableTableRelation ?? true,
    };

    // 创建聚合器
    this.aggregator = createTableAnchorAggregator();

    // 创建 Stub 组件（Task 7 和 Task 8 将替换为真实实现）
    this.tableRelationSupplement = new StubTableRelationSupplement();
    this.serviceCallCluster = new StubServiceCallCluster();
    this.gitCommitEnhancer = new StubGitCommitEnhancer();
    this.businessDomainDefiner = new StubBusinessDomainDefiner();
  }

  /**
   * 执行并行发现
   *
   * @returns 并行发现结果
   */
  async run(): Promise<ParallelDiscoveryResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const allEntryPoints: EntryPointInfo[] = [];
    const pathResults: DiscoveryPathResult[] = [];

    // 1. 为每个模块创建发现器
    const discoveryTasks = this.createDiscoveryTasks();

    // 2. 并行执行发现任务
    const taskResults = await this.executeParallel(discoveryTasks);

    // 3. 收集结果
    for (const result of taskResults) {
      pathResults.push(...result.pathResults);
      allEntryPoints.push(...result.entryPoints);
      errors.push(...result.errors);
    }

    // 4. 聚合表锚点
    const rawTableAnchors = this.aggregator.aggregate(pathResults);

    // 5. 补充表关联（如果启用）
    let tableAnchors = rawTableAnchors;
    if (this.config.enableTableRelation) {
      try {
        tableAnchors = await this.tableRelationSupplement.supplement(rawTableAnchors);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`表关联补充失败: ${errorMsg}`);
      }
    }

    // 6. 从表锚点生成概念候选
    const candidates = this.generateCandidates(tableAnchors, pathResults);

    // 7. 增强 Git Commit 信息（如果启用）
    if (this.config.enableGitEnhancement) {
      try {
        const gitCommits = await this.gitCommitEnhancer.enhance(tableAnchors, this.config.repoPath);
        // 将 Git Commit 信息附加到候选
        for (const candidate of candidates) {
          const commits = gitCommits.get(candidate.tableAnchor.tableName) || [];
          candidate.gitCommits = commits;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Git Commit 增强失败: ${errorMsg}`);
      }
    }

    // 8. 定义业务域（如果启用）
    let domains: BusinessDomain[] = [];
    if (this.config.enableDomainDefinition) {
      try {
        domains = await this.businessDomainDefiner.define(tableAnchors, candidates);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`业务域定义失败: ${errorMsg}`);
      }
    }

    // 9. 计算统计信息
    const runTimeMs = Date.now() - startTime;
    const stats = {
      totalModules: this.config.modulePaths.length,
      totalEntryPoints: allEntryPoints.length,
      totalTracePaths: pathResults.reduce((sum, r) => sum + r.tracePaths.length, 0),
      totalTableAnchors: tableAnchors.length,
      crossModuleTables: tableAnchors.filter(a => a.isCrossModule).length,
      runTimeMs,
    };

    return {
      tableAnchors,
      candidates,
      domains,
      pathResults,
      allEntryPoints,
      errors,
      stats,
    };
  }

  /**
   * 为每个模块创建发现任务
   */
  private createDiscoveryTasks(): Array<{
    modulePath: string;
    pathway: 'controller' | 'scheduled' | 'mq_consumer';
    runner: ControllerPathDiscovery | ScheduledPathDiscovery | MqConsumerPathDiscovery;
  }> {
    const tasks: Array<{
      modulePath: string;
      pathway: 'controller' | 'scheduled' | 'mq_consumer';
      runner: ControllerPathDiscovery | ScheduledPathDiscovery | MqConsumerPathDiscovery;
    }> = [];

    for (const modulePath of this.config.modulePaths) {
      for (const pathway of this.config.pathways) {
        switch (pathway) {
          case 'controller':
            tasks.push({
              modulePath,
              pathway,
              runner: new ControllerPathDiscovery(this.adapter, modulePath),
            });
            break;
          case 'scheduled':
            tasks.push({
              modulePath,
              pathway,
              runner: new ScheduledPathDiscovery(this.adapter, modulePath),
            });
            break;
          case 'mq_consumer':
            tasks.push({
              modulePath,
              pathway,
              runner: new MqConsumerPathDiscovery(this.adapter, modulePath),
            });
            break;
        }
      }
    }

    return tasks;
  }

  /**
   * 并行执行发现任务
   */
  private async executeParallel(
    tasks: Array<{
      modulePath: string;
      pathway: 'controller' | 'scheduled' | 'mq_consumer';
      runner: ControllerPathDiscovery | ScheduledPathDiscovery | MqConsumerPathDiscovery;
    }>,
  ): Promise<Array<{ pathResults: DiscoveryPathResult[]; entryPoints: EntryPointInfo[]; errors: string[] }>> {
    const results: Array<{ pathResults: DiscoveryPathResult[]; entryPoints: EntryPointInfo[]; errors: string[] }> = [];

    // 分批执行，控制并发数
    const batches = this.batchTasks(tasks, this.config.maxConcurrency);

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          try {
            const result = await task.runner.discover();
            return {
              pathResults: [result],
              entryPoints: result.entryPoints,
              errors: result.errors,
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
              pathResults: [],
              entryPoints: [],
              errors: [`[${task.pathway}] ${task.modulePath}: ${errorMsg}`],
            };
          }
        }),
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 分批任务
   */
  private batchTasks<T>(tasks: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      batches.push(tasks.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * 从表锚点生成概念候选
   */
  private generateCandidates(
    tableAnchors: TableAnchor[],
    pathResults: DiscoveryPathResult[],
  ): ConceptCandidate[] {
    const candidates: ConceptCandidate[] = [];

    for (const anchor of tableAnchors) {
      // 从表名推断候选名称
      const nameCandidates = this.inferConceptNames(anchor.tableName);

      // 计算置信度
      const confidence = this.calculateConfidence(anchor, pathResults);

      // 确定主模块（取第一个追溯来源的模块）
      const primarySource = anchor.traceSources[0];

      // 构建候选
      const candidate: ConceptCandidate = {
        candidateId: `CAND-${anchor.tableName}`,
        nameCandidates,
        confidence,
        confidenceBreakdown: {
          traceDepth: this.calculateTraceDepth(anchor),
          crossModule: anchor.isCrossModule ? 0.2 : 0,
          multiEntryPoint: this.calculateMultiEntryPointBonus(anchor),
          tableRelation: 0, // Task 7 将补充
        },
        modulePath: primarySource?.modulePath || '',
        moduleName: primarySource?.moduleName || '',
        isCrossModule: anchor.isCrossModule,
        tableAnchor: anchor,
        tracePath: this.buildTracePath(anchor, pathResults),
        gitCommits: [],
      };

      candidates.push(candidate);
    }

    return candidates;
  }

  /**
   * 推断概念名称
   */
  private inferConceptNames(tableName: string): string[] {
    // snake_case -> 各种可能的命名
    const baseName = tableName
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');

    const variants: string[] = [];

    // 基础名称
    variants.push(baseName);

    // 添加常见后缀变体
    if (!baseName.endsWith('Info') && !baseName.endsWith('Data')) {
      variants.push(`${baseName}Info`);
    }
    if (!baseName.endsWith('Record')) {
      variants.push(`${baseName}Record`);
    }

    // 去除常见后缀后的名称
    const cleanName = baseName.replace(/(?:Order|Info|Detail|Record|Log|Config|Setting|Data)$/i, '');
    if (cleanName !== baseName && cleanName.length > 2) {
      variants.push(cleanName);
    }

    return variants;
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(anchor: TableAnchor, pathResults: DiscoveryPathResult[]): number {
    // 基础置信度
    let confidence = 0.5;

    // 有完整追溯链（Service -> Mapper -> Entity）
    confidence += this.calculateTraceDepth(anchor) * 0.3;

    // 跨模块加成
    if (anchor.isCrossModule) {
      confidence += 0.2;
    }

    // 多入口加成
    confidence += this.calculateMultiEntryPointBonus(anchor);

    // 限制最大值
    return Math.min(confidence, 1.0);
  }

  /**
   * 计算追溯深度（完整度）
   */
  private calculateTraceDepth(anchor: TableAnchor): number {
    // 检查是否有完整的追溯链
    const sources = anchor.traceSources;

    let maxDepth = 0;
    for (const source of sources) {
      let depth = 0;
      if (source.mapperClassName) depth += 0.33;
      if (source.entityClassName) depth += 0.33;
      if (source.entryPoints.length > 0) depth += 0.34;
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  /**
   * 计算多入口点加成
   */
  private calculateMultiEntryPointBonus(anchor: TableAnchor): number {
    // 统计不同类型的入口点数量
    const entryPointKinds = new Set<string>();
    for (const source of anchor.traceSources) {
      for (const ep of source.entryPoints) {
        entryPointKinds.add(ep.kind);
      }
    }

    // 每种类型加 0.05
    return (entryPointKinds.size - 1) * 0.05;
  }

  /**
   * 设置表关联补充器
   *
   * 用于 Task 7 实现后替换 Stub
   */
  setTableRelationSupplement(supplement: TableRelationSupplement): void {
    this.tableRelationSupplement = supplement;
  }

  /**
   * 设置 Service 调用链聚类器
   *
   * 用于 Task 7 实现后替换 Stub
   */
  setServiceCallCluster(cluster: ServiceCallCluster): void {
    this.serviceCallCluster = cluster;
  }

  /**
   * 设置 Git Commit 增强器
   *
   * 用于 Task 8 实现后替换 Stub
   */
  setGitCommitEnhancer(enhancer: GitCommitEnhancer): void {
    this.gitCommitEnhancer = enhancer;
  }

  /**
   * 设置业务域定义器
   *
   * 用于 Task 8 实现后替换 Stub
   */
  setBusinessDomainDefiner(definer: BusinessDomainDefiner): void {
    this.businessDomainDefiner = definer;
  }

  /**
   * 构建追溯路径
   */
  private buildTracePath(anchor: TableAnchor, pathResults: DiscoveryPathResult[]): ConceptTracePath {
    // 从 pathResults 中找到与该表相关的追溯路径
    const relevantPaths = pathResults.filter(result =>
      result.tracePaths.some(path =>
        path.tables.some(table => table.tableName === anchor.tableName),
      ),
    );

    // 合并所有相关路径
    const entryPoints: EntryPointInfo[] = [];
    const serviceChain: ServiceChainNode[] = [];
    const mappers: MapperInfo[] = [];
    const tables: TableInfo[] = [];
    const entities: EntityInfo[] = [];

    // 使用 Set 去重
    const visitedEntryPoints = new Set<string>();
    const visitedServices = new Set<string>();
    const visitedMappers = new Set<string>();
    const visitedTables = new Set<string>();
    const visitedEntities = new Set<string>();

    for (const result of relevantPaths) {
      for (const path of result.tracePaths) {
        // 入口点
        for (const ep of path.entryPoints) {
          const key = `${ep.className}:${ep.filePath}`;
          if (!visitedEntryPoints.has(key)) {
            visitedEntryPoints.add(key);
            entryPoints.push(ep);
          }
        }

        // Service 链
        if (path.serviceChain) {
          for (const svc of path.serviceChain) {
            const key = `${svc.className}:${svc.filePath}`;
            if (!visitedServices.has(key)) {
              visitedServices.add(key);
              serviceChain.push(svc);
            }
          }
        }

        // Mapper
        for (const mapper of path.mappers) {
          const key = `${mapper.className}:${mapper.filePath}`;
          if (!visitedMappers.has(key)) {
            visitedMappers.add(key);
            mappers.push(mapper);
          }
        }

        // Tables
        for (const table of path.tables) {
          if (!visitedTables.has(table.tableName)) {
            visitedTables.add(table.tableName);
            tables.push(table);
          }
        }

        // Entities
        for (const entity of path.entities) {
          const key = `${entity.className}:${entity.filePath}`;
          if (!visitedEntities.has(key)) {
            visitedEntities.add(key);
            entities.push(entity);
          }
        }
      }
    }

    return {
      entryPoints,
      serviceChain: serviceChain.length > 0 ? serviceChain : undefined,
      mappers,
      tables,
      entities,
    };
  }
}

/**
 * 创建 ParallelDiscoveryRunner 实例的便捷函数
 *
 * @param config - 配置选项
 * @returns ParallelDiscoveryRunner 实例
 */
export function createParallelDiscoveryRunner(config: ParallelDiscoveryConfig): ParallelDiscoveryRunner {
  return new ParallelDiscoveryRunner(config);
}

/**
 * 设置外部组件（用于 Task 7 和 Task 8 实现后替换 Stub）
 */
export interface ParallelDiscoveryRunnerOptions {
  tableRelationSupplement?: TableRelationSupplement;
  serviceCallCluster?: ServiceCallCluster;
  gitCommitEnhancer?: GitCommitEnhancer;
  businessDomainDefiner?: BusinessDomainDefiner;
}

/**
 * 创建带自定义组件的 ParallelDiscoveryRunner
 *
 * @param config - 配置选项
 * @param options - 外部组件选项
 * @returns ParallelDiscoveryRunner 实例
 */
export function createParallelDiscoveryRunnerWithOptions(
  config: ParallelDiscoveryConfig,
  options: ParallelDiscoveryRunnerOptions,
): ParallelDiscoveryRunner {
  const runner = new ParallelDiscoveryRunner(config);

  // 注入外部组件（替换 Stub 实现）
  if (options.tableRelationSupplement) {
    runner.setTableRelationSupplement(options.tableRelationSupplement);
  }
  if (options.serviceCallCluster) {
    runner.setServiceCallCluster(options.serviceCallCluster);
  }
  if (options.gitCommitEnhancer) {
    runner.setGitCommitEnhancer(options.gitCommitEnhancer);
  }
  if (options.businessDomainDefiner) {
    runner.setBusinessDomainDefiner(options.businessDomainDefiner);
  }

  return runner;
}