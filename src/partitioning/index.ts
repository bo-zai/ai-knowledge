/**
 * DomainPartitioning 模块导出
 *
 * 独立的 Domain Partition 划分逻辑，与 Concept 生成解耦。
 * 输出精简的 DomainPartition JSON 文件到 .internal/partitions/
 */

// 类型定义
export type {
  DomainPartition,
  PartitionIndex,
  PartitionIndexEntry,
  TableInfo,
  TableRole,
  TableType,
  JunctionBetween,
  EntryPoint,
  EntryPointKind,
  ClientType,
  CallChainNode,
  CallChainRole,
  MapperInfo,
  ServiceInfo,
  EntityInfo,
  EntityRole,
  SharedResources,
  BackendModule,
  BackendModuleRole,
  FrontendFramework,
  FrontendPage,
  FrontendModule,
  FrontendInfo,
  FrontendBackendLink,
  LinkType,
  NoEntryTable,
  NoEntryTableType,
  CrossDomainRef,
  CrossDomainRelationType,
  ConfidenceBreakdown,
  FileHashes,
  TraceResult,
  PartitionConfig,
  CrossDomainCall,
  // LLM 语义分析相关类型
  PartitionCandidate,
  CandidateRelation,
  CandidateGroup,
  ProjectContext,
  DomainClusterInput,
  DomainMergeDecision,
  DomainMergeEvidence,
  DomainClusterResult,
  // 增量更新相关类型
  CandidateSnapshotEntry,
  CandidateSnapshot,
  StoredLlmDecision,
  IncrementalUpdateResult,
} from './types.js';

// 核心组件
export { TraceChainBuilder, createTraceChainBuilder } from './trace-chain-builder.js';
export { TableAnchorCollector, createTableAnchorCollector } from './table-anchor-collector.js';
export { PartitionAggregator, createPartitionAggregator, aggregateWithLLMDecisions } from './partition-aggregator.js';
export { PartitionWriter, createPartitionWriter } from './partition-writer.js';

// LLM 语义分析组件
export { DomainClusterAgent, createDomainClusterAgent, createDomainClusterAgentSync } from './domain-cluster-agent.js';
export { CandidateBuilder, createCandidateBuilder } from './candidate-builder.js';
export { createCandidateValidator, runValidation, runBatchValidation, type ValidationConfig, type ValidationResult } from './candidate-validator.js';

// 主入口
export { runDomainPartitioning, createDomainPartitioner } from './domain-partitioner.js';
export type { PartitionResult } from './domain-partitioner.js';