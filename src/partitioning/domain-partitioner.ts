/**
 * DomainPartitioner 主入口
 *
 * 协调流程：
 * 1. 加载模块拓扑（modules.json）
 * 2. 初始化图数据库连接
 * 3. 发现入口点（Controller, Scheduled, MQ Consumer）
 * 4. 追溯每个入口点的调用链
 * 5. 收集表锚点
 * 6. 构建 PartitionCandidate
 * 7. 增量更新判断（对比上次快照）
 * 8. LLM 语义分析（可选）
 * 9. 聚合 Partition
 * 10. 计算 fileHashes 和 lastCommitHash
 * 11. 精确文件更新
 * 12. 写入 JSON 文件（包含候选快照和 LLM 决策）
 */

import { getStoragePaths, loadMeta } from "../engine/storage/repo-manager.js";
import { withReadOnlyLbug } from "../engine/lbug/read-only-session.js";
import { createTraceChainBuilder } from "./trace-chain-builder.js";
import {
  createPartitionAggregator,
  aggregateWithLLMDecisions,
} from "./partition-aggregator.js";
import { createPartitionWriter } from "./partition-writer.js";
import { createTableAnchorCollector } from "./table-anchor-collector.js";
import { createCandidateBuilder } from "./candidate-builder.js";
import { runModule, loadModuleTopology } from "../module/index.js";
import type { ModuleTopology } from "../module/index.js";
import {
  classifyRepository,
  loadProjectContext,
  refinePartitionModeWithTopology,
  saveProjectContext,
  type RepositoryClassificationContext,
} from "../project-classification/index.js";
import type {
  DomainPartition,
  PartitionConfig,
  TraceResult,
  MapperInfo,
  DomainClusterInput,
  DomainDefinition,
  PartitionIndex,
  CandidateSnapshot,
  StoredLlmDecision,
  IncrementalUpdateResult,
  PartitionCandidate,
  CommitHistoryInfo,
  CommitInfo,
} from "./types.js";
import {
  findGitRootByDotGit,
  getCurrentCommit,
} from "../engine/storage/git.js";
import { logger } from "../shared/logger.js";
import { createHash } from "crypto";
import { LLM_DEFAULTS } from "../config/defaults.js";
import { createOpenAiClient } from "../generation/llm-client.js";
import { createOpenAiClaimsProvider } from "../generation/llm-provider-factory.js";
import { buildCapabilityPartitions } from "./capability-partitioner.js";
import { runBusinessDomainPartition } from "../partition/business-domain/index.js";
import fs from "fs/promises";
import path from "path";

/**
 * DomainPartitioner 运行结果
 */
export interface PartitionResult {
  partitions: DomainPartition[];
  outputPath: string;
  indexFilePath: string;
  partitionMode?: string;
  /** 是否执行了增量更新 */
  incremental?: boolean;
  /** 更新类型 */
  updateType?: "none" | "content_change" | "structure_change" | "force";
}

/**
 * 检查增量更新
 * 对比当前候选与上次快照，判断是否需要重新分析
 */
