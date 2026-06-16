/**
 * 路径发现基类
 *
 * 提取 Controller/Scheduled/MqConsumer 三个发现路径类的共享逻辑
 */

import type {
  LanguageAdapter,
  EntryPointInfo,
  DiscoveryPathResult,
  ConceptTracePath,
  ServiceChainNode,
  MapperInfo,
  TableInfo,
  EntityInfo,
} from '../types.js';

/**
 * 入口点类型
 */
export type EntryPointKind = 'controller' | 'scheduled' | 'mq_consumer';

/**
 * 发现途径类型
 */
export type DiscoveryPathway = 'controller' | 'scheduled' | 'mq_consumer';

/**
 * 路径发现配置
 */
export interface BasePathDiscoveryConfig {
  /** 最大追溯深度（Service 链层数） */
  maxServiceDepth?: number;
  /** 是否收集所有 Mapper（true）还是只收集第一个（false） */
  collectAllMappers?: boolean;
  /** 是否收集所有表（true）还是只收集第一个（false） */
  collectAllTables?: boolean;
}

/**
 * 路径发现抽象基类
 *
 * 包含 Controller/Scheduled/MqConsumer 三种入口点的共享追溯逻辑：
 * - traceServiceChain: 追溯 Service 调用链
 * - collectMappers: 收集所有 Service 节点的 Mapper
 * - collectTables: 从 Mapper 提取表信息
 * - collectEntities: 根据表信息查找 Entity
 */
export abstract class BasePathDiscovery {
  protected readonly adapter: LanguageAdapter;
  protected readonly modulePath: string;
  protected readonly config: Required<BasePathDiscoveryConfig>;

  /** 子类需要指定发现途径 */
  protected abstract readonly pathway: DiscoveryPathway;

  /** 子类需要指定入口点类型 */
  protected abstract readonly entryPointKind: EntryPointKind;

  /**
   * 格式化入口点名称用于错误信息
   *
   * @param ep - 入口点信息
   * @returns 格式化后的名称字符串
   */
  protected abstract formatEntryPointName(ep: EntryPointInfo): string;

  /**
   * 创建路径发现实例
   *
   * @param adapter - 语言适配器
   * @param modulePath - 模块路径
   * @param config - 配置选项
   */
  constructor(
    adapter: LanguageAdapter,
    modulePath: string,
    config?: BasePathDiscoveryConfig,
  ) {
    this.adapter = adapter;
    this.modulePath = modulePath;
    this.config = {
      maxServiceDepth: config?.maxServiceDepth ?? 3,
      collectAllMappers: config?.collectAllMappers ?? true,
      collectAllTables: config?.collectAllTables ?? true,
    };
  }

