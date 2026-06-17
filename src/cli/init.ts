/**
 * init 命令 - 初始化图数据（运行嵌入式分析）
 *
 * 此命令独立执行图数据初始化，与 generate 命令复用相同的 initGraphData 逻辑。
 */

import path from "path";
import { logger, setLogLevel, closeLogFile } from "../shared/logger.js";
import { resolveTargetRepo } from "../shared/resolve-target-repo.js";
import { initGraphData } from "../query/prepare-generation.js";
import { closeAllLbugResources } from "../engine/lbug/pool-adapter.js";

interface InitOptions {
  repo?: string;
  path?: string;
  force?: boolean;
  verbose?: boolean;
}

export async function runInit(options: InitOptions): Promise<void> {
  if (options.verbose) {
    setLogLevel("debug");
  }

  // 解析目标仓库路径
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;
  logger.debug(`Resolved repo path from ${resolved.source}: ${repoPath}`);

  logger.info(`Initializing graph data for ${repoPath}`);

  // 执行图数据初始化
  const graphStatus = await initGraphData({
    repoPath,
    forceAnalyze: options.force,
    mockMode: false, // init 命令不支持 mock 模式
  });

  // 输出结果摘要
  logger.info(`Graph initialization complete:`);
  logger.info(`  Status: ${graphStatus.status}`);
  logger.info(`  Nodes: ${graphStatus.nodeCount}`);
  logger.info(`  Edges: ${graphStatus.edgeCount}`);
  logger.info(`  Analyzed at: ${graphStatus.analyzedAt}`);
  if (graphStatus.analysisDuration) {
    logger.info(`  Duration: ${graphStatus.analysisDuration}ms`);
  }

  closeLogFile();
  await closeAllLbugResources();
  // LadybugDB native 模块的 N-API destructor 在 Windows 上可能阻止进程正常退出。
  // 所有 Node.js 层面的资源已正确清理，可以安全强制退出。
  process.exit(0);
}