function checkIncrementalUpdate(
  candidates: PartitionCandidate[],
  candidateBuilder: ReturnType<typeof createCandidateBuilder>,
  previousIndex?: PartitionIndex,
): IncrementalUpdateResult {
  // 如果没有上次索引，需要完全重新分析
  if (!previousIndex?.candidateSnapshot) {
    return {
      needsReanalysis: true,
      updateType: "structure_change",
      changedCandidateIds: [],
      addedCandidateIds: candidates.map((c) => c.candidateId),
      removedCandidateIds: [],
      reusableDecisions: [],
    };
  }

  const previousSnapshot = previousIndex.candidateSnapshot;
  const previousCandidates = previousSnapshot.candidates;

  // 构建候选 ID 映射
  const previousIdMap = new Map(
    previousCandidates.map((c) => [c.candidateId, c]),
  );
  const currentIdMap = new Map(candidates.map((c) => [c.candidateId, c]));

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
      const currentHash =
        candidateBuilder.computeCandidateContentHash(candidate);
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
  let updateType: "none" | "content_change" | "structure_change";
  let needsReanalysis: boolean;

  if (
    addedCandidateIds.length === 0 &&
    removedCandidateIds.length === 0 &&
    changedCandidateIds.length === 0
  ) {
    // 无变化
    updateType = "none";
    needsReanalysis = false;
  } else if (addedCandidateIds.length > 0 || removedCandidateIds.length > 0) {
    // 结构变化（新增或删除候选）
    updateType = "structure_change";
    needsReanalysis = true;
  } else {
    // 内容变化（候选内容改变）
    updateType = "content_change";
    needsReanalysis = true;
  }

  // 提取可复用的 LLM 决策（未变化候选）
  const reusableDecisions: StoredLlmDecision[] = [];
  if (previousIndex.llmDecisions && updateType === "content_change") {
    // 只有内容变化时，部分决策可复用
    for (const decision of previousIndex.llmDecisions) {
      const decisionCandidateIds =
        "coreCandidateIds" in decision
          ? [...decision.coreCandidateIds, ...decision.supportingCandidateIds]
          : [];
      // 检查决策中所有候选是否都未变化
      const allUnchanged = decisionCandidateIds.every(
        (cid) =>
          !changedCandidateIds.includes(cid) &&
          !removedCandidateIds.includes(cid),
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
async function loadPreviousIndex(
  outputDir: string,
): Promise<PartitionIndex | undefined> {
  const indexPath = path.join(outputDir, "_index.json");
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(content) as PartitionIndex;
  } catch {
    return undefined;
  }
}

/**
 * 收集候选的 Git commit 历史
 * 用于辅助 LLM 分析业务语义
 */
async function collectCommitHistory(
  repoPath: string,
  candidates: PartitionCandidate[],
): Promise<CommitHistoryInfo | undefined> {
  const candidateCommits = new Map<string, CommitInfo[]>();

  try {
    for (const candidate of candidates) {
      const commits = await collectCandidateCommits(repoPath, candidate);

      if (commits.length > 0) {
        candidateCommits.set(
          candidate.candidateId,
          summarizeCandidateCommits(commits),
        );
      }
    }

    if (candidateCommits.size > 0) {
      logger.info(
        `Collected commit history for ${candidateCommits.size} candidates`,
      );
    }

    return { candidateCommits };
  } catch (err) {
    logger.warn(`Failed to collect commit history: ${err}`);
    return undefined;
  }
}

function summarizeCandidateCommits(commits: CommitInfo[]): CommitInfo[] {
  const highSignalCommits = commits.filter((commit) =>
    isHighSignalCommitMessage(commit.message),
  );
  const selected = highSignalCommits.length > 0 ? highSignalCommits : commits;
  return selected.slice(0, 8);
}

function isHighSignalCommitMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized === "fix bug" ||
    normalized === "update" ||
    normalized === "merge" ||
    normalized.includes("merge remote-tracking branch")
  ) {
    return false;
  }

  return HIGH_SIGNAL_COMMIT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

const HIGH_SIGNAL_COMMIT_PATTERNS = [
  /\badd(ed|ing)?\b/,
  /\bfix(ed|ing)?\b/,
  /\brefactor(ed|ing)?\b/,
  /\bimplement(ed|ing)?\b/,
  /\bsupport(ed|ing)?\b/,
  /\bfeature\b/,
  /\bmodule\b/,
  /新增/,
  /修复/,
  /重构/,
  /支持/,
  /实现/,
  /功能/,
  /模块/,
];

async function collectCandidateCommits(
  repoPath: string,
  candidate: PartitionCandidate,
): Promise<CommitInfo[]> {
  const groupedFilePaths = new Map<string, string[]>();

  for (const entryPoint of candidate.entryPoints) {
    const absolutePath = path.join(repoPath, entryPoint.filePath);
    const gitRoot = findGitRootByDotGit(absolutePath);
    if (!gitRoot) {
      continue;
    }

    const relativePath = path.relative(gitRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    const group = groupedFilePaths.get(gitRoot) ?? [];
    group.push(relativePath);
    groupedFilePaths.set(gitRoot, group);
  }

  const commits: CommitInfo[] = [];
  const seenHashes = new Set<string>();

  for (const [gitRoot, filePaths] of groupedFilePaths.entries()) {
    if (filePaths.length === 0) {
      continue;
    }

    const result = await runGitLogCommand(gitRoot, filePaths);
    for (const line of result.split("\n").filter((item) => item.trim())) {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      if (!match || seenHashes.has(match[1])) {
        continue;
      }

      seenHashes.add(match[1]);
      commits.push({
        hash: match[1],
        message: match[2],
      });
    }
  }

  return commits;
}

async function runGitLogCommand(
  gitRoot: string,
  filePaths: string[],
): Promise<string> {
  const { execa } = await import("execa");
  const result = await execa(
    "git",
    ["log", "--oneline", "-20", "--", ...filePaths],
    {
      cwd: gitRoot,
      windowsVerbatimArguments: false,
    },
  );
  return result.stdout;
}

/**
 * 运行 Domain Partitioning
 */
export async function runDomainPartitioning(
  config: PartitionConfig,
): Promise<PartitionResult> {
  const repoPath = config.repoPath;
  const { lbugPath, storagePath } = getStoragePaths(repoPath);
  const enableLLMAnalysis = config.enableLLMAnalysis ?? true;
  const forceMode = config.force ?? false;
  const concurrency = Math.max(1, Math.floor(config.concurrency ?? 1));

  logger.info(`Starting domain partitioning for: ${repoPath}`);
  logger.info(
    `LLM analysis enabled: ${enableLLMAnalysis}, Force mode: ${forceMode}`,
  );

  const repositoryContext = await loadOrClassifyRepositoryContext(repoPath);
  logger.info(
    `Partition mode resolved: ${repositoryContext.partitionMode} (${repositoryContext.partitionModeConfidence})`,
  );

  // ========== 加载模块拓扑（复用 modules.json） ==========
  let moduleTopology: ModuleTopology | null = null;

  // 尝试加载已有的 modules.json
  moduleTopology = await loadModuleTopology(repoPath);

  if (!moduleTopology) {
    logger.info("No modules.json found, running module division...");
    const moduleResult = await runModule({
      repoPath,
      force: false, // 不强制重新分析
    });
    moduleTopology = moduleResult.topology;
    logger.info(
      `Module division completed: ${moduleTopology.moduleCount} modules, ${moduleTopology.couplingMode}`,
    );
  } else {
    logger.info(
      `Using existing module topology: ${moduleTopology.moduleCount} modules, ${moduleTopology.couplingMode}`,
    );
  }

  const refinedPartitionMode = refinePartitionModeWithTopology(
    {
      partitionMode: repositoryContext.partitionMode,
      confidence: repositoryContext.partitionModeConfidence,
      evidence: repositoryContext.partitionModeEvidence,
    },
    moduleTopology,
  );
  if (refinedPartitionMode.partitionMode !== repositoryContext.partitionMode) {
    repositoryContext.partitionMode = refinedPartitionMode.partitionMode;
    repositoryContext.partitionModeConfidence = refinedPartitionMode.confidence;
    repositoryContext.partitionModeEvidence = refinedPartitionMode.evidence;
    await saveProjectContext(repositoryContext, repoPath);
    logger.info(
      `Partition mode refined by module topology: ${repositoryContext.partitionMode} (${repositoryContext.partitionModeConfidence})`,
    );
  }

  // 确保图数据库索引存在
  const meta = await loadMeta(storagePath);
  if (!meta) {
    logger.error("No analysis index found. Run `rkg init` first.");
    throw new Error("No analysis index found. Run `rkg init` first.");
  }

  // 检查 lbug 文件是否存在
  try {
    await fs.stat(lbugPath);
  } catch {
    logger.error("No graph database found. Run `rkg init` first.");
    throw new Error("No graph database found. Run `rkg init` first.");
  }

  // 输出目录
  const outputDir = path.join(storagePath, "partitions");
  const writer = createPartitionWriter(outputDir);

  // Force 模式：清理整个输出目录
  if (forceMode) {
    logger.info("Force mode: cleaning output directory");
    await writer.cleanOutputDir();
  }

  // 加载上次索引（用于增量更新判断）
  const previousIndex = forceMode
    ? undefined
    : await loadPreviousIndex(outputDir);

  if (repositoryContext.partitionMode === "capability-domain") {
    const partitions = buildCapabilityPartitions({
      repoPath,
      moduleTopology: moduleTopology!,
    });
    logger.info("Using capability-domain partitioning");
    await enrichPartitionsWithHashes(partitions, repoPath);
    await writer.writeAllPartitions(
      partitions,
      undefined,
      undefined,
      repositoryContext.partitionMode,
    );

    return {
      partitions,
      outputPath: outputDir,
      indexFilePath: path.join(outputDir, "_index.json"),
      partitionMode: repositoryContext.partitionMode,
      incremental: !forceMode,
      updateType: forceMode ? "force" : "structure_change",
    };
  }

  // 使用 withReadOnlyLbug 执行追溯
  const traceResults = await withReadOnlyLbug(lbugPath, async (query) => {
    // 创建 TraceChainBuilder，传入模块拓扑
    const traceBuilder = createTraceChainBuilder(
      query,
      repoPath,
      moduleTopology!,
    );
    const tableCollector = createTableAnchorCollector(query, repoPath);

    // 1. 发现入口点
    logger.info("Discovering entry points...");
    const entryPoints = await traceBuilder.discoverEntryPoints();
    logger.info(`Found ${entryPoints.length} entry points`);

    // 2. 追溯每个入口点
    logger.info("Tracing entry points...");
    const traceResults: TraceResult[] = [];

    for (const entryPoint of entryPoints) {
      try {
        const traceResult = await traceBuilder.traceEntryPoint(entryPoint);
        traceResults.push(traceResult);
        logger.debug(
          `Traced ${entryPoint.className}: ${traceResult.tables.length} tables, ${traceResult.mappers.length} mappers`,
        );
      } catch (err) {
        logger.warn(`Failed to trace ${entryPoint.className}: ${err}`);
      }
    }

    // 3. 收集所有 Mapper 信息
    const allMappers: MapperInfo[] = [];
    for (const result of traceResults) {
      for (const mapper of result.mappers) {
        if (!allMappers.some((m) => m.className === mapper.className)) {
          allMappers.push(mapper);
        }
      }
    }

    // 4. 分析表的外键关系
    logger.info("Analyzing foreign keys...");
    const allTables = traceResults.flatMap((r) => r.tables);
    const allEntities = traceResults.flatMap((r) => r.entities);
    const enrichedTables = await tableCollector.analyzeForeignKeys(
      allTables,
      allEntities,
    );

    // 更新 traceResults 的表信息
    for (const result of traceResults) {
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

    return traceResults;
  });

  // 5. 构建候选
  logger.info("Building candidates...");
  const candidateBuilder = createCandidateBuilder();
  const domainClusterInput = candidateBuilder.buildDomainClusterInput(
    traceResults,
    repoPath,
  );

  // 5.1 收集 Git commit 历史（辅助分析）
  if (enableLLMAnalysis) {
    const commitHistory = await collectCommitHistory(
      repoPath,
      domainClusterInput.candidates,
    );
    if (commitHistory) {
      domainClusterInput.commitHistory = commitHistory;
    }
  }

  // 6. 增量更新判断
  const incrementalCheck = checkIncrementalUpdate(
    domainClusterInput.candidates,
    candidateBuilder,
    previousIndex,
  );

  logger.info(
    `Incremental check: type=${incrementalCheck.updateType}, needsReanalysis=${incrementalCheck.needsReanalysis}`,
  );
  if (incrementalCheck.changedCandidateIds.length > 0) {
    logger.info(
      `Changed candidates: ${incrementalCheck.changedCandidateIds.join(", ")}`,
    );
  }
  if (incrementalCheck.addedCandidateIds.length > 0) {
    logger.info(
      `Added candidates: ${incrementalCheck.addedCandidateIds.join(", ")}`,
    );
  }
  if (incrementalCheck.removedCandidateIds.length > 0) {
    logger.info(
      `Removed candidates: ${incrementalCheck.removedCandidateIds.join(", ")}`,
    );
  }

  // 如果无变化，直接返回上次分区
  if (!incrementalCheck.needsReanalysis && previousIndex) {
    logger.info("No changes detected, reusing previous partitions");

    // 加载上次分区文件
    const partitions: DomainPartition[] = [];
    for (const entry of previousIndex.partitions) {
      const filePath = path.join(outputDir, entry.file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        partitions.push(JSON.parse(content) as DomainPartition);
      } catch (err) {
        logger.warn(`Failed to load partition file ${entry.file}: ${err}`);
      }
    }

    return {
      partitions,
      outputPath: outputDir,
      indexFilePath: path.join(outputDir, "_index.json"),
      partitionMode: repositoryContext.partitionMode,
      incremental: true,
      updateType: "none",
    };
  }

  // 7. LLM 语义分析（可选）
  let partitions: DomainPartition[];
  let llmDecisions: DomainDefinition[] = [];
  let storedDecisions: StoredLlmDecision[] = [];
  let partitionEvidenceBundle:
    | import("../domain-analysis/types.js").DomainEvidenceBundle
    | undefined;

  if (enableLLMAnalysis && domainClusterInput.candidates.length > 1) {
    logger.info("Running LLM semantic analysis...");

    // 如果有可复用的决策，传入作为参考
    if (incrementalCheck.reusableDecisions.length > 0) {
      logger.info(
        `Using ${incrementalCheck.reusableDecisions.length} reusable decisions as reference`,
      );
    }

    const llmResult = await runBusinessDomainAnalysis(
      repoPath,
      domainClusterInput,
      concurrency,
    );
    llmDecisions = llmResult.decisions;
    partitionEvidenceBundle = llmResult.evidenceBundle;

    if (llmDecisions.length > 0) {
      logger.info(`LLM returned ${llmDecisions.length} decisions`);
      partitions = aggregateWithLLMDecisions(
        domainClusterInput.candidates,
        llmDecisions,
      );
      if (llmResult.refsByPartitionId) {
        applyCrossDomainRefs(partitions, llmResult.refsByPartitionId);
      }

      // 转换为存储格式
      storedDecisions = llmDecisions.map((d) => ({
        coreCandidateIds: d.coreCandidateIds,
        supportingCandidateIds: d.supportingCandidateIds,
        domainName: d.domainName,
        partitionId: findPartitionIdForDecision(
          partitions,
          d,
          domainClusterInput.candidates,
        ),
        confidence: d.confidence,
        reasoning: d.reasoning,
      }));
    } else {
      logger.warn("LLM analysis failed, falling back to static aggregation");
      partitions = runStaticAggregation(
        traceResults,
        domainClusterInput.candidates,
      );
    }
  } else {
    logger.info("Using static aggregation (LLM disabled or only 1 candidate)");
    partitions = runStaticAggregation(
      traceResults,
      domainClusterInput.candidates,
    );
  }

  // 8. 计算 fileHashes 和 lastCommitHash
  logger.info("Computing hashes...");
  await enrichPartitionsWithHashes(partitions, repoPath);

  // 9. 构建候选快照
  const candidateSnapshot = candidateBuilder.buildCandidateSnapshot(
    domainClusterInput.candidates,
    repoPath,
  );

  // 10. 精确文件更新（非 force 模式）
  if (!forceMode && previousIndex) {
    await performIncrementalFileUpdate(outputDir, previousIndex, partitions);
  }

  // 11. 写入 JSON 文件（包含快照和决策）
  logger.info(`Writing partitions to: ${outputDir}`);
  await writer.writeAllPartitions(
    partitions,
    candidateSnapshot,
    storedDecisions,
    repositoryContext.partitionMode,
  );

  logger.info(`Generated ${partitions.length} partitions`);

  return {
    partitions,
    outputPath: outputDir,
    indexFilePath: path.join(outputDir, "_index.json"),
    partitionMode: repositoryContext.partitionMode,
    incremental: !forceMode,
    updateType: forceMode ? "force" : incrementalCheck.updateType,
  };
}

async function loadOrClassifyRepositoryContext(
  repoPath: string,
): Promise<RepositoryClassificationContext> {
  const existingContext = await loadProjectContext(repoPath);
  if (existingContext) {
    return existingContext;
  }

  const llmTimeoutMs = LLM_DEFAULTS.timeoutSeconds * 1000;
  const client = createOpenAiClient({
    model: LLM_DEFAULTS.model,
    baseUrl: LLM_DEFAULTS.baseUrl,
    apiKey: process.env[LLM_DEFAULTS.apiKeyEnv] ?? LLM_DEFAULTS.apiKey,
    concurrency: 1,
    timeoutMs: llmTimeoutMs,
    maxRetries: LLM_DEFAULTS.maxRetries,
  });
  const claimsProvider = createOpenAiClaimsProvider(client, LLM_DEFAULTS.model);
  const context = await classifyRepository(
    repoPath,
    claimsProvider,
    llmTimeoutMs,
  );
  await saveProjectContext(context, repoPath);
  return context;
}

/**
 * 为决策查找对应的 partitionId
 */
function findPartitionIdForDecision(
  partitions: DomainPartition[],
  decision: DomainDefinition,
  candidates: PartitionCandidate[],
): string {
  const includedCandidateIds = [
    ...decision.coreCandidateIds,
    ...decision.supportingCandidateIds,
  ];
  const decisionTableSet = new Set([
    ...decision.coreTables,
    ...decision.supportingTables,
  ]);
  const decisionAnchorSet = new Set(
    includedCandidateIds
      .map((candidateId) =>
        candidates.find((candidate) => candidate.candidateId === candidateId),
      )
      .filter((candidate): candidate is PartitionCandidate =>
        Boolean(candidate),
      )
      .map((candidate) => candidate.anchorTable),
  );

  const exactCandidateMatch = partitions.find((partition) => {
    const partitionAnchorSet = new Set(
      partition.tables
        .filter((table) => table.role === "primary")
        .map((table) => table.tableName),
    );

    return (
      partitionAnchorSet.size === decisionAnchorSet.size &&
      [...decisionAnchorSet].every((anchorTable) =>
        partitionAnchorSet.has(anchorTable),
      )
    );
  });
  if (exactCandidateMatch) {
    return exactCandidateMatch.partitionId;
  }

  const matched = [...partitions]
    .map((partition) => {
      const partitionTableSet = new Set(
        partition.tables.map((table) => table.tableName),
      );
      const exactCoreMatch = decision.coreTables.every((tableName) =>
        partitionTableSet.has(tableName),
      );
      const tableOverlap = [...decisionTableSet].filter((tableName) =>
        partitionTableSet.has(tableName),
      ).length;
      const anchorOverlap = [...decisionAnchorSet].filter((anchorTable) =>
        partitionTableSet.has(anchorTable),
      ).length;

      return {
        partition,
        score:
          (exactCoreMatch ? 100 : 0) +
          anchorOverlap * 10 +
          tableOverlap * 3 -
          Math.abs(partitionTableSet.size - decisionTableSet.size),
      };
    })
    .sort((left, right) => right.score - left.score)[0];

  return matched && matched.score > 0 ? matched.partition.partitionId : "";
}

/**
 * 执行精确文件更新
 * 对比新旧分区结构，精确更新文件
 */
async function performIncrementalFileUpdate(
  outputDir: string,
  previousIndex: PartitionIndex,
  newPartitions: DomainPartition[],
): Promise<void> {
  const previousPartitionIds = new Set(
    previousIndex.partitions.map((p) => p.partitionId),
  );
  const newPartitionIds = new Set(newPartitions.map((p) => p.partitionId));

  // 找到需要删除的分区
  const toDelete = previousIndex.partitions.filter(
    (p) => !newPartitionIds.has(p.partitionId),
  );
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
async function runBusinessDomainAnalysis(
  repoPath: string,
  domainClusterInput: DomainClusterInput,
  concurrency: number,
): Promise<
  import("../partition/business-domain/types.js").BusinessDomainPartitionResult
> {
  try {
    const result = await runBusinessDomainPartition({
      repoPath,
      clusterInput: domainClusterInput,
      analysisContext: {
        repoPath,
        projectContext: domainClusterInput.projectContext,
        commitHistory: domainClusterInput.commitHistory,
      },
      concurrency,
      materializePartitions: (decisions) =>
        aggregateWithLLMDecisions(domainClusterInput.candidates, decisions),
    });
    if (!result.success) {
      logger.error(`LLM analysis failed: ${result.error}`);
      return result;
    }

    logger.info(`LLM analysis completed in ${result.executionTimeMs}ms`);

    return result;
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`LLM analysis error: ${err.stack ?? err.message}`);
    } else {
      logger.error("LLM analysis error:", err);
    }
    return {
      decisions: [],
      success: false,
      error: String(err),
    };
  }
}

function applyCrossDomainRefs(
  partitions: DomainPartition[],
  refsByPartitionId: Record<string, DomainPartition["crossDomainRefs"]>,
): void {
  for (const partition of partitions) {
    const refs = refsByPartitionId[partition.partitionId];
    if (refs && refs.length > 0) {
      partition.crossDomainRefs = refs;
    }
  }
}

/**
 * 运行静态聚合（fallback）
 */
function runStaticAggregation(
  traceResults: TraceResult[],
  candidates: PartitionCandidate[],
): DomainPartition[] {
  const aggregator = createPartitionAggregator();
  return candidates.length > 0
    ? aggregator.aggregateCandidates(candidates)
    : aggregator.aggregate(traceResults);
}

/**
 * 为 Partition 添加 fileHashes 和 lastCommitHash
 */
async function enrichPartitionsWithHashes(
  partitions: DomainPartition[],
  repoPath: string,
): Promise<void> {
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
      ...partition.entryPoints.map((ep) => ep.filePath),
      ...(partition.sharedResources?.coreLogic?.map((s) => s.filePath) ?? []),
      ...(partition.sharedResources?.dataLayer?.map((m) => m.filePath) ?? []),
      ...(partition.sharedResources?.entities?.map((e) => e.filePath) ?? []),
    ];

    for (const filePath of filePaths) {
      try {
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.join(repoPath, filePath);

        const content = await fs.readFile(absolutePath, "utf-8");
        const hash = createHash("sha256")
          .update(content)
          .digest("hex")
          .slice(0, 16);
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
