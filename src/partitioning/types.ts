/**
 * DomainPartition 类型定义
 *
 * 参考 design/domain-partition-schema.json 精简结构
 */

// ========== 表信息 ==========

export type TableRole =
  | "primary"
  | "related"
  | "shard"
  | "junction_table"
  | "view_reference"
  | "config_table";
export type TableType = "table" | "view";

export interface JunctionBetween {
  leftTable: string;
  rightTable: string;
  leftKey: string;
  rightKey: string;
}

export interface TableInfo {
  tableName: string;
  role: TableRole;
  tableType?: TableType;
  schema?: string;
  relationType?: string;
  foreignKey?: string;
  shardGroup?: string;
  junctionBetween?: JunctionBetween;
  baseTables?: string[];
}

// ========== 跨域调用 ==========

export interface CrossDomainCall {
  targetDomain: string;
  className: string;
  methodName: string;
  callPurpose?: string;
}

// ========== 调用链节点 ==========

export type CallChainRole = "core_logic" | "data_layer" | "cross_domain_call";

export interface CallChainNode {
  className: string;
  interfaceName?: string;
  implementationType?: "impl" | "abstract" | "delegate";
  filePath: string;
  role: CallChainRole;
  crossDomainHint?: string;
}

// ========== 入口点 ==========

export type EntryPointKind = "controller" | "scheduled" | "mq_consumer";
export type ClientType = "web" | "app" | "admin" | "api";

export interface EntryPoint {
  kind: EntryPointKind;
  clientType?: ClientType;
  className: string;
  methodName: string;
  filePath: string;
  startLine: number;
  signature?: string;
  module: string;
  callChain: CallChainNode[];
  crossDomainCalls?: CrossDomainCall[];
  noServiceLayer?: boolean;
  mqType?: string;
  mqTopic?: string;
}

// ========== 共享资源 ==========

export type EntityRole = "canonical" | "dto" | "vo" | "po" | "do";

export interface ServiceInfo {
  className: string;
  interfaceName?: string;
  implementationType?: string;
  filePath: string;
  module: string;
  polymorphismGroup?: string;
  calledMethodNames?: string[];
}

export interface MapperInfo {
  className: string;
  filePath: string;
  xmlPath?: string;
  module: string;
  tablesOperated?: string[];
  calledMethodNames?: string[];
  operations?: ("select" | "insert" | "update" | "delete")[];
}

export interface EntityInfo {
  className: string;
  filePath: string;
  module: string;
  tablesMapped?: string[];
  entityRole?: EntityRole;
}

export interface SharedResources {
  coreLogic?: ServiceInfo[];
  dataLayer?: MapperInfo[];
  entities?: EntityInfo[];
}

// ========== 后端模块 ==========

export type BackendModuleRole =
  | "entry_and_logic_provider"
  | "entry_provider"
  | "logic_provider"
  | "data_provider";

export interface BackendModule {
  name: string;
  path: string;
  role: BackendModuleRole;
}

// ========== 前端 ==========

export type FrontendFramework = "vue" | "react" | "angular" | "svelte";

export interface FrontendApiCall {
  backendApiId: string;
}

export interface FrontendPage {
  pageName: string;
  filePath: string;
  module: string;
  apiCalls?: FrontendApiCall[];
}

export interface FrontendModule {
  name: string;
  path: string;
  framework: FrontendFramework;
}

export interface FrontendInfo {
  pages?: FrontendPage[];
  modules?: FrontendModule[];
}

// ========== 前后端关联 ==========

export type LinkType = "page_to_api";

export interface FrontendBackendLink {
  frontendPageName: string;
  frontendModule: string;
  backendApiIds: string[];
  linkType: LinkType;
}

// ========== 无入口点表 ==========

export type NoEntryTableType = "config_table" | "dict_table" | "system_table";

export interface NoEntryTable {
  tableName: string;
  tableType: NoEntryTableType;
  suggestedDomain?: string;
}

// ========== 跨域引用 ==========

export type CrossDomainRelationType =
  | "service_call"
  | "frontend_component"
  | "shared_table"
  | "shared_table_reference"
  | "aggregate_dependency"
  | "junction_dependency"
  | "weak_identity_reference";

