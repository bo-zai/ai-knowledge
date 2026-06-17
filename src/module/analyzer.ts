/**
 * 模块分析器
 *
 * 执行耦合度评估和模块拓扑分析
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger.js';
import type { ModuleInfo, ModuleTopology, CouplingMode, SignalDetectionResult } from './types.js';
import { COUPLING_SIGNALS } from './types.js';

/**
 * 模块分析器
 *
 * 执行详细的耦合度评估（6 信号检测）
 */
export class ModuleAnalyzer {
  /**
   * 执行完整的耦合度评估
   *
   * 评估 6 个耦合信号，输出详细结果
   */
  async evaluateCouplingSignals(
    repoPath: string,
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult[]> {
    const results: SignalDetectionResult[] = [];

    // 信号 1: 共享实体类
    results.push(await this.detectSharedEntities(repoPath, modules));

    // 信号 2: 跨模块调用
    results.push(await this.detectCrossModuleCalls(modules));

    // 信号 3: 共享数据库配置
    results.push(await this.detectSharedDbConfig(repoPath, modules));

    // 信号 4: 跨模块事务边界
    results.push(await this.detectTransactionBoundary(repoPath, modules));

    // 信号 5: 相同技术栈
    results.push(await this.detectSameTechStack(modules));

    // 信号 6: 模块数量
    results.push({
      signal: 'module-count',
      detected: modules.length <= 10,
      evidence: `模块数量: ${modules.length}`,
    });

    return results;
  }

  /**
   * 决定耦合模式
   *
   * 根据信号检测结果和模块特征决定耦合模式
   */
  decideCouplingMode(
    signals: SignalDetectionResult[],
    modules: ModuleInfo[],
  ): CouplingMode {
    // 强信号直接决定
    const sharedEntities = signals.find(s => s.signal === 'shared-entities');
    const crossCalls = signals.find(s => s.signal === 'cross-module-calls');

    // 有共享实体类或跨模块调用 → 紧耦合
    if (sharedEntities?.detected || crossCalls?.detected) {
      return 'tightly-coupled';
    }

    // 模块数量 > 10 → 松耦合
    const moduleCount = signals.find(s => s.signal === 'module-count');
    if (moduleCount && !moduleCount.detected) {
      return 'loosely-coupled';
    }

    // 检查 deployable 模块数量
    const deployableModules = modules.filter(m => m.role === 'deployable');

    // 只有一个 deployable → 紧耦合
    if (deployableModules.length <= 1) {
      return 'tightly-coupled';
    }

    // 所有 deployable 模块无共享模块依赖 → 松耦合
    const sharedModules = modules.filter(m => m.role === 'shared');
    if (sharedModules.length === 0) {
      return 'loosely-coupled';
    }

    // 默认：紧耦合（保守策略）
    return 'tightly-coupled';
  }

  /**
   * 检测共享实体类
   */
  private async detectSharedEntities(
    repoPath: string,
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult> {
    const sharedModules = modules.filter(m => m.role === 'shared');

    if (sharedModules.length === 0) {
      return {
        signal: 'shared-entities',
        detected: false,
        evidence: '无共享模块',
      };
    }

    // 检查 shared 模块是否被多个 deployable 模块使用
    for (const shared of sharedModules) {
      if (shared.usedBy.length >= 2) {
        const deployableUsers = shared.usedBy.filter(
          name => modules.find(m => m.name === name)?.role === 'deployable'
        );
        if (deployableUsers.length >= 2) {
          return {
            signal: 'shared-entities',
            detected: true,
            evidence: `共享模块 ${shared.name} 被多个可部署服务使用: ${deployableUsers.join(', ')}`,
          };
        }
      }
    }

    // 进一步检测：实体类目录
    for (const shared of sharedModules) {
      const entityPatterns = ['entity', 'model', 'domain', 'dto'];
      const sharedPath = path.join(repoPath, shared.path.slice(0, -1));

      try {
        const srcPath = path.join(sharedPath, 'src/main/java');
        const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });

        const hasEntityPackage = entries.some(
          e => entityPatterns.some(p => path.join(e.parentPath || '', e.name).toLowerCase().includes(p))
        );

        if (hasEntityPackage && shared.usedBy.length >= 1) {
          return {
            signal: 'shared-entities',
            detected: true,
            evidence: `共享模块 ${shared.name} 包含实体类定义`,
          };
        }
      } catch {
        // 忽略
      }
    }

    return {
      signal: 'shared-entities',
      detected: false,
      evidence: '共享模块未被多个可部署服务使用',
    };
  }

