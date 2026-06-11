/**
 * 模块发现协调器
 *
 * 整合 Layer 1 + Layer 2 探测结果，合并去重，输出最终模块列表
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../shared/logger.js';
import type { ModuleInfo, ModuleTopology, CouplingMode } from '../../schemas/module.js';
import type { ModuleDiscoveryResult, RepoType, DetectionResult } from './types.js';
import { ROOT_DETECTORS, SUB_PROJECT_DETECTORS } from './detectors/index.js';
import type { ModuleDetector, DetectionOptions } from './detectors/detector-interface.js';

/**
 * 模块发现协调器
 *
 * 执行三层探测：
 * 1. Layer 1: 根目录构建系统探测
 * 2. Layer 2: 子目录独立项目探测
 * 3. 合并与去重
 */
export class ModuleDiscoveryCoordinator {
  /**
   * 执行模块发现
   *
   * @param repoPath 仓库路径
   * @param maxDepth 最大递归深度
   */
  async discover(repoPath: string, maxDepth = 3): Promise<ModuleDiscoveryResult> {
    logger.info('Starting module discovery...');
    logger.debug(`Repository path: ${repoPath}, maxDepth: ${maxDepth}`);

    // 已发现的模块路径（用于去重）
    const discoveredPaths = new Set<string>();
    const layerResults: ModuleDiscoveryResult['layerResults'] = {
      rootBuildSystem: [],
      subProject: [],
    };

    // ========== Layer 1: 根目录构建系统探测 ==========
    const rootModules = await this.runLayer1(repoPath, discoveredPaths, maxDepth, layerResults);

    // ========== Layer 2: 子目录独立项目探测 ==========
    // 只有当 Layer 1 发现的模块数较少时，才执行 Layer 2
    // 避免：Maven 已声明所有模块，Layer 2 还扫描一次
    const shouldRunLayer2 = this.shouldRunLayer2(rootModules);

    if (shouldRunLayer2) {
      const subModules = await this.runLayer2(repoPath, discoveredPaths, maxDepth, layerResults);
      rootModules.push(...subModules);
    }

    // ========== 合并与去重 ==========
    const finalModules = this.mergeAndDedupe(rootModules);

    // ========== 判断仓库类型 ==========
    const repoType = this.determineRepoType(finalModules, layerResults);

    // ========== 评估耦合度 ==========
    const couplingMode = this.evaluateCouplingMode(finalModules);

    logger.info(`Module discovery completed: ${finalModules.length} modules, repoType=${repoType}, couplingMode=${couplingMode}`);

    return {
      modules: finalModules,
      moduleCount: finalModules.length,
      repoType,
      layerResults,
      couplingMode,
    };
  }

