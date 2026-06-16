/**
 * 概念提取模块索引
 *
 * 提供以表为锚点的业务概念发现和提取功能。
 *
 * 主要流程：
 * 1. ParallelDiscoveryRunner 协调多种发现途径并行执行
 * 2. Controller/Scheduled/MqConsumer 路径发现追溯调用链
 * 3. TableAnchorAggregator 聚合跨模块的表锚点
 * 4. TableRelationSupplement 补充表关联关系（Task 7）
 * 5. ServiceCallCluster 聚类 Service 调用链（Task 7）
 * 6. 生成 ConceptCandidate 概念候选
 * 7. GitCommitEnhancer 增强 Git 历史（Task 8）
 * 8. BusinessDomainDefiner 定义业务域（Task 8）
 */

// 核心类型
export type {
  ConceptCandidate,
  TableAnchor,
  TableTraceSource,
  EntryPointInfo,
  ConceptTracePath,
  ServiceChainNode,
  MapperInfo,
  TableInfo,
  EntityInfo,
  GitCommitEvidence,
  BusinessDomain,
  DiscoveryPathResult,
  LanguageAdapter,
  // Task 7 新增类型
  RelatedTableInfo,
  ServiceCluster,
} from './types.js';

// 主入口：并行发现运行器
export {
  ParallelDiscoveryRunner,
  createParallelDiscoveryRunner,
  createParallelDiscoveryRunnerWithOptions,
  type ParallelDiscoveryConfig,
  type ParallelDiscoveryResult,
  type ParallelDiscoveryRunnerOptions,
  // 接口
  type TableRelationSupplement,
  type ServiceCallCluster,
  type GitCommitEnhancer,
  type BusinessDomainDefiner,
} from './parallel-discovery-runner.js';

// 语言适配器
export {
  createLanguageAdapter,
  isLanguageSupported,
  getSupportedLanguages,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './language-adapters/index.js';

export { createJavaAdapter, JavaAdapter } from './language-adapters/java-adapter.js';

// 路径发现
export {
  ControllerPathDiscovery,
  createControllerPathDiscovery,
  type ControllerPathDiscoveryConfig,
  ScheduledPathDiscovery,
  createScheduledPathDiscovery,
  type ScheduledPathDiscoveryConfig,
  MqConsumerPathDiscovery,
  createMqConsumerPathDiscovery,
  type MqConsumerPathDiscoveryConfig,
} from './discovery-paths/index.js';

// 表锚点聚合器
export {
  TableAnchorAggregator,
  createTableAnchorAggregator,
  type TableAnchorAggregatorConfig,
} from './table-anchor-aggregator.js';

// Task 7: 表关联补充器和 Service 调用链聚类器
export {
  TableRelationSupplementImpl,
  createTableRelationSupplement,
  type TableRelationSupplementConfig,
} from './table-relation-supplement.js';

export {
  ServiceCallClusterImpl,
  createServiceCallCluster,
  type ServiceCallClusterConfig,
} from './service-call-cluster.js';

// Task 8: Git Commit 增强器和业务域定义器
export {
  GitCommitEnhancerImpl,
  createGitCommitEnhancer,
  type GitCommitEnhancerConfig,
} from './git-commit-enhancer.js';

export {
  BusinessDomainDefinerImpl,
  createBusinessDomainDefiner,
  type BusinessDomainDefinerConfig,
} from './business-domain-definer.js';