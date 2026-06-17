/**
 * 模块划分模块
 *
 * 提供独立的模块划分功能，可被 generate、partition 等命令复用
 */

// 类型定义
export type {
  ModuleRole,
  ModuleType,
  ModuleInfo,
  CouplingMode,
  ModuleTopology,
  ModuleConfig,
  ModuleResult,
  SignalDetectionResult,
} from './types.js';

export { ModuleTopologySchema, COUPLING_SIGNALS } from './types.js';

// 核心组件
export { ModuleDiscoverer, createModuleDiscoverer, type ModuleDiscoverySummary } from './discoverer.js';
export { ModuleAnalyzer, createModuleAnalyzer } from './analyzer.js';
export { ModuleWriter, createModuleWriter } from './writer.js';

// 运行器
export { runModule, loadModuleTopology, hasModuleTopology } from './runner.js';