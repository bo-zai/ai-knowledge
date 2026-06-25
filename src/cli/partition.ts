/**
 * CLI partition 命令
 *
 * 运行 Domain Partitioning，生成独立的 JSON 文件
 */

import { getStoragePaths } from "../engine/storage/repo-manager.js";
import { runDomainPartitioning } from "../partitioning/index.js";
import { logger, setLogLevel } from "../shared/logger.js";
import { closeAllLbugResources } from "../engine/lbug/pool-adapter.js";
import type { PartitionConfig } from "../partitioning/types.js";

export interface PartitionCliOptions {
  path?: string;
  repo?: string;
  force?: boolean;
  verbose?: boolean;
  concurrency?: number | string;
}

/**
 * 运行 partition 命令
 */
export async function runPartition(
  options: PartitionCliOptions,
): Promise<void> {
  // 设置日志级别
  if (options.verbose) {
    setLogLevel("debug");
  }

  // 解析 repo path
  const repoPath = options.repo ?? options.path ?? process.cwd();
  logger.info(`Running partition for: ${repoPath}`);

  // 配置
  const config: PartitionConfig = {
    repoPath,
    force: options.force ?? false,
    algorithmVersion: "1.0.0",
    concurrency: normalizeConcurrencyOption(options.concurrency),
  };

  try {
    // 运行划分
    const result = await runDomainPartitioning(config);

    // 过滤空分区（用于显示摘要）
    const validPartitions = result.partitions.filter(
      (p) => p.tables && p.tables.length > 0,
    );

    // 输出结果摘要
    console.log("\n=== Domain Partition Result ===");
    console.log(`Partition mode: ${result.partitionMode ?? "unknown"}`);
    console.log(`Total partitions: ${validPartitions.length}`);
    if (validPartitions.length < result.partitions.length) {
      console.log(
        `  (${result.partitions.length - validPartitions.length} empty partitions filtered)`,
      );
    }
    console.log(`Output directory: ${result.outputPath}`);
    console.log(`Index file: ${result.indexFilePath}`);

    // 显示每个 partition 的摘要
    for (const partition of validPartitions) {
      const anchorTable = partition.tables.find(
        (t) => t.role === "primary",
      )?.tableName;
      console.log(`\nPartition: ${partition.partitionId}`);
      if (anchorTable) {
        console.log(`  Anchor table: ${anchorTable}`);
      }
      console.log(`  Tables: ${partition.tables.length}`);
      console.log(`  Entry points: ${partition.entryPoints.length}`);
      console.log(
        `  Mappers: ${partition.sharedResources?.dataLayer?.length ?? 0}`,
      );
      console.log(
        `  Services: ${partition.sharedResources?.coreLogic?.length ?? 0}`,
      );
      console.log(`  Modules: ${partition.backendModules.length}`);
      if (partition.backendModules.length > 1) {
        console.log(`  Cross-module: YES`);
      }
    }

    console.log("\n✓ Partition completed successfully");
    await closeAllLbugResources();
    process.exit(0);
  } catch (err) {
    logger.error(`Partition failed: ${err}`);
    console.error(`\n✗ Partition failed: ${err}`);
    await closeAllLbugResources();
    process.exit(1);
  }
}

function normalizeConcurrencyOption(
  value: number | string | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }

  return undefined;
}
