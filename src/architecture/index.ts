/**
 * 架构模块
 *
 * 项目类型识别和架构概览生成
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