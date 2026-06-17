/**
 * 模块发现器
 *
 * 复用 architecture/module-discovery 的探测逻辑，
 * 提供独立的模块发现接口
 */

import { logger } from '../shared/logger.js';
import { ModuleDiscoveryCoordinator } from '../architecture/module-discovery/index.js';
import type { ModuleDiscoveryResult, RepoType } from '../architecture/module-discovery/types.js';
import type { ModuleTopology, ModuleInfo, CouplingMode, SignalDetectionResult } from './types.js';

/**
 * 模块发现器
 *
 * 封装 ModuleDiscoveryCoordinator，提供简化的接口
 */
export class ModuleDiscoverer {
  private coordinator: ModuleDiscoveryCoordinator;

  constructor() {
    this.coordinator = new ModuleDiscoveryCoordinator();
  }

  /**
   * 执行模块发现
   *
   * @param repoPath 仓库路径
   * @param maxDepth 最大递归深度（默认 3）
   */
  async discover(repoPath: string, maxDepth = 3): Promise<ModuleDiscoveryResult> {
    logger.info(`Starting module discovery for: ${repoPath}`);
    return this.coordinator.discover(repoPath, maxDepth);
  }

  /**
   * 构建 ModuleTopology
   *
   * 将发现结果转换为标准拓扑结构
   */
  buildTopology(discoveryResult: ModuleDiscoveryResult): ModuleTopology {
    return this.coordinator.buildTopology(discoveryResult);
  }

  /**
   * 获取发现结果摘要
   */
  getSummary(discoveryResult: ModuleDiscoveryResult): ModuleDiscoverySummary {
    const deployableCount = discoveryResult.modules.filter(m => m.role === 'deployable').length;
    const sharedCount = discoveryResult.modules.filter(m => m.role === 'shared').length;

    return {
      moduleCount: discoveryResult.moduleCount,
      repoType: discoveryResult.repoType,
      couplingMode: discoveryResult.couplingMode,
      deployableCount,
      sharedCount,
      modules: discoveryResult.modules.map(m => ({
        name: m.name,
        role: m.role,
        type: m.type,
        path: m.path,
      })),
    };
  }
}

/**
 * 模块发现摘要
 */
export interface ModuleDiscoverySummary {
  moduleCount: number;
  repoType: RepoType;
  couplingMode: CouplingMode;
  deployableCount: number;
  sharedCount: number;
  modules: Array<{
    name: string;
    role: string;
    type: string;
    path: string;
  }>;
}

/**
 * 创建模块发现器实例
 */
export function createModuleDiscoverer(): ModuleDiscoverer {
  return new ModuleDiscoverer();
}