/**
 * PartitionCandidate 验证脚本
 *
 * 验证静态分析阶段：
 * 1. TraceResult → PartitionCandidate 转换
 * 2. CandidateRelation 计算
 * 3. CandidateGroup 构建
 *
 * 不调用 LLM，仅验证数据结构和逻辑正确性
 */

import { getStoragePaths, loadMeta } from "../engine/storage/repo-manager.js";
import { withReadOnlyLbug } from "../engine/lbug/read-only-session.js";
import { createTraceChainBuilder } from "./trace-chain-builder.js";
import { createTableAnchorCollector } from "./table-anchor-collector.js";
import { createCandidateBuilder } from "./candidate-builder.js";
import type { TraceResult, MapperInfo, DomainClusterInput } from "./types.js";
import { logger } from "../shared/logger.js";
import fs from "fs/promises";
import path from "path";

/**
 * 验证配置
 */
export interface ValidationConfig {
  /** 项目路径 */
  repoPath: string;
  /** 输出目录（可选，默认 .internal/validation/） */
  outputDir?: string;
  /** 是否输出详细日志 */
  verbose?: boolean;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 项目路径 */
  repoPath: string;
  /** 发现的入口点数量 */
  entryPointCount: number;
  /** 追溯结果数量 */
  traceResultCount: number;
  /** 候选分区数量 */
  candidateCount: number;
  /** 候选关系数量 */
  relationCount: number;
  /** 预分组数量 */
  groupCount: number;
  /** 候选详情 */
  candidates: {
    candidateId: string;
    anchorTable: string;
    entryPointCount: number;
    tableCount: number;
    mapperCount: number;
    serviceCount: number;
  }[];
  /** 关系详情 */
  relations: {
    candidateIdA: string;
    candidateIdB: string;
    sharedTables: string[];
    sharedServices: string[];
    sharedMappers: string[];
    hasForeignKeyRelation: boolean;
  }[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 执行时间（毫秒） */
  executionTimeMs: number;
}

/**
 * 运行验证
 */
export async function runValidation(
  config: ValidationConfig,
): Promise<ValidationResult> {
  const startTime = Date.now();
  const repoPath = config.repoPath;
  const { lbugPath, storagePath } = getStoragePaths(repoPath);

  logger.info(`Starting candidate validation for: ${repoPath}`);

  try {
    // 确保图数据库索引存在
    const meta = await loadMeta(storagePath);
    if (!meta) {
      return {
        repoPath,
        entryPointCount: 0,
        traceResultCount: 0,
        candidateCount: 0,
        relationCount: 0,
        groupCount: 0,
        candidates: [],
        relations: [],
        success: false,
        error: "No analysis index found. Run `rkg init` first.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 检查 lbug 文件是否存在
    try {
      await fs.stat(lbugPath);
    } catch {
      return {
        repoPath,
        entryPointCount: 0,
        traceResultCount: 0,
        candidateCount: 0,
        relationCount: 0,
        groupCount: 0,
        candidates: [],
        relations: [],
        success: false,
        error: "No graph database found. Run `rkg init` first.",
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 使用 withReadOnlyLbug 执行追溯
    const traceResults = await withReadOnlyLbug(lbugPath, async (query) => {
      const traceBuilder = createTraceChainBuilder(query, repoPath);
      const tableCollector = createTableAnchorCollector(query, repoPath);

      // 1. 发现入口点
      logger.info("Discovering entry points...");
      const entryPoints = await traceBuilder.discoverEntryPoints();
      logger.info(`Found ${entryPoints.length} entry points`);

      // 2. 追溯每个入口点
      logger.info("Tracing entry points...");
      const results: TraceResult[] = [];

      for (const entryPoint of entryPoints) {
        try {
          const traceResult = await traceBuilder.traceEntryPoint(entryPoint);
          results.push(traceResult);
          logger.debug(
            `Traced ${entryPoint.className}: ${traceResult.tables.length} tables, ${traceResult.mappers.length} mappers`,
          );
        } catch (err) {
          logger.warn(`Failed to trace ${entryPoint.className}: ${err}`);
        }
      }

      // 3. 收集所有 Mapper 信息
      const allMappers: MapperInfo[] = [];
      for (const result of results) {
        for (const mapper of result.mappers) {
          if (!allMappers.some((m) => m.className === mapper.className)) {
            allMappers.push(mapper);
          }
        }
      }

      // 4. 分析表的外键关系
      logger.info("Analyzing foreign keys...");
      const allTables = results.flatMap((r) => r.tables);
      const allEntities = results.flatMap((r) => r.entities);
      const enrichedTables = await tableCollector.analyzeForeignKeys(
        allTables,
        allEntities,
      );

      // 更新 traceResults 的表信息
      for (const result of results) {
        for (const table of result.tables) {
          const enriched = enrichedTables.find(
            (t) => t.tableName === table.tableName,
          );
          if (enriched) {
            table.relationType = enriched.relationType;
            table.foreignKey = enriched.foreignKey;
          }
        }
      }

      return results;
    });

    logger.info(`Trace completed: ${traceResults.length} results`);

    // 5. 构建候选
    logger.info("Building candidates...");
    const candidateBuilder = createCandidateBuilder();
    const domainClusterInput = candidateBuilder.buildDomainClusterInput(
      traceResults,
      repoPath,
    );

    // 6. 构建验证结果
    const candidates = domainClusterInput.candidates.map((c) => ({
      candidateId: c.candidateId,
      anchorTable: c.anchorTable,
      entryPointCount: c.entryPoints.length,
      tableCount: c.tables.length,
      mapperCount: c.mappers.length,
      serviceCount: c.services.length,
    }));

    const relations = domainClusterInput.candidateRelations.map((r) => ({
      candidateIdA: r.candidateIdA,
      candidateIdB: r.candidateIdB,
      sharedTables: r.sharedTables,
      sharedServices: r.sharedServices,
      sharedMappers: r.sharedMappers,
      hasForeignKeyRelation: r.tableForeignKeyRelations.length > 0,
    }));

    const result: ValidationResult = {
      repoPath,
      entryPointCount: traceResults.length,
      traceResultCount: traceResults.length,
      candidateCount: domainClusterInput.candidates.length,
      relationCount: domainClusterInput.candidateRelations.length,
      groupCount: domainClusterInput.candidateGroups.length,
      candidates,
      relations,
      success: true,
      executionTimeMs: Date.now() - startTime,
    };

    // 7. 输出到文件（可选）
    if (config.outputDir) {
      const outputFilePath = path.join(
        config.outputDir,
        `validation-${Date.now()}.json`,
      );
      await fs.mkdir(config.outputDir, { recursive: true });
      await fs.writeFile(
        outputFilePath,
        JSON.stringify(result, null, 2),
        "utf-8",
      );
      logger.info(`Validation result saved to: ${outputFilePath}`);
    }

    // 输出完整候选信息（用于人工检查）
    const fullOutputPath = path.join(
      config.outputDir ?? path.join(storagePath, "validation"),
      `candidates-${Date.now()}.json`,
    );
    await fs.mkdir(path.dirname(fullOutputPath), { recursive: true });
    await fs.writeFile(
      fullOutputPath,
      JSON.stringify(domainClusterInput, null, 2),
      "utf-8",
    );
    logger.info(`Full candidate data saved to: ${fullOutputPath}`);

    return result;
  } catch (err) {
    logger.error("Validation failed:", err);
    return {
      repoPath,
      entryPointCount: 0,
      traceResultCount: 0,
      candidateCount: 0,
      relationCount: 0,
      groupCount: 0,
      candidates: [],
      relations: [],
      success: false,
      error: String(err),
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * 批量验证多个项目
 */
export async function runBatchValidation(
  configs: ValidationConfig[],
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  for (const config of configs) {
    logger.info(`\n========== Validating: ${config.repoPath} ==========`);
    const result = await runValidation(config);
    results.push(result);

    // 输出摘要
    if (result.success) {
      logger.info(`
Validation Summary for ${config.repoPath}:
- Entry Points: ${result.entryPointCount}
- Candidates: ${result.candidateCount}
- Relations: ${result.relationCount}
- Groups: ${result.groupCount}
`);
    } else {
      logger.error(`Validation failed for ${config.repoPath}: ${result.error}`);
    }
  }

  return results;
}

/**
 * 创建验证器实例
 */
export function createCandidateValidator(): {
  run: (config: ValidationConfig) => Promise<ValidationResult>;
  runBatch: (configs: ValidationConfig[]) => Promise<ValidationResult[]>;
} {
  return {
    run: runValidation,
    runBatch: runBatchValidation,
  };
}