export interface CrossDomainRef {
  targetDomain: string;
  relationType: CrossDomainRelationType;
  evidence?: string[];
}

// ========== 置信度 ==========

export interface ConfidenceBreakdown {
  traceDepth: number;
  crossModule?: number;
  multiEntryPoint?: number;
  tableRelation?: number;
  /** LLM 分析置信度（0-1） */
  llmConfidence?: number;
}

// ========== 文件 Hash ==========

export interface FileHashes {
  backend?: Record<string, string>;
  frontend?: Record<string, string>;
}

// ========== DomainPartition 主结构 ==========

export interface DomainPartition {
  partitionId: string;
  partitionHash: string;
  algorithmVersion: string;

  tables: TableInfo[];
  entryPoints: EntryPoint[];
  sharedResources?: SharedResources;
  backendModules: BackendModule[];

  frontend?: FrontendInfo;
  frontendBackendLinks?: FrontendBackendLink[];

  noEntryTables?: NoEntryTable[];

  confidenceBreakdown: ConfidenceBreakdown;
  crossDomainRefs?: CrossDomainRef[];

  domainKeywords?: string[];

  contentHash: string;
  fileHashes?: FileHashes;
  lastCommitHash: string;
  updatedAt: string;
}

// ========== Partition 索引 ==========

export interface PartitionIndexEntry {
  partitionId: string;
  file: string;
  anchorTable: string;
  tableCount: number;
  entryPointCount: number;
  isCrossModule: boolean;
}

export interface PartitionIndex {
  version: string;
  algorithmVersion: string;
  updatedAt: string;
  partitionMode?: string;
  /** 候选快照（用于增量更新） */
  candidateSnapshot?: CandidateSnapshot;
  /** 存储的 LLM 决策（用于增量更新参考） */
  llmDecisions?: StoredLlmDecision[];
  partitions: PartitionIndexEntry[];
  stats: {
    totalPartitions: number;
    crossModuleCount: number;
    backendEntryPointCount: number;
  };
  gitInfo?: {
    lastCommitHash: string;
    lastCommitDate: string;
    repoPath: string;
  };
}

// ========== 追溯结果（内部使用） ==========

export interface TraceResult {
  entryPoint: EntryPoint;
  tables: TableInfo[];
  mappers: MapperInfo[];
  services: ServiceInfo[];
  entities: EntityInfo[];
  crossDomainCalls: CrossDomainCall[];
}

// ========== 运行配置 ==========

export interface PartitionConfig {
  repoPath: string;
  modulePaths?: string[];
  force?: boolean;
  algorithmVersion?: string;
  /** 是否启用 LLM 语义分析（默认 true） */
  enableLLMAnalysis?: boolean;
  /** 并发度，仅对可并发的批量 LLM 任务生效，默认 1 */
  concurrency?: number;
}

// ========== LLM 语义分析相关类型 ==========

/**
 * PartitionCandidate - LLM 分析的候选分区
 */
export interface PartitionCandidate {
  candidateId: string;
  anchorTable: string;
  anchorQuality: "high" | "medium" | "low";
  isInfrastructureCandidate: boolean;
  isAggregatorCandidate: boolean;
  coreTableNames: string[];
  supportingTableNames: string[];
  ownedTableNames: string[];
  dependencyTableNames: string[];

  /** 入口点详情 */
  entryPoints: {
    kind: EntryPointKind;
    className: string;
    methodName: string;
    filePath: string;
    module: string;
    isAggregatorLike: boolean;
    /** Controller 的 API 信息（预提取） */
    apiInfo?: {
      basePath?: string;
      methods?: string[];
    };
    /** Scheduled 的定时信息 */
    scheduledInfo?: {
      cron?: string;
      description?: string;
    };
    /** MQ Consumer 的 Topic 信息 */
    mqInfo?: {
      mqType: string;
      topic?: string;
    };
  }[];

  /** 表详情 */
  tables: {
    tableName: string;
    role: TableRole;
    tableType?: TableType;
    /** 预提取的字段数量 */
    fieldCount?: number;
    /** 预提取的外键 */
    foreignKeys?: {
      columnName: string;
      referencesTable: string;
    }[];
  }[];