  /**
   * 执行 Layer 1 探测
   *
   * 按优先级执行探测器，一旦某个探测器成功发现模块就停止
   * （短路优化：根目录构建系统是明确的声明，无需继续探测其他类型）
   */
  private async runLayer1(
    repoPath: string,
    discoveredPaths: Set<string>,
    maxDepth: number,
    layerResults: ModuleDiscoveryResult['layerResults'],
  ): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];

    // 按优先级排序
    const detectors = [...ROOT_DETECTORS].sort((a, b) => a.priority - b.priority);

    for (const detector of detectors) {
      logger.debug(`Layer 1: checking ${detector.name}...`);

      const canDetect = await detector.canDetect(repoPath);

      if (canDetect) {
        logger.debug(`Layer 1: ${detector.name} can detect, running...`);

        const options: DetectionOptions = {
          discoveredPaths,
          maxDepth,
        };

        const result = await detector.detect(repoPath, options);
        layerResults.rootBuildSystem.push(result);

        if (result.success && result.modules.length > 0) {
          modules.push(...result.modules);
          logger.debug(`Layer 1: ${detector.name} found ${result.modules.length} modules`);

          // 短路：如果是构建系统多模块，不再探测其他类型
          // 但如果只发现少量模块（可能是聚合模块），继续探测
          if (result.modules.length > 3) {
            break;
          }
        }
      }
    }

    return modules;
  }

  /**
   * 判断是否需要执行 Layer 2
   *
   * 条件：
   * 1. Layer 1 未发现任何模块 → 根目录无构建配置，需要扫描子目录
   * 2. Layer 1 发现单项目（path=''）→ 不执行 Layer 2
   * 3. Layer 1 发现的模块数 ≤ 3 → 可能是聚合模块，子目录还有实际项目
   * 4. 根目录有子目录未被 Layer 1 发现
   */
  private shouldRunLayer2(layer1Modules: ModuleInfo[]): boolean {
    // Layer 1 未发现任何模块 → 必须执行 Layer 2
    if (layer1Modules.length === 0) {
      return true;
    }

    // Layer 1 发现单项目（path='' 或所有模块都是根目录）→ 不执行 Layer 2
    if (layer1Modules.some(m => m.path === '' || m.path === './')) {
      return false;
    }

    // Layer 1 发现大量模块（> 5）→ 构建系统已声明完整，跳过 Layer 2
    if (layer1Modules.length > 5) {
      return false;
    }

    // Layer 1 发现少量模块 → 可能是混合型，检查是否有未发现的子目录
    // 简化处理：总是执行 Layer 2，依赖去重机制
    return true;
  }

  /**
   * 执行 Layer 2 探测
   *
   * 扫描子目录，发现独立项目
   */
  private async runLayer2(
    repoPath: string,
    discoveredPaths: Set<string>,
    maxDepth: number,
    layerResults: ModuleDiscoveryResult['layerResults'],
  ): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];

    for (const detector of SUB_PROJECT_DETECTORS) {
      logger.debug(`Layer 2: checking ${detector.name}...`);

      const canDetect = await detector.canDetect(repoPath);

      if (canDetect) {
        logger.debug(`Layer 2: ${detector.name} can detect, running...`);

        const options: DetectionOptions = {
          discoveredPaths,
          maxDepth,
        };

        const result = await detector.detect(repoPath, options);
        layerResults.subProject.push(result);

        if (result.success && result.modules.length > 0) {
          modules.push(...result.modules);
          logger.debug(`Layer 2: ${detector.name} found ${result.modules.length} modules`);
        }
      }
    }

    return modules;
  }

  /**
   * 合并与去重
   */
  private mergeAndDedupe(modules: ModuleInfo[]): ModuleInfo[] {
    // 按 path 去重（同名路径只保留一个）
    const seenPaths = new Map<string, ModuleInfo>();

    for (const module of modules) {
      const existing = seenPaths.get(module.path);

      if (!existing) {
        seenPaths.set(module.path, module);
      } else {
        // 合并信息：如果新模块有更多信息，补充到已有模块
        if (module.description && !existing.description) {
          existing.description = module.description;
        }
        if (module.entryPoint && !existing.entryPoint) {
          existing.entryPoint = module.entryPoint;
        }
        // 合并依赖
        for (const dep of module.dependencies) {
          if (!existing.dependencies.includes(dep)) {
            existing.dependencies.push(dep);
          }
        }
        for (const usedBy of module.usedBy) {
          if (!existing.usedBy.includes(usedBy)) {
            existing.usedBy.push(usedBy);
          }
        }
      }
    }

    // 更新依赖关系（反向引用）
    const finalModules = Array.from(seenPaths.values());
    const moduleNames = new Set(finalModules.map(m => m.name));

    for (const module of finalModules) {
      for (const dep of module.dependencies) {
        const depModule = finalModules.find(m => m.name === dep);
        if (depModule && !depModule.usedBy.includes(module.name)) {
          depModule.usedBy.push(module.name);
        }
      }
    }

    return finalModules;
  }

  /**
   * 判断仓库类型
   */
  private determineRepoType(
    modules: ModuleInfo[],
    layerResults: ModuleDiscoveryResult['layerResults'],
  ): RepoType {
    // 1. 无模块 → 单项目仓库
    if (modules.length === 0) {
      return 'single-project';
    }

    // 2. 只有根目录模块（path='' 或 './') → 单项目仓库
    const hasRootModule = modules.some(m => m.path === '' || m.path === './');
    if (modules.length === 1 && hasRootModule) {
      return 'single-project';
    }

    // 3. 只有 Layer 1 发现模块
    const layer1Found = layerResults.rootBuildSystem.some(r => r.success && r.modules.length > 0);
    const layer2Found = layerResults.subProject.some(r => r.success && r.modules.length > 0);

    if (layer1Found && !layer2Found) {
      // 如果 Layer 1 发现的所有模块都是根目录 → 单项目
      if (modules.every(m => m.path === '' || m.path === './')) {
        return 'single-project';
      }
      return 'build-system-multi-module';
    }

    // 4. 只有 Layer 2 发现模块 → 业务域多项目
    if (!layer1Found && layer2Found) {
      return 'business-domain-multi-project';
    }

    // 5. Layer 1 + Layer 2 都发现模块 → 混合型
    if (layer1Found && layer2Found) {
      return 'hybrid';
    }

    // 6. 检查是否有嵌套模块（模块路径有嵌套）
    const hasNested = modules.some(m => m.path.includes('/') && m.path.split('/').length > 2);
    if (hasNested) {
      return 'nested';
    }

    return 'single-project';
  }

  /**
   * 评估耦合度
   *
   * 简化版本：基于模块数量和角色分布
   */
  private evaluateCouplingMode(modules: ModuleInfo[]): CouplingMode {
    if (modules.length <= 1) {
      return 'tightly-coupled';
    }

    // 计算 deployable 和 shared 模块数量
    const deployableCount = modules.filter(m => m.role === 'deployable').length;
    const sharedCount = modules.filter(m => m.role === 'shared').length;

    // 有 shared 模块且被多个 deployable 使用 → 紧耦合
    if (sharedCount > 0) {
      for (const shared of modules.filter(m => m.role === 'shared')) {
        if (shared.usedBy.length >= 2) {
          return 'tightly-coupled';
        }
      }
    }

    // deployable 模块之间有依赖 → 紧耦合
    const deployableModules = modules.filter(m => m.role === 'deployable');
    for (const module of deployableModules) {
      const crossDeps = module.dependencies.filter(
        dep => deployableModules.some(m => m.name === dep)
      );
      if (crossDeps.length > 0) {
        return 'tightly-coupled';
      }
    }

    // deployable 模块数量 > 10 → 松耦合
    if (deployableCount > 10) {
      return 'loosely-coupled';
    }

    // 只有 1 个 deployable → 紧耦合
    if (deployableCount <= 1) {
      return 'tightly-coupled';
    }

    // 无 shared 模块 → 松耦合
    if (sharedCount === 0) {
      return 'loosely-coupled';
    }

    // 默认：紧耦合（保守策略）
    return 'tightly-coupled';
  }

  /**
   * 构建 ModuleTopology
   */
  buildTopology(discoveryResult: ModuleDiscoveryResult): ModuleTopology {
    return {
      schemaVersion: 1,
      couplingMode: discoveryResult.couplingMode,
      moduleCount: discoveryResult.moduleCount,
      modules: discoveryResult.modules,
      analyzedAt: new Date().toISOString(),
      couplingSignals: [
        {
          signal: 'shared-entities',
          detected: discoveryResult.modules.some(m => m.role === 'shared' && m.usedBy.length >= 2),
          evidence: undefined,
        },
        {
          signal: 'cross-module-calls',
          detected: false, // 简化处理
          evidence: undefined,
        },
        {
          signal: 'module-count',
          detected: discoveryResult.moduleCount <= 10,
          evidence: `模块数量: ${discoveryResult.moduleCount}`,
        },
      ],
    };
  }
}