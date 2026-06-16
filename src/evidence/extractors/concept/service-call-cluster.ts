/**
 * Service 调用链聚类器
 *
 * 聚类 Service 调用关系，将分散入口归类到同一业务域。
 *
 * 功能：
 * - 统计每个 Service 被哪些入口点调用
 * - 标记被多个入口点调用的 Service 为业务域核心
 * - 通过调用链分析推断业务域边界
 */

import type {
  DiscoveryPathResult,
  ServiceChainNode,
  EntryPointInfo,
  ServiceCluster,
} from './types.js';

/**
 * Service 调用链聚类器配置
 */
export interface ServiceCallClusterConfig {
  /** 最少入口点调用数阈值（超过此值标记为域核心） */
  coreThreshold?: number;
  /** 是否包含调用者 Service 信息 */
  includeCallerServices?: boolean;
}

/**
 * Service 调用链聚类器实现
 */
export class ServiceCallClusterImpl {
  private readonly config: Required<ServiceCallClusterConfig>;

  constructor(config?: ServiceCallClusterConfig) {
    this.config = {
      coreThreshold: config?.coreThreshold ?? 2,
      includeCallerServices: config?.includeCallerServices ?? true,
    };
  }

  /**
   * 聚类 Service 调用链
   *
   * @param pathResults - 发现路径结果
   * @returns Service 聚类映射（Service 名称 -> 聚类信息）
   */
  async cluster(pathResults: DiscoveryPathResult[]): Promise<Map<string, ServiceCluster>> {
    const clusterMap = new Map<string, ServiceCluster>();

    // 1. 收集所有 Service 调用信息
    const serviceCallMap = this.collectServiceCalls(pathResults);

    // 2. 分析每个 Service 的调用者
    for (const [serviceName, callers] of serviceCallMap) {
      // 入口点调用者
      const entryPointCallers = callers.entryPoints.map(ep =>
        `${ep.kind}:${ep.className}`,
      );

      // 其他 Service 调用者
      const callerServices = callers.services.map(svc => svc.className);

      // 判断是否为域核心（被多个入口点调用）
      const isDomainCore = entryPointCallers.length >= this.config.coreThreshold;

      // 从入口点推断业务域提示
      const domainHint = this.inferDomainHint(callers.entryPoints, serviceName);

      clusterMap.set(serviceName, {
        serviceName,
        entryPointCallers,
        callerServices,
        isDomainCore,
        domainHint,
      });
    }

    return clusterMap;
  }

  /**
   * 获取业务域核心 Service 列表
   */
  async getDomainCoreServices(pathResults: DiscoveryPathResult[]): Promise<ServiceCluster[]> {
    const clusterMap = await this.cluster(pathResults);
    return [...clusterMap.values()].filter(cluster => cluster.isDomainCore);
  }

  /**
   * 收集 Service 调用信息
   *
   * 分析所有追溯路径，记录每个 Service 的调用者
   */
  private collectServiceCalls(
    pathResults: DiscoveryPathResult[],
  ): Map<string, { entryPoints: EntryPointInfo[]; services: ServiceChainNode[] }> {
    const callMap = new Map<string, { entryPoints: EntryPointInfo[]; services: ServiceChainNode[] }>();

    for (const result of pathResults) {
      for (const path of result.tracePaths) {
        // 入口点信息
        const entryPoints = path.entryPoints;

        // Service 调用链
        const serviceChain = path.serviceChain ?? [];

        // 分析调用关系
        for (let i = 0; i < serviceChain.length; i++) {
          const serviceNode = serviceChain[i];

          // 获取或初始化该 Service 的调用记录
          const existing = callMap.get(serviceNode.className) ?? {
            entryPoints: [],
            services: [],
          };

          // 第一个 Service 由入口点直接调用
          if (i === 0) {
            // 入口点调用第一个 Service
            for (const ep of entryPoints) {
              // 去重添加
              if (!existing.entryPoints.some(e =>
                e.className === ep.className && e.kind === ep.kind,
              )) {
                existing.entryPoints.push(ep);
              }
            }
          }

          // 记录调用该 Service 的其他 Service
          if (i > 0 && this.config.includeCallerServices) {
            const callerService = serviceChain[i - 1];
            if (!existing.services.some(s => s.className === callerService.className)) {
              existing.services.push(callerService);
            }
          }

          callMap.set(serviceNode.className, existing);
        }
      }
    }

    return callMap;
  }

  /**
   * 从入口点推断业务域提示
   *
   * 分析入口点的类名和方法名，推断业务域
   */
  private inferDomainHint(entryPoints: EntryPointInfo[], serviceName: string): string | undefined {
    if (entryPoints.length === 0) {
      return undefined;
    }

    // 提取入口点类名中的关键词
    const keywords = new Set<string>();

    for (const ep of entryPoints) {
      // Controller 类名通常包含业务领域信息
      // 例如：OrderController, UserController
      const controllerMatch = ep.className.match(/^(.+)Controller$/);
      if (controllerMatch) {
        keywords.add(this.convertCamelToSnake(controllerMatch[1]));
      }

      // 方法签名中的路径信息
      // 例如：@GetMapping("/product/list") -> product
      if (ep.signature) {
        const pathMatch = ep.signature.match(/["']\/([^/]+)/);
        if (pathMatch) {
          keywords.add(pathMatch[1]);
        }
      }
    }

    // 取最常见的关键词作为域提示
    if (keywords.size > 0) {
      // 优先使用与 Service 名称匹配的关键词
      const servicePrefix = serviceName.match(/^([A-Z][a-z]+)/)?.[1];
      if (servicePrefix) {
        const serviceKeyword = this.convertCamelToSnake(servicePrefix);
        if (keywords.has(serviceKeyword)) {
          return `${serviceKeyword}管理域`;
        }
      }

      // 返回第一个关键词
      return `${[...keywords][0]}管理域`;
    }

    return undefined;
  }

  /**
   * CamelCase -> snake_case
   */
  private convertCamelToSnake(camel: string): string {
    return camel
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  /**
   * 按业务域分组 Service
   *
   * 返回业务域 -> Service 列表的映射
   */
  async groupByDomain(
    pathResults: DiscoveryPathResult[],
  ): Promise<Map<string, ServiceCluster[]>> {
    const clusterMap = await this.cluster(pathResults);
    const domainMap = new Map<string, ServiceCluster[]>();

    for (const cluster of clusterMap.values()) {
      const domainKey = cluster.domainHint ?? 'unknown';

      const existing = domainMap.get(domainKey) ?? [];
      existing.push(cluster);
      domainMap.set(domainKey, existing);
    }

    return domainMap;
  }
}

/**
 * 创建 Service 调用链聚类器实例
 */
export function createServiceCallCluster(
  config?: ServiceCallClusterConfig,
): ServiceCallClusterImpl {
  return new ServiceCallClusterImpl(config);
}