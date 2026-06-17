/**
 * DomainPartitioner 主入口
 *
 * 协调流程：
 * 1. 初始化图数据库连接
 * 2. 发现入口点（Controller, Scheduled, MQ Consumer）
 * 3. 追溯每个入口点的调用链
 * 4. 收集表锚点
 * 5. 构建 PartitionCandidate
 * 6. 增量更新判断（对比上次快照）
 * 7. LLM 语义分析（可选）
 * 8. 聚合 Partition
 * 9. 计算 fileHashes 和 lastCommitHash
 * 10. 精确文件更新
 * 11. 写入 JSON 文件（包含候选快照和 LLM 决策）
 */

import { getStoragePaths, loadMeta } from '../engine/storage/repo-manager.js';
import { withReadOnlyLbug } from '../engine/lbug/read-only-session.js';
import { createTraceChainBuilder } from './trace-chain-builder.js';
import { createPartitionAggregator, aggregateWithLLMDecisions } from './partition-aggregator.js';
import { createPartitionWriter } from './partition-writer.js';
import { createTableAnchorCollector } from './table-anchor-collector.js';
import { createCandidateBuilder } from './candidate-builder.js';
import { createDomainClusterAgentSync } from './domain-cluster-agent.js';
import { createDomainClusterTools } from '../agent-tools/domain-cluster-tools.js';
import { createAgentRuntime } from '../agent-runtime/runtime.js';
import type {
  DomainPartition,
  PartitionConfig,
  TraceResult,
  MapperInfo,
  DomainClusterInput,
  DomainMergeDecision,
  PartitionIndex,
  CandidateSnapshot,
  StoredLlmDecision,
  IncrementalUpdateResult,
  PartitionCandidate,
} from './types.js';
import { getCurrentCommit } from '../engine/storage/git.js';
import { logger } from '../shared/logger.js';
import { createHash } from 'crypto';
import { LLM_DEFAULTS } from '../config/defaults.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * DomainPartitioner 运行结果
 */
export interface PartitionResult {
  partitions: DomainPartition[];
  outputPath: string;
  indexFilePath: string;
  /** 是否执行了增量更新 */
  incremental?: boolean;
  /** 更新类型 */
  updateType?: 'none' | 'content_change' | 'structure_change' | 'force';
}

/**
 * 检查增量更新
 * 对比当前候选与上次快照，判断是否需要重新分析
 */
function checkIncrementalUpdate(
  candidates: PartitionCandidate[],
  candidateBuilder: ReturnType<typeof createCandidateBuilder>,
  previousIndex?: PartitionIndex
): IncrementalUpdateResult {
  // 如果没有上次索引，需要完全重新分析
  if (!previousIndex?.candidateSnapshot) {
    return {
      needsReanalysis: true,
      updateType: 'structure_change',
      changedCandidateIds: [],
      addedCandidateIds: candidates.map(c => c.candidateId),
      removedCandidateIds: [],
      reusableDecisions: [],
    };
  }

  const previousSnapshot = previousIndex.candidateSnapshot;
  const previousCandidates = previousSnapshot.candidates;

  // 构建候选 ID 映射
  const previousIdMap = new Map(previousCandidates.map(c => [c.candidateId, c]));
  const currentIdMap = new Map(candidates.map(c => [c.candidateId, c]));

  // 查找新增和删除的候选
  const addedCandidateIds: string[] = [];
  const removedCandidateIds: string[] = [];
  const changedCandidateIds: string[] = [];

  for (const candidate of candidates) {
    if (!previousIdMap.has(candidate.candidateId)) {
      addedCandidateIds.push(candidate.candidateId);
    } else {
      // 检查内容 hash 是否变化
      const previous = previousIdMap.get(candidate.candidateId)!;
      const currentHash = candidateBuilder.computeCandidateContentHash(candidate);
      if (previous.contentHash !== currentHash) {
        changedCandidateIds.push(candidate.candidateId);
      }
    }
  }

  for (const previous of previousCandidates) {
    if (!currentIdMap.has(previous.candidateId)) {
      removedCandidateIds.push(previous.candidateId);
    }
  }

  // 判断更新类型
  let updateType: 'none' | 'content_change' | 'structure_change';
  let needsReanalysis: boolean;

  if (addedCandidateIds.length === 0 && removedCandidateIds.length === 0 && changedCandidateIds.length === 0) {
    // 无变化
    updateType = 'none';
    needsReanalysis = false;
  } else if (addedCandidateIds.length > 0 || removedCandidateIds.length > 0) {
    // 结构变化（新增或删除候选）
    updateType = 'structure_change';
    needsReanalysis = true;
  } else {
    // 内容变化（候选内容改变）
    updateType = 'content_change';
    needsReanalysis = true;
  }

  // 提取可复用的 LLM 决策（未变化候选）
  const reusableDecisions: StoredLlmDecision[] = [];
  if (previousIndex.llmDecisions && updateType === 'content_change') {
    // 只有内容变化时，部分决策可复用
    for (const decision of previousIndex.llmDecisions) {
      // 检查决策中所有候选是否都未变化
      const allUnchanged = decision.mergeGroup.every(
        cid => !changedCandidateIds.includes(cid) && !removedCandidateIds.includes(cid)
      );
      if (allUnchanged) {
        reusableDecisions.push(decision);
      }
    }
  }

  return {
    needsReanalysis,
    updateType,
    changedCandidateIds,
    addedCandidateIds,
    removedCandidateIds,
    reusableDecisions,
    previousSnapshot,
  };
}

