/**
 * 模块发现导出
 *
 * 统一导出模块发现功能
 */

export { ModuleDiscoveryCoordinator } from "./coordinator.js";
export type {
  ModuleDiscoveryResult,
  RepoType,
  DetectionResult,
  DetectionOptions,
  BuildConfigInfo,
  SubProjectScanResult,
  RoleSignal,
} from "./types.js";
export {
  ROOT_DETECTORS,
  SUB_PROJECT_DETECTORS,
  MavenRootDetector,
  GradleRootDetector,
  NpmRootDetector,
  GoRootDetector,
  SubProjectScanner,
} from "./detectors/index.js";