  /**
   * 检测跨模块调用
   */
  private async detectCrossModuleCalls(
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult> {
    const deployableModules = modules.filter(m => m.role === 'deployable');

    if (deployableModules.length < 2) {
      return {
        signal: 'cross-module-calls',
        detected: false,
        evidence: '只有一个可部署模块',
      };
    }

    // 检查 deployable 模块间的依赖
    for (const module of deployableModules) {
      const crossDeps = module.dependencies.filter(
        dep => deployableModules.some(m => m.name === dep)
      );

      if (crossDeps.length > 0) {
        return {
          signal: 'cross-module-calls',
          detected: true,
          evidence: `可部署模块 ${module.name} 直接依赖其他可部署模块: ${crossDeps.join(', ')}`,
        };
      }
    }

    return {
      signal: 'cross-module-calls',
      detected: false,
      evidence: '可部署模块之间无直接依赖',
    };
  }

  /**
   * 检测共享数据库配置
   */
  private async detectSharedDbConfig(
    repoPath: string,
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult> {
    const deployableModules = modules.filter(m => m.role === 'deployable');

    if (deployableModules.length < 2) {
      return {
        signal: 'shared-db-config',
        detected: false,
        evidence: '只有一个可部署模块',
      };
    }

    const dbConfigs: Map<string, string[]> = new Map();

    for (const module of deployableModules) {
      const modulePath = path.join(repoPath, module.path.slice(0, -1));
      const configPatterns = [
        'src/main/resources/application.yml',
        'src/main/resources/application.properties',
        'src/main/resources/application.yaml',
      ];

      for (const configPattern of configPatterns) {
        const configPath = path.join(modulePath, configPattern);
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          const urlMatch = content.match(/(?:url|jdbcUrl)[\s:=]+['"]?([^'"\s]+)/);
          if (urlMatch) {
            const dbUrl = urlMatch[1];
            const existing = dbConfigs.get(dbUrl) ?? [];
            existing.push(module.name);
            dbConfigs.set(dbUrl, existing);
          }
        } catch {
          // 配置文件不存在
        }
      }
    }

    for (const [dbUrl, moduleNames] of dbConfigs.entries()) {
      if (moduleNames.length >= 2) {
        return {
          signal: 'shared-db-config',
          detected: true,
          evidence: `多个模块使用相同数据库: ${moduleNames.join(', ')}`,
        };
      }
    }

    return {
      signal: 'shared-db-config',
      detected: false,
      evidence: '各模块使用独立数据库配置',
    };
  }

  /**
   * 检测跨模块事务边界
   */
  private async detectTransactionBoundary(
    repoPath: string,
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult> {
    const modulePomPaths = modules
      .filter(m => m.type === 'java-maven-module')
      .map(m => path.join(repoPath, m.path.slice(0, -1), 'pom.xml'));

    for (const pomPath of modulePomPaths) {
      try {
        const content = await fs.readFile(pomPath, 'utf-8');
        const txKeywords = ['seata', 'atomikos', 'bitronix', 'narayana', 'lcn-transaction'];
        if (txKeywords.some(kw => content.toLowerCase().includes(kw))) {
          return {
            signal: 'transaction-boundary',
            detected: true,
            evidence: '检测到分布式事务依赖',
          };
        }
      } catch {
        // 忽略
      }
    }

    return {
      signal: 'transaction-boundary',
      detected: false,
      evidence: '未检测到跨模块事务',
    };
  }

  /**
   * 检测相同技术栈
   */
  private async detectSameTechStack(
    modules: ModuleInfo[],
  ): Promise<SignalDetectionResult> {
    if (modules.length === 0) {
      return {
        signal: 'same-tech-stack',
        detected: false,
        evidence: '无模块',
      };
    }

    const types = modules.map(m => m.type);
    const uniqueTypes = new Set(types);

    // Java Maven 模块默认为 Spring Boot 技术栈
    const allJavaMaven = types.every(t => t === 'java-maven-module');
    if (allJavaMaven) {
      return {
        signal: 'same-tech-stack',
        detected: true,
        evidence: '所有模块均为 Java Maven (Spring Boot)',
      };
    }

    return {
      signal: 'same-tech-stack',
      detected: uniqueTypes.size === 1,
      evidence: uniqueTypes.size === 1
        ? `所有模块类型相同: ${types[0]}`
        : `模块类型多样: ${uniqueTypes.size} 种`,
    };
  }
}

/**
 * 创建模块分析器实例
 */
export function createModuleAnalyzer(): ModuleAnalyzer {
  return new ModuleAnalyzer();
}