/**
 * 加载上次索引文件
 */
async function loadPreviousIndex(outputDir: string): Promise<PartitionIndex | undefined> {
  const indexPath = path.join(outputDir, '_index.json');
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content) as PartitionIndex;
  } catch {
    return undefined;
  }
}

/**
 * 运行 Domain Partitioning
 */
export async function runDomainPartitioning(config: PartitionConfig): Promise<PartitionResult> {
  const repoPath = config.repoPath;
  const { lbugPath, storagePath } = getStoragePaths(repoPath);
  const enableLLMAnalysis = config.enableLLMAnalysis ?? true;
  const forceMode = config.force ?? false;

  logger.info(`Starting domain partitioning for: ${repoPath}`);
  logger.info(`LLM analysis enabled: ${enableLLMAnalysis}, Force mode: ${forceMode}`);

  // 确保图数据库索引存在
  const meta = await loadMeta(storagePath);
  if (!meta) {
    logger.error('No analysis index found. Run `rkg init` first.');
    throw new Error('No analysis index found. Run `rkg init` first.');
  }

  // 检查 lbug 文件是否存在
  try {
    await fs.stat(lbugPath);
  } catch {
    logger.error('No graph database found. Run `rkg init` first.');
    throw new Error('No graph database found. Run `rkg init` first.');
  }

  // 输出目录
  const outputDir = path.join(storagePath, 'partitions');
  const writer = createPartitionWriter(outputDir);

  // Force 模式：清理整个输出目录
  if (forceMode) {
    logger.info('Force mode: cleaning output directory');
    await writer.cleanOutputDir();
  }

  // 加载上次索引（用于增量更新判断）
  const previousIndex = forceMode ? undefined : await loadPreviousIndex(outputDir);

  // 使用 withReadOnlyLbug 执行追溯
  const traceResults = await withReadOnlyLbug(lbugPath, async query => {
    const traceBuilder = createTraceChainBuilder(query, repoPath);
    const tableCollector = createTableAnchorCollector(query, repoPath);

    // 1. 发现入口点
    logger.info('Discovering entry points...');
    const entryPoints = await traceBuilder.discoverEntryPoints();
    logger.info(`Found ${entryPoints.length} entry points`);

    // 2. 追溯每个入口点
    logger.info('Tracing entry points...');
    const traceResults: TraceResult[] = [];

    for (const entryPoint of entryPoints) {
      try {
        const traceResult = await traceBuilder.traceEntryPoint(entryPoint);
        traceResults.push(traceResult);
        logger.debug(`Traced ${entryPoint.className}: ${traceResult.tables.length} tables, ${traceResult.mappers.length} mappers`);
      } catch (err) {
        logger.warn(`Failed to trace ${entryPoint.className}: ${err}`);
      }
    }

    // 3. 收集所有 Mapper 信息
    const allMappers: MapperInfo[] = [];
    for (const result of traceResults) {
      for (const mapper of result.mappers) {
        if (!allMappers.some(m => m.className === mapper.className)) {
          allMappers.push(mapper);
        }
      }
    }

    // 4. 分析表的外键关系
    logger.info('Analyzing foreign keys...');
    const allTables = traceResults.flatMap(r => r.tables);
    const allEntities = traceResults.flatMap(r => r.entities);
    const enrichedTables = await tableCollector.analyzeForeignKeys(allTables, allEntities);

    // 更新 traceResults 的表信息
    for (const result of traceResults) {
      for (const table of result.tables) {
        const enriched = enrichedTables.find(t => t.tableName === table.tableName);
        if (enriched) {
          table.relationType = enriched.relationType;
          table.foreignKey = enriched.foreignKey;
        }
      }
    }

    return traceResults;
  });

  // 5. 构建候选
  logger.info('Building candidates...');
  const candidateBuilder = createCandidateBuilder();
  const domainClusterInput = candidateBuilder.buildDomainClusterInput(traceResults, repoPath);

  // 6. 增量更新判断
  const incrementalCheck = checkIncrementalUpdate(
    domainClusterInput.candidates,
    candidateBuilder,
    previousIndex
  );

  logger.info(`Incremental check: type=${incrementalCheck.updateType}, needsReanalysis=${incrementalCheck.needsReanalysis}`);
  if (incrementalCheck.changedCandidateIds.length > 0) {
    logger.info(`Changed candidates: ${incrementalCheck.changedCandidateIds.join(', ')}`);
  }
  if (incrementalCheck.addedCandidateIds.length > 0) {
    logger.info(`Added candidates: ${incrementalCheck.addedCandidateIds.join(', ')}`);
  }
  if (incrementalCheck.removedCandidateIds.length > 0) {
    logger.info(`Removed candidates: ${incrementalCheck.removedCandidateIds.join(', ')}`);
  }

  // 如果无变化，直接返回上次分区
  if (!incrementalCheck.needsReanalysis && previousIndex) {
    logger.info('No changes detected, reusing previous partitions');

    // 加载上次分区文件
    const partitions: DomainPartition[] = [];
    for (const entry of previousIndex.partitions) {
      const filePath = path.join(outputDir, entry.file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        partitions.push(JSON.parse(content) as DomainPartition);
      } catch (err) {
        logger.warn(`Failed to load partition file ${entry.file}: ${err}`);
      }
    }

    return {
      partitions,
      outputPath: outputDir,
      indexFilePath: path.join(outputDir, '_index.json'),
      incremental: true,
      updateType: 'none',
    };
  }

  // 7. LLM 语义分析（可选）
  let partitions: DomainPartition[];
  let llmDecisions: DomainMergeDecision[] = [];
  let storedDecisions: StoredLlmDecision[] = [];

  if (enableLLMAnalysis && domainClusterInput.candidates.length > 1) {
    logger.info('Running LLM semantic analysis...');

    // 如果有可复用的决策，传入作为参考
    if (incrementalCheck.reusableDecisions.length > 0) {
      logger.info(`Using ${incrementalCheck.reusableDecisions.length} reusable decisions as reference`);
    }

    llmDecisions = await runLLMAnalysis(repoPath, domainClusterInput);

    if (llmDecisions.length > 0) {
      logger.info(`LLM returned ${llmDecisions.length} decisions`);
      partitions = aggregateWithLLMDecisions(traceResults, domainClusterInput.candidates, llmDecisions);

      // 转换为存储格式
      storedDecisions = llmDecisions.map(d => ({
        mergeGroup: d.mergeGroup,
        domainName: d.domainName,
        partitionId: findPartitionIdForDecision(partitions, d, domainClusterInput.candidates),
        confidence: d.confidence,
        reasoning: d.reasoning,
      }));
    } else {
      logger.warn('LLM analysis failed, falling back to static aggregation');
      partitions = runStaticAggregation(traceResults);
    }
  } else {
    logger.info('Using static aggregation (LLM disabled or only 1 candidate)');
    partitions = runStaticAggregation(traceResults);
  }

  // 8. 计算 fileHashes 和 lastCommitHash
  logger.info('Computing hashes...');
  await enrichPartitionsWithHashes(partitions, repoPath);

  // 9. 构建候选快照
  const candidateSnapshot = candidateBuilder.buildCandidateSnapshot(domainClusterInput.candidates, repoPath);

  // 10. 精确文件更新（非 force 模式）
  if (!forceMode && previousIndex) {
    await performIncrementalFileUpdate(outputDir, previousIndex, partitions);
  }

  // 11. 写入 JSON 文件（包含快照和决策）
  logger.info(`Writing partitions to: ${outputDir}`);
  await writer.writeAllPartitions(partitions, candidateSnapshot, storedDecisions);

  logger.info(`Generated ${partitions.length} partitions`);

  return {
    partitions,
    outputPath: outputDir,
    indexFilePath: path.join(outputDir, '_index.json'),
    incremental: !forceMode,
    updateType: forceMode ? 'force' : incrementalCheck.updateType,
  };
}