  /** Mapper 详情 */
  mappers: {
    className: string;
    filePath: string;
    xmlPath?: string;
    /** 预提取的 SQL 操作类型 */
    operations?: ("select" | "insert" | "update" | "delete")[];
    tablesOperated: string[];
  }[];

  /** Service 详情 */
  services: {
    className: string;
    filePath: string;
    /** 预提取的方法数量 */
    methodCount?: number;
  }[];

  /** 调用链摘要 */
  callChainSummary: {
    depth: number;
    pathCount: number;
  };

  evidence?: CandidateEvidence;
}

export type SchemaTableKind =
  | "business_entity"
  | "junction"
  | "extension"
  | "log"
  | "config"
  | "dict"
  | "unknown";

export type SchemaRelationType =
  | "explicit_fk"
  | "implicit_fk"
  | "aggregate_child"
  | "junction_table"
  | "extension_table"
  | "weak_reference"
  | "audit_or_log"
  | "config_or_dict";

export type SchemaRelationStrength = "strong" | "medium" | "weak";
export type SchemaRelationDirection = "outbound" | "bidirectional";

export interface SchemaTableNode {
  tableName: string;
  normalizedName: string;
  tableKind: SchemaTableKind;
  nameTokens: string[];
}

export interface SchemaTableEdge {
  sourceTable: string;
  targetTable: string;
  relationType: SchemaRelationType;
  strength: SchemaRelationStrength;
  direction: SchemaRelationDirection;
  evidence: string[];
}

export interface SchemaRelationGraph {
  tables: SchemaTableNode[];
  relations: SchemaTableEdge[];
}

export interface CandidateEvidence {
  candidateId: string;
  anchorTable: string;
  suggestedName: string;
  entryPointSummaries: string[];
  coreTables: string[];
  supportingTables: string[];
  ownedTables: string[];
  dependencyTables: string[];
  coreServices: string[];
  coreMappers: string[];
  internalRelations: SchemaTableEdge[];
  outboundRelations: SchemaTableEdge[];
  inboundRelations: SchemaTableEdge[];
  relatedCandidateIds: string[];
  businessTerms: string[];
  commitHighlights: string[];
}

export interface PartitionAnalysisEvidenceItem {
  candidateId: string;
  anchorTable: string;
  suggestedDomainName: string;
  entryPointSummaries: string[];
  coreTables: string[];
  supportingTables: string[];
  ownedTables: string[];
  dependencyTables: string[];
  relatedCandidateIds: string[];
  relatedRelationSummaries: string[];
  businessTerms: string[];
  commitHighlights: string[];
}

export interface PartitionAnalysisEvidence {
  candidateItems: PartitionAnalysisEvidenceItem[];
  schemaHighlights: string[];
  projectDocumentHighlights: string[];
}

/**
 * CandidateRelation - 候选之间的关系
 */
export interface CandidateRelation {
  candidateIdA: string;
  candidateIdB: string;
  /** 共享的表 */
  sharedTables: string[];
  /** 共享的核心表 */
  sharedCoreTables: string[];
  /** 共享的 Service */
  sharedServices: string[];
  /** 共享的 Mapper */
  sharedMappers: string[];
  /** 表之间的外键关系 */
  tableForeignKeyRelations: {
    fromTable: string;
    toTable: string;
    foreignKey: string;
  }[];
}

/**
 * CandidateGroup - 候选预分组
 */
export interface CandidateGroup {
  groupId: string;
  candidates: string[];
  /** 分组原因 */
  groupReason: string;
}

/**
 * ProjectContext - 项目上下文
 */
export interface ProjectContext {
  repoPath: string;
  moduleName?: string;
  moduleNames?: string[];
  /** 是否有领域文档 */
  hasDomainDocs?: boolean;
}

/**
 * DomainClusterInput - LLM Agent 输入
 */
