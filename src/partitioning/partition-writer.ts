/**
 * Partition JSON 写入器
 *
 * 输出目录结构：
 * .internal/partitions/
 * ├── {anchorTable}.json    # 每个 partition 文件
 * ├── _index.json           # 索引文件
 */

import fs from "fs/promises";
import path from "path";
import type {
  DomainPartition,
  PartitionIndex,
  PartitionIndexEntry,
  CandidateSnapshot,
  StoredLlmDecision,
} from "./types.js";
import { logger } from "../shared/logger.js";

/**
 * PartitionWriter - JSON 写入器
 */
export class PartitionWriter {
  readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * 确保 .internal/partitions/ 目录存在
   */
  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  /**
   * 写入单个 Partition JSON 文件
   */
  async writePartition(partition: DomainPartition): Promise<string> {
    const fileName = this.getPartitionFileName(partition);
    const filePath = path.join(this.outputDir, fileName);

    // 精简 JSON：移除未填充的字段
    const compactPartition = this.compactPartition(partition);

    await fs.writeFile(
      filePath,
      JSON.stringify(compactPartition, null, 2),
      "utf-8",
    );

    return filePath;
  }

  /**
   * 写入所有 Partition 文件
   */
  async writeAllPartitions(
    partitions: DomainPartition[],
    candidateSnapshot?: CandidateSnapshot,
    llmDecisions?: StoredLlmDecision[],
    partitionMode?: string,
  ): Promise<string[]> {
    await this.ensureOutputDir();

    // 过滤空分区（没有表的分区不应该写入）
    const validPartitions = partitions.filter(
      (partition) => partition.tables && partition.tables.length > 0,
    );

    if (validPartitions.length < partitions.length) {
      logger.warn(
        `Filtered ${partitions.length - validPartitions.length} empty partitions`,
      );
    }

    const filePaths: string[] = [];
    for (const partition of validPartitions) {
      const filePath = await this.writePartition(partition);
      if (filePath) {
        filePaths.push(filePath);
      }
    }

    // 写入索引文件（只包含有效分区）
    await this.writeIndex(
      validPartitions,
      candidateSnapshot,
      llmDecisions,
      partitionMode,
    );

    return filePaths;
  }

  /**
   * 写入索引文件 _index.json
   */
  async writeIndex(
    partitions: DomainPartition[],
    candidateSnapshot?: CandidateSnapshot,
    llmDecisions?: StoredLlmDecision[],
    partitionMode?: string,
  ): Promise<string> {
    const indexPath = path.join(this.outputDir, "_index.json");

    const entries: PartitionIndexEntry[] = partitions.map((p) => ({
      partitionId: p.partitionId,
      file: this.getPartitionFileName(p),
      anchorTable: this.getPartitionAnchor(p),
      tableCount: p.tables.length,
      entryPointCount: p.entryPoints.length,
      isCrossModule: p.backendModules.length > 1,
    }));

    const index: PartitionIndex = {
      version: "1.0.0",
      algorithmVersion: partitions[0]?.algorithmVersion ?? "1.0.0",
      updatedAt: new Date().toISOString(),
      partitionMode,
      // 添加候选快照（用于增量更新）
      candidateSnapshot,
      // 添加 LLM 决策（用于增量更新参考）
      llmDecisions,
      partitions: entries,
      stats: {
        totalPartitions: partitions.length,
        crossModuleCount: entries.filter((e) => e.isCrossModule).length,
        backendEntryPointCount: partitions.reduce(
          (sum, p) => sum + p.entryPoints.length,
          0,
        ),
      },
    };

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");

    return indexPath;
  }