/**
 * 为决策查找对应的 partitionId
 */
function findPartitionIdForDecision(
  partitions: DomainPartition[],
  decision: DomainMergeDecision,
  candidates: PartitionCandidate[]
): string {
  // 查找决策中第一个候选对应的分区
  const firstCandidateId = decision.mergeGroup[0];
  const candidate = candidates.find(c => c.candidateId === firstCandidateId);
  if (!candidate) return '';

  // 根据 anchorTable 查找分区
  const partition = partitions.find(p =>
    p.tables.some(t => t.role === 'primary' && t.tableName === candidate.anchorTable)
  );
  return partition?.partitionId ?? '';
}

/**
 * 执行精确文件更新
 * 对比新旧分区结构，精确更新文件
 */
async function performIncrementalFileUpdate(
  outputDir: string,
  previousIndex: PartitionIndex,
  newPartitions: DomainPartition[]
): Promise<void> {
  const previousPartitionIds = new Set(previousIndex.partitions.map(p => p.partitionId));
  const newPartitionIds = new Set(newPartitions.map(p => p.partitionId));

  // 找到需要删除的分区
  const toDelete = previousIndex.partitions.filter(p => !newPartitionIds.has(p.partitionId));
  for (const entry of toDelete) {
    logger.info(`Deleting removed partition file: ${entry.file}`);
    try {
      const filePath = path.join(outputDir, entry.file);
      await fs.unlink(filePath);
    } catch (err) {
      logger.warn(`Failed to delete ${entry.file}: ${err}`);
    }
  }
}

