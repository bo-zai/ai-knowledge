/**
 * 模块探测器导出
 *
 * 统一导出所有探测器，支持按需加载
 */

export { type ModuleDetector, type DetectionResult, type DetectionOptions } from './detector-interface.js';
export { MavenRootDetector } from './maven-detector.js';
export { GradleRootDetector } from './gradle-detector.js';
export { NpmRootDetector } from './npm-detector.js';
export { GoRootDetector } from './go-detector.js';
export { SubProjectScanner } from './sub-project-scanner.js';

/**
 * 所有探测器的注册列表
 *
 * 按优先级排序，用于 Coordinator 调用
 */
import { MavenRootDetector } from './maven-detector.js';
import { GradleRootDetector } from './gradle-detector.js';
import { NpmRootDetector } from './npm-detector.js';
import { GoRootDetector } from './go-detector.js';
import { SubProjectScanner } from './sub-project-scanner.js';
import type { ModuleDetector } from './detector-interface.js';

/**
 * Layer 1 探测器（根目录构建系统）
 *
 * 按优先级排序，短路检测
 */
export const ROOT_DETECTORS: ModuleDetector[] = [
  new MavenRootDetector(),    // priority: 1
  new GradleRootDetector(),   // priority: 2
  new NpmRootDetector(),      // priority: 3
  new GoRootDetector(),       // priority: 4
];

/**
 * Layer 2 探测器（子目录独立项目）
 */
export const SUB_PROJECT_DETECTORS: ModuleDetector[] = [
  new SubProjectScanner(),    // priority: 10
];