/**
 * CLI module 命令
 *
 * 运行模块划分，生成 modules.json
 */

import path from "path";
import { logger, setLogLevel } from "../shared/logger.js";
import { runModule } from "../module/index.js";
import type { ModuleConfig } from "../module/types.js";

export interface ModuleCliOptions {
  repo?: string;
  path?: string;
  force?: boolean;
  verbose?: boolean;
  maxDepth?: number;
}

/**
 * 运行 module 命令
 */
export async function runModuleCommand(
  options: ModuleCliOptions,
): Promise<void> {
  // 设置日志级别
  if (options.verbose) {
    setLogLevel("debug");
  }

  // 解析仓库路径
  const repoPath = options.repo ?? options.path ?? process.cwd();
  logger.info(`Running module division for: ${repoPath}`);

  // 配置
  const config: ModuleConfig = {
    repoPath,
    force: options.force ?? false,
    maxDepth: options.maxDepth ?? 3,
    verbose: options.verbose ?? false,
  };

  try {
    // 运行模块划分
    const result = await runModule(config);

    // 输出结果摘要
    console.log("\n=== Module Division Result ===");
    console.log(`Output file: ${result.outputPath}`);
    console.log(`Status: ${result.isNew ? "新建" : "复用已有"}`);

    const topology = result.topology;
    console.log(`\nModules: ${topology.moduleCount}`);
    console.log(`Coupling mode: ${topology.couplingMode}`);

    // 显示模块列表
    console.log("\nModule list:");
    for (const module of topology.modules) {
      console.log(`  - ${module.name} (${module.role}, ${module.type})`);
      console.log(`    Path: ${module.path}`);
      if (module.dependencies.length > 0) {
        console.log(`    Dependencies: ${module.dependencies.join(", ")}`);
      }
      if (module.usedBy.length > 0) {
        console.log(`    Used by: ${module.usedBy.join(", ")}`);
      }
    }

    // 显示耦合信号
    if (topology.couplingSignals && topology.couplingSignals.length > 0) {
      console.log("\nCoupling signals:");
      for (const signal of topology.couplingSignals) {
        const status = signal.detected ? "✓ detected" : "✗ not detected";
        console.log(`  - ${signal.signal}: ${status}`);
        if (signal.evidence) {
          console.log(`    Evidence: ${signal.evidence}`);
        }
      }
    }

    console.log("\n✓ Module division completed successfully");
  } catch (err) {
    logger.error(`Module division failed: ${err}`);
    console.error(`\n✗ Module division failed: ${err}`);
    throw err;
  }
}