/**
 * 运行 LLM 语义分析
 */
async function runLLMAnalysis(
  repoPath: string,
  domainClusterInput: DomainClusterInput
): Promise<DomainMergeDecision[]> {
  try {
    // 创建工具集
    const tools = createDomainClusterTools(repoPath);
    logger.info(`Created ${tools.length} domain cluster tools`);

    // 创建 Agent Runtime
    const agent = createAgentRuntime({
      model: {
        id: 'domain-cluster-agent',
        model: LLM_DEFAULTS.model,
        baseUrl: LLM_DEFAULTS.baseUrl,
        apiKey: process.env[LLM_DEFAULTS.apiKeyEnv] ?? LLM_DEFAULTS.apiKey,
        maxTokens: 128_000,
      },
      workspacePath: repoPath,
      tools,
      enableSummarization: false,
      enableTodoList: false,
    });

    // 创建 DomainClusterAgent
    const clusterAgent = createDomainClusterAgentSync(repoPath, agent);

    // 执行分析
    const clusterResult = await clusterAgent.analyze(domainClusterInput);

    if (!clusterResult.success) {
      logger.error(`LLM analysis failed: ${clusterResult.error}`);
      return [];
    }

    logger.info(`LLM analysis completed in ${clusterResult.executionTimeMs}ms`);

    return clusterResult.decisions;
  } catch (err) {
    logger.error('LLM analysis error:', err);
    return [];
  }
}

/**
 * 运行静态聚合（fallback）
 */
function runStaticAggregation(traceResults: TraceResult[]): DomainPartition[] {
  const aggregator = createPartitionAggregator();
  return aggregator.aggregate(traceResults);
}

/**
 * 为 Partition 添加 fileHashes 和 lastCommitHash
 */
async function enrichPartitionsWithHashes(partitions: DomainPartition[], repoPath: string): Promise<void> {
  // 获取 lastCommitHash
  const lastCommitHash = getCurrentCommit(repoPath);
  for (const partition of partitions) {
    partition.lastCommitHash = lastCommitHash;
  }

  // 计算 fileHashes
  for (const partition of partitions) {
    const backendHashes: Record<string, string> = {};

    // 收集所有相关文件路径
    const filePaths = [
      ...partition.entryPoints.map(ep => ep.filePath),
      ...(partition.sharedResources?.coreLogic?.map(s => s.filePath) ?? []),
      ...(partition.sharedResources?.dataLayer?.map(m => m.filePath) ?? []),
      ...(partition.sharedResources?.entities?.map(e => e.filePath) ?? []),
    ];

    for (const filePath of filePaths) {
      try {
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.join(repoPath, filePath);

        const content = await fs.readFile(absolutePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        backendHashes[filePath] = `sha256:${hash}`;
      } catch {
        // 文件可能不存在，跳过
      }
    }

    partition.fileHashes = { backend: backendHashes };
  }
}

/**
 * 创建 DomainPartitioner 实例（工厂函数）
 */
export function createDomainPartitioner(): {
  run: (config: PartitionConfig) => Promise<PartitionResult>;
} {
  return {
    run: runDomainPartitioning,
  };
}