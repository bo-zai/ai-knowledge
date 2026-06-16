/**
 * 概念提取模块索引
 *
 * 提供以表为锚点的业务概念发现和提取功能。
 *
 * 主要流程：
 * 1. ParallelDiscoveryRunner 协调多种发现途径并行执行
 * 2. Controller/Scheduled/MqConsumer 路径发现追溯调用链
 * 3. TableAnchorAggregator 聚合跨模块的表锚点
 * 4. 生成 ConceptCandidate 概念候选
 * 5. GitCommitEnhancer 增强 Git 历史（Task 8）
 * 6. BusinessDomainDefiner 定义业务域（Task 8）
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
} from './types.js';

// 主入口：并行发现运行器
export {
  ParallelDiscoveryRunner,
  createParallelDiscoveryRunner,
  createParallelDiscoveryRunnerWithOptions,
  type ParallelDiscoveryConfig,
  type ParallelDiscoveryResult,
  type ParallelDiscoveryRunnerOptions,
  // Stub 接口（Task 7 和 Task 8 将提供实现）
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