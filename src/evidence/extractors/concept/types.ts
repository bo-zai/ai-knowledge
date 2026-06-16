// src/evidence/extractors/concept/types.ts

/**
 * 概念候选 - 以表为锚点的业务对象候选
 */
export interface ConceptCandidate {
  // 基础信息
  candidateId: string;              // CAND-{table-name}
  nameCandidates: string[];         // 候选概念名称
  confidence: number;               // 置信度 0-1
  confidenceBreakdown: {
    traceDepth: number;             // 追溯深度（完整度）0.5-1.0
    crossModule: number;            // 跨模块加权 0-0.2
    multiEntryPoint: number;        // 多入口覆盖 0-0.15
    tableRelation: number;          // 表关联密度 0-0.1
  };

  // 模块信息
  modulePath: string;               // 主模块路径
  moduleName: string;               // 主模块名
  isCrossModule: boolean;           // 是否跨模块候选

  // 表锚点信息
  tableAnchor: TableAnchor;

  // 追溯路径信息
  tracePath: ConceptTracePath;

  // Git commit 信息
  gitCommits: GitCommitEvidence[];

  // 标记信息
  suspiciousMark?: 'transmission_class' | 'config_class' | 'simple_enum' | 'external_enum_usage';
}

/**
 * 表锚点 - 跨模块聚合的核心锚点
 */
export interface TableAnchor {
  tableName: string;                // 数据库表名（唯一锚点）
  schema?: string;
  columns: string[];

  traceSources: TableTraceSource[];
  isCrossModule: boolean;           // traceSources 来自多个模块
  moduleCount: number;
  moduleNames: string[];

  aggregatedConfidence: number;

  // Task 7 添加：关联表信息
  relatedTables?: RelatedTableInfo[];  // 通过外键关联的表
  tableRelationBonus?: number;          // 表关联密度加成 0-0.1
}

/**
 * 关联表信息 - Task 7 添加
 */
export interface RelatedTableInfo {
  tableName: string;                     // 关联表名
  relationType: 'foreign_key' | 'join';  // 关联类型
  sourceField?: string;                  // 当前表的关联字段
  targetField?: string;                  // 目标表的关联字段
  confidence: number;                    // 关联置信度 0-1
}

/**
 * Service 聚类 - Task 7 添加
 */
export interface ServiceCluster {
  serviceName: string;                   // Service 类名（唯一标识）
  entryPointCallers: string[];           // 调用该 Service 的入口点列表
  callerServices: string[];              // 调用该 Service 的其他 Service
  isDomainCore: boolean;                 // 是否为业务域核心
  domainHint?: string;                   // 业务域提示（从表名推断）
}

/**
 * 表追溯来源 - 每个模块对表的追溯路径
 */
export interface TableTraceSource {
  modulePath: string;
  moduleName: string;
  entityClassName: string;
  entityFilePath: string;
  entryPoints: EntryPointInfo[];
  mapperClassName: string;
  mapperFilePath: string;
  confidence: number;
}

/**
 * 入口点信息
 */
export interface EntryPointInfo {
  kind: 'controller' | 'scheduled' | 'mq_consumer';
  className: string;
  filePath: string;
  moduleName: string;
  modulePath: string;
  methodName?: string;
  startLine: number;
  signature?: string;             // @GetMapping("/product/list")
}

/**
 * 概念追溯路径 - 完整追溯链路
 */
export interface ConceptTracePath {
  entryPoints: EntryPointInfo[];

  serviceChain?: ServiceChainNode[];

  mappers: MapperInfo[];

  tables: TableInfo[];

  entities: EntityInfo[];
}

/**
 * Service 链节点
 */
export interface ServiceChainNode {
  className: string;
  filePath: string;
  moduleName: string;
  modulePath: string;
  methodName?: string;
  startLine: number;
}

/**
 * Mapper 信息
 */
export interface MapperInfo {
  className: string;
  filePath: string;
  moduleName: string;
  modulePath: string;
  xmlPath?: string;
  sqlIds: string[];
}

/**
 * 表信息
 */
export interface TableInfo {
  tableName: string;
  schema?: string;
  columns?: string[];
}

/**
 * Entity 信息
 */
export interface EntityInfo {
  className: string;
  filePath: string;
  moduleName: string;
  modulePath: string;
  fields: string[];
  startLine: number;
  codeSnippet?: string;
}

/**
 * Git Commit 证据
 */
export interface GitCommitEvidence {
  commitHash: string;
  commitMessage: string;            // 业务描述
  commitDate: string;
  author?: string;

  changedFiles: {
    filePath: string;
    moduleName: string;
    changeType: 'added' | 'modified' | 'deleted';
  }[];

  relevanceScore: number;           // 与候选相关度 0-1
}

/**
 * 业务域定义
 */
export interface BusinessDomain {
  domainId: string;                 // domain-{table-name}
  domainName: string;               // 业务域名称

  coreTables: TableAnchor[];
  relatedTables: TableAnchor[];

  coveredModules: {
    moduleName: string;
    modulePath: string;
    role: 'primary' | 'supporting';
    entryPointCount: number;
  }[];

  isCrossModuleDomain: boolean;
  candidates: ConceptCandidate[];
  gitCommits: GitCommitEvidence[];
}

/**
 * 发现途径结果
 */
export interface DiscoveryPathResult {
  pathway: 'controller' | 'scheduled' | 'mq_consumer';
  entryPoints: EntryPointInfo[];
  tracePaths: ConceptTracePath[];
  errors: string[];
}

/**
 * 语言适配器接口
 */
export interface LanguageAdapter {
  language: string;
  detectEntryPoints(modulePath: string): Promise<EntryPointInfo[]>;
  traceToService(entryPoint: EntryPointInfo): Promise<ServiceChainNode[]>;
  traceToMapper(serviceNode: ServiceChainNode): Promise<MapperInfo[]>;
  extractTableFromMapper(mapper: MapperInfo): Promise<TableInfo[]>;
  findEntityForTable(table: TableInfo, modulePath: string): Promise<EntityInfo | undefined>;
}