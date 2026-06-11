/**
 * 架构模块
 *
 * 项目类型识别、分析单元划分和架构概览生成
 */

// 类型定义
export type {
  ProjectType,
  PrimaryProjectType,
  CompositeProjectType,
  SpecialProjectType,
  PrimaryLanguage,
  ProjectContext,
  ProjectTypeEvidence,
  ProjectTypeIdentificationResult,
  PackageInfo,
  GenerationMeta,
} from './project-context.js';

// 项目类型识别
export {
  collectProjectTypeEvidence,
  identifyProjectType,
  saveProjectContext,
  loadProjectContext,
  buildProjectContext,
} from './project-type-identifier.js';

// 分析单元划分
export {
  analyzeAnalysisUnits,
  evaluateCouplingSignals,
  decideCouplingMode,
  saveModuleTopology,
  loadModuleTopology,
  ModuleDiscoveryCoordinator,
} from './analysis-unit.js';

export type {
  ModuleDiscoveryResult,
  RepoType,
} from './module-discovery/types.js';

export type {
  ModuleInfo,
  ModuleTopology,
  ModuleRole,
  ModuleType,
  CouplingMode,
  AnalysisUnit,
  AnalysisUnitResult,
  SignalDetectionResult,
} from '../schemas/module.js';

// 架构概览生成
export {
  generateArchitectureOverview,
  collectArchitectureEvidence,
  type ArchitectureGenerationResult,
  type ArchitectureOverview,
} from './architecture-generator.js';

// 生成元信息
export {
  loadGenerationMeta,
  saveGenerationMeta,
  getCurrentCommitHash,
  shouldReidentifyProjectType,
} from './meta-file.js';