export type {
  ProjectType,
  PrimaryProjectType,
  CompositeProjectType,
  SpecialProjectType,
  PrimaryLanguage,
  PartitionMode,
  PackageInfo,
  ProjectTypeEvidence,
  ProjectTypeIdentificationResult,
  PartitionModeResolutionResult,
  RepositoryClassificationContext,
  GenerationMeta,
} from "./types.js";

export { collectProjectTypeEvidence } from "./evidence-collector.js";
export {
  identifyProjectType,
  buildClassificationBase,
} from "./project-type-identifier.js";
export {
  resolvePartitionMode,
  refinePartitionModeWithTopology,
} from "./partition-mode-resolver.js";
export { classifyRepository } from "./classify-repository.js";
export { saveProjectContext, loadProjectContext } from "./context-store.js";
