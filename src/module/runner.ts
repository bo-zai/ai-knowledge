/**
 * 模块划分运行器
 *
 * 整合发现、分析、写入流程
 */

import { logger, setLogLevel } from "../shared/logger.js";
import { createModuleDiscoverer } from "./discoverer.js";
import { createModuleAnalyzer } from "./analyzer.js";
import { createModuleWriter } from "./writer.js";
import type { ModuleConfig, ModuleResult, ModuleTopology } from "./types.js";

/**
 * 运行模块划分
 *
 * 执行完整流程：
 * 1. 检查已有 modules.json（可选跳过）
 * 2. 模块发现
 * 3. 耦合度评估
 * 4. 保存结果
 */
export async function runModule(config: ModuleConfig): Promise<ModuleResult> {
  // 设置日志级别
  if (config.verbose) {
    setLogLevel("debug");
  }

  const repoPath = config.repoPath;
  const outputRoot = config.outputRoot ?? repoPath;
  const maxDepth = config.maxDepth ?? 3;

  logger.info(`Running module division for: ${repoPath}`);

  // 创建组件
  const discoverer = createModuleDiscoverer();
  const analyzer = createModuleAnalyzer();
  const writer = createModuleWriter();

  // 1. 检查已有 modules.json
  if (!config.force) {
    const existing = await writer.load(outputRoot);
    if (existing) {
      logger.info("Using existing module topology (use --force to reanalyze)");
      return {
        topology: existing,
        outputPath: writer.getPath(outputRoot),
        isNew: false,
      };
    }
  }

  // 2. 模块发现
  logger.info("Discovering modules...");
  const discoveryResult = await discoverer.discover(repoPath, maxDepth);

  // 3. 构建拓扑
  let topology = discoverer.buildTopology(discoveryResult);

  // 4. 详细耦合度评估
  logger.info("Evaluating coupling signals...");
  const couplingSignals = await analyzer.evaluateCouplingSignals(
    repoPath,
    discoveryResult.modules,
  );

  // 更新拓扑中的耦合信号
  topology = {
    ...topology,
    couplingSignals: couplingSignals.map((s) => ({
      signal: s.signal,
      detected: s.detected,
      evidence: s.evidence,
    })),
    couplingMode: analyzer.decideCouplingMode(
      couplingSignals,
      discoveryResult.modules,
    ),
  };

  // 5. 保存结果
  const outputPath = await writer.save(topology, outputRoot);

  // 输出摘要
  const summary = discoverer.getSummary(discoveryResult);
  logger.info(`Module division completed:`);
  logger.info(`  - Modules: ${summary.moduleCount}`);
  logger.info(`  - Repo type: ${summary.repoType}`);
  logger.info(`  - Coupling mode: ${topology.couplingMode}`);
  logger.info(`  - Deployable: ${summary.deployableCount}`);
  logger.info(`  - Shared: ${summary.sharedCount}`);

  return {
    topology,
    outputPath,
    isNew: true,
  };
}

/**
 * 加载已有的模块拓扑
 *
 * 用于其他命令复用模块划分结果
 */
export async function loadModuleTopology(
  outputRoot: string,
): Promise<ModuleTopology | null> {
  const writer = createModuleWriter();
  return writer.load(outputRoot);
}

/**
 * 检查是否存在模块拓扑
 */
export async function hasModuleTopology(outputRoot: string): Promise<boolean> {
  const writer = createModuleWriter();
  return writer.exists(outputRoot);
}