  /**
   * 执行路径发现
   *
   * @returns 发现结果，包含入口点、追溯路径和错误信息
   */
  async discover(): Promise<DiscoveryPathResult> {
    const errors: string[] = [];
    const tracePaths: ConceptTracePath[] = [];
    const entryPoints: EntryPointInfo[] = [];

    try {
      // 1. 检测所有入口点
      const allEntryPoints = await this.adapter.detectEntryPoints(this.modulePath);

      // 2. 过滤只保留当前类型的入口点
      for (const ep of allEntryPoints) {
        if (ep.kind === this.entryPointKind) {
          entryPoints.push(ep);
        }
      }

      // 3. 为每个入口点追溯完整链路
      for (const entryPoint of entryPoints) {
        try {
          const tracePath = await this.traceSinglePath(entryPoint, errors);
          if (tracePath) {
            tracePaths.push(tracePath);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`追溯 ${this.getPathTypeName()} ${this.formatEntryPointName(entryPoint)} 失败: ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`检测入口点失败: ${errorMsg}`);
    }

    return {
      pathway: this.pathway,
      entryPoints,
      tracePaths,
      errors,
    };
  }

  /**
   * 获取路径类型的显示名称
   */
  protected getPathTypeName(): string {
    switch (this.pathway) {
      case 'controller':
        return 'Controller';
      case 'scheduled':
        return 'Scheduled';
      case 'mq_consumer':
        return 'MQ Consumer';
      default:
        return this.pathway;
    }
  }

  /**
   * 追溯单个入口点的完整路径
   */
  private async traceSinglePath(
    entryPoint: EntryPointInfo,
    errors: string[],
  ): Promise<ConceptTracePath | null> {
    // 1. 追溯 Service 链
    const serviceChain = await this.traceServiceChain(entryPoint, errors);

    // 2. 收集所有 Mapper
    const mappers = await this.collectMappers(serviceChain, errors);

    // 3. 从 Mapper 提取表信息
    const tables = await this.collectTables(mappers, errors);

    // 4. 查找 Entity
    const entities = await this.collectEntities(tables, errors);

    return {
      entryPoints: [entryPoint],
      serviceChain: serviceChain.length > 0 ? serviceChain : undefined,
      mappers,
      tables,
      entities,
    };
  }

  /**
   * 追溯 Service 调用链
   *
   * 从入口点追溯到 Service 层，支持多级 Service 调用
   */
  protected async traceServiceChain(
    entryPoint: EntryPointInfo,
    errors: string[],
  ): Promise<ServiceChainNode[]> {
    const serviceChain: ServiceChainNode[] = [];
    const visited = new Set<string>();

    // 从入口点追溯第一层 Service
    let currentServices = await this.adapter.traceToService(entryPoint);

    // 添加到结果集
    for (const svc of currentServices) {
      const key = `${svc.className}:${svc.filePath}`;
      if (!visited.has(key)) {
        visited.add(key);
        serviceChain.push(svc);
      }
    }

    // 递归追溯 Service 调用的 Service（最多 maxServiceDepth 层）
    let depth = 1;
    while (depth < this.config.maxServiceDepth && currentServices.length > 0) {
      const nextServices: ServiceChainNode[] = [];

      for (const svc of currentServices) {
        try {
          const deeperServices = await this.traceDeeperServices(svc, visited);
          nextServices.push(...deeperServices);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`追溯 Service ${svc.className} 的深层调用失败: ${errorMsg}`);
        }
      }

      // 添加新发现的 Service 到结果集
      for (const svc of nextServices) {
        const key = `${svc.className}:${svc.filePath}`;
        if (!visited.has(key)) {
          visited.add(key);
          serviceChain.push(svc);
        }
      }

      currentServices = nextServices;
      depth++;
    }

    return serviceChain;
  }

  /**
   * 追溯 Service 调用的更深层 Service
   */
  protected async traceDeeperServices(
    serviceNode: ServiceChainNode,
    visited: Set<string>,
  ): Promise<ServiceChainNode[]> {
    const { lbugPath } = await import('../../../../engine/storage/repo-manager.js').then(m => m.getStoragePaths(serviceNode.modulePath));

    try {
      const fs = await import('fs/promises');
      await fs.access(lbugPath);
    } catch {
      return [];
    }

    // 查找该 Service 调用的其他 Service
    const deeperServices = await this.adapter.traceToService({
      kind: this.entryPointKind, // 使用子类指定的入口点类型
      className: serviceNode.className,
      filePath: serviceNode.filePath,
      moduleName: serviceNode.moduleName,
      modulePath: serviceNode.modulePath,
      startLine: serviceNode.startLine,
    });

    // 过滤掉已访问的
    return deeperServices.filter(svc => {
      const key = `${svc.className}:${svc.filePath}`;
      return !visited.has(key);
    });
  }

  /**
   * 收集所有 Service 节点的 Mapper
   */
  protected async collectMappers(
    serviceChain: ServiceChainNode[],
    errors: string[],
  ): Promise<MapperInfo[]> {
    const mappers: MapperInfo[] = [];
    const visited = new Set<string>();

    for (const serviceNode of serviceChain) {
      try {
        const serviceMappers = await this.adapter.traceToMapper(serviceNode);

        for (const mapper of serviceMappers) {
          const key = `${mapper.className}:${mapper.filePath}`;
          if (!visited.has(key)) {
            visited.add(key);
            mappers.push(mapper);
          }

          // 如果不收集所有 Mapper，只保留第一个
          if (!this.config.collectAllMappers && mappers.length >= 1) {
            break;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`追溯 Service ${serviceNode.className} 的 Mapper 失败: ${errorMsg}`);
      }

      if (!this.config.collectAllMappers && mappers.length >= 1) {
        break;
      }
    }

    return mappers;
  }

  /**
   * 从 Mapper 提取表信息
   */
  protected async collectTables(
    mappers: MapperInfo[],
    errors: string[],
  ): Promise<TableInfo[]> {
    const tables: TableInfo[] = [];
    const visited = new Set<string>();

    for (const mapper of mappers) {
      try {
        const mapperTables = await this.adapter.extractTableFromMapper(mapper);

        for (const table of mapperTables) {
          if (!visited.has(table.tableName)) {
            visited.add(table.tableName);
            tables.push(table);
          }

          // 如果不收集所有表，只保留第一个
          if (!this.config.collectAllTables && tables.length >= 1) {
            break;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`从 Mapper ${mapper.className} 提取表失败: ${errorMsg}`);
      }

      if (!this.config.collectAllTables && tables.length >= 1) {
        break;
      }
    }

    return tables;
  }

  /**
   * 根据表信息查找 Entity
   */
  protected async collectEntities(
    tables: TableInfo[],
    errors: string[],
  ): Promise<EntityInfo[]> {
    const entities: EntityInfo[] = [];
    const visited = new Set<string>();

    for (const table of tables) {
      try {
        const entity = await this.adapter.findEntityForTable(table, this.modulePath);

        if (entity) {
          const key = `${entity.className}:${entity.filePath}`;
          if (!visited.has(key)) {
            visited.add(key);
            entities.push(entity);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`查找表 ${table.tableName} 的 Entity 失败: ${errorMsg}`);
      }
    }

    return entities;
  }
}