  /**
   * 清理整个输出目录（用于 force 模式）
   */
  async cleanOutputDir(): Promise<void> {
    try {
      // 删除所有文件
      const files = await fs.readdir(this.outputDir);
      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        await fs.unlink(filePath);
      }
      logger.info(`Cleaned ${files.length} files from output directory`);
    } catch (err) {
      // 目录不存在，忽略
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * 精简 Partition：移除空字段
   */
  private compactPartition(
    partition: DomainPartition,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {
      partitionId: partition.partitionId,
      partitionHash: partition.partitionHash,
      algorithmVersion: partition.algorithmVersion,
    };

    // tables
    if (partition.tables.length > 0) {
      result.tables = partition.tables.map((t) => this.compactTableInfo(t));
    }

    // entryPoints
    if (partition.entryPoints.length > 0) {
      result.entryPoints = partition.entryPoints.map((ep) =>
        this.compactEntryPoint(ep),
      );
    }

    // sharedResources
    if (partition.sharedResources) {
      const sr: Record<string, unknown> = {};
      if ((partition.sharedResources.coreLogic?.length ?? 0) > 0) {
        sr.coreLogic = partition.sharedResources.coreLogic;
      }
      if ((partition.sharedResources.dataLayer?.length ?? 0) > 0) {
        sr.dataLayer = partition.sharedResources.dataLayer;
      }
      if ((partition.sharedResources.entities?.length ?? 0) > 0) {
        sr.entities = partition.sharedResources.entities;
      }
      if (Object.keys(sr).length > 0) {
        result.sharedResources = sr;
      }
    }

    // backendModules
    if (partition.backendModules.length > 0) {
      result.backendModules = partition.backendModules;
    }

    // frontend
    if (partition.frontend) {
      result.frontend = partition.frontend;
    }

    // frontendBackendLinks
    if ((partition.frontendBackendLinks?.length ?? 0) > 0) {
      result.frontendBackendLinks = partition.frontendBackendLinks;
    }

    // noEntryTables
    if ((partition.noEntryTables?.length ?? 0) > 0) {
      result.noEntryTables = partition.noEntryTables;
    }

    // confidenceBreakdown
    result.confidenceBreakdown = partition.confidenceBreakdown;

    // crossDomainRefs
    if ((partition.crossDomainRefs?.length ?? 0) > 0) {
      result.crossDomainRefs = partition.crossDomainRefs;
    }

    // domainKeywords
    if ((partition.domainKeywords?.length ?? 0) > 0) {
      result.domainKeywords = partition.domainKeywords;
    }

    // contentHash
    result.contentHash = partition.contentHash;

    // fileHashes
    if (partition.fileHashes) {
      result.fileHashes = partition.fileHashes;
    }

    // lastCommitHash
    if (partition.lastCommitHash) {
      result.lastCommitHash = partition.lastCommitHash;
    }

    // updatedAt
    result.updatedAt = partition.updatedAt;

    return result;
  }

  private getPartitionFileName(partition: DomainPartition): string {
    const anchorTable = this.getPartitionAnchor(partition);
    if (anchorTable) {
      return `${anchorTable}.json`;
    }

    return `${partition.partitionId.replace(/[:/\\]+/g, "_")}.json`;
  }

  private getPartitionAnchor(partition: DomainPartition): string {
    return (
      partition.tables.find((t) => t.role === "primary")?.tableName ??
      partition.tables[0]?.tableName ??
      partition.backendModules[0]?.name ??
      partition.partitionId.replace(/[:/\\]+/g, "_")
    );
  }

  /**
   * 精简 TableInfo
   */
  private compactTableInfo(table: TableInfo): Record<string, unknown> {
    const result: Record<string, unknown> = {
      tableName: table.tableName,
      role: table.role,
    };

    if (table.tableType) result.tableType = table.tableType;
    if (table.schema) result.schema = table.schema;
    if (table.relationType) result.relationType = table.relationType;
    if (table.foreignKey) result.foreignKey = table.foreignKey;
    if (table.shardGroup) result.shardGroup = table.shardGroup;
    if (table.junctionBetween) result.junctionBetween = table.junctionBetween;
    if (table.baseTables) result.baseTables = table.baseTables;

    return result;
  }

  /**
   * 精简 EntryPoint
   */
  private compactEntryPoint(ep: EntryPoint): Record<string, unknown> {
    const result: Record<string, unknown> = {
      kind: ep.kind,
      className: ep.className,
      methodName: ep.methodName,
      filePath: ep.filePath,
      startLine: ep.startLine,
      module: ep.module,
    };

    if (ep.clientType) result.clientType = ep.clientType;
    if (ep.signature) result.signature = ep.signature;
    if ((ep.callChain?.length ?? 0) > 0) result.callChain = ep.callChain;
    if ((ep.crossDomainCalls?.length ?? 0) > 0)
      result.crossDomainCalls = ep.crossDomainCalls;
    if (ep.noServiceLayer) result.noServiceLayer = ep.noServiceLayer;
    if (ep.mqType) result.mqType = ep.mqType;
    if (ep.mqTopic) result.mqTopic = ep.mqTopic;

    return result;
  }
}

// 导入类型用于 compact 方法
import type { TableInfo, EntryPoint } from "./types.js";

/**
 * 创建 PartitionWriter 实例
 */
export function createPartitionWriter(outputDir: string): PartitionWriter {
  return new PartitionWriter(outputDir);
}