export interface DomainClusterInput {
  /** 所有候选列表 */
  candidates: PartitionCandidate[];
  /** 候选之间的预计算关系 */
  candidateRelations: CandidateRelation[];
  /** 候选的分组提示 */
  candidateGroups: CandidateGroup[];
  /** 表关系图 */
  schemaRelationGraph: SchemaRelationGraph;
  /** 项目上下文 */
  projectContext: ProjectContext;
  /** Git commit 历史（可选，辅助分析） */
  commitHistory?: CommitHistoryInfo;
  /** 供 LLM 快速消费的精简证据 */
  analysisEvidence?: PartitionAnalysisEvidence;
}

/**
 * CommitHistoryInfo - Git commit 历史信息
 */
export interface CommitHistoryInfo {
  /** 每个候选的 commit 列表 */
  candidateCommits: Map<string, CommitInfo[]>;
}

/**
 * CommitInfo - 单个 commit 信息
 */
export interface CommitInfo {
  /** commit hash */
  hash: string;
  /** commit message（原始内容） */
  message: string;
  /** commit 日期 */
  date?: string;
  /** commit 作者 */
  author?: string;
}

/**
 * DomainMergeEvidence - 合并决策的证据
 */
export interface DomainDependencyDefinition {
  targetDomainHint: string;
  relationType: CrossDomainRelationType;
  evidence: string[];
}

export interface DomainDefinition {
  /** 业务域名称 */
  domainName: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 域内核心候选 */
  coreCandidateIds: string[];
  /** 域内支撑候选 */
  supportingCandidateIds: string[];
  /** 明确排除候选 */
  excludedCandidateIds: string[];
  /** 核心表 */
  coreTables: string[];
  /** 支撑表 */
  supportingTables: string[];
  /** 跨域依赖 */
  crossDomainDependencies: DomainDependencyDefinition[];
  /** 判断依据（人类可读） */
  reasoning: string;
}

/**
 * DomainClusterResult - LLM Agent 输出结果
 */
export interface DomainClusterResult {
  /** 所有合并决策 */
  decisions: DomainDefinition[];
  /** Agent 是否成功执行 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** Agent 使用的工具调用次数 */
  toolCallCount?: number;
  /** Agent 执行时间（毫秒） */
  executionTimeMs?: number;
}

// ========== 增量更新相关类型 ==========

/**
 * CandidateSnapshotEntry - 候选快照条目
 * 用于增量更新，存储候选的稳定标识和内容 hash
 */
export interface CandidateSnapshotEntry {
  /** 候选 ID（稳定，基于 anchorTable + 入口点集合） */
  candidateId: string;
  /** 锚点表名 */
  anchorTable: string;
  /** 入口点 ID 列表（排序后的稳定集合） */
  entryPointIds: string[];
  /** 候选内容 hash（用于检测内容变化） */
  contentHash: string;
}

/**
 * CandidateSnapshot - 候选快照
 * 存储在 _index.json 中，用于增量更新判断
 */
export interface CandidateSnapshot {
  /** 所有候选快照条目 */
  candidates: CandidateSnapshotEntry[];
  /** 快照生成时间 */
  createdAt: string;
  /** Git commit hash（记录代码版本） */
  commitHash: string;
}

/**
 * StoredLlmDecision - 存储的 LLM 决策
 * 用于增量更新时作为参考输入
 */
export interface StoredLlmDecision {
  /** 域内核心候选 */
  coreCandidateIds: string[];
  /** 域内支撑候选 */
  supportingCandidateIds: string[];
  /** 业务域名称 */
  domainName: string;
  /** 生成的 partitionId */
  partitionId: string;
  /** 置信度 */
  confidence: number;
  /** 判断依据 */
  reasoning: string;
}

/**
 * IncrementalUpdateResult - 增量更新判断结果
 */
export interface IncrementalUpdateResult {
  /** 是否需要重新运行分析 */
  needsReanalysis: boolean;
  /** 更新类型 */
  updateType: "none" | "content_change" | "structure_change";
  /** 变化的候选 ID 列表 */
  changedCandidateIds: string[];
  /** 新增的候选 ID 列表 */
  addedCandidateIds: string[];
  /** 删除的候选 ID 列表 */
  removedCandidateIds: string[];
  /** 可复用的 LLM 决策（未变化候选） */
  reusableDecisions: StoredLlmDecision[];
  /** 上次快照（如果存在） */
  previousSnapshot?: CandidateSnapshot;
}
