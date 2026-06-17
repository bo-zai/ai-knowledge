/**
 * 模块发现类型定义
 *
 * 解耦设计的核心类型，供探测器、分析器、协调器使用
 */

import type {
  ModuleInfo,
  ModuleRole,
  ModuleType,
  CouplingMode,
} from "../../schemas/module.js";

/**
 * 探测结果
 *
 * 单个探测器返回的模块列表
 */
export interface DetectionResult {
  /** 探测器名称 */
  detectorName: string;

  /** 发现的模块列表 */
  modules: ModuleInfo[];

  /** 探测层级：root-build-system | sub-project | nested */
  layer: "root-build-system" | "sub-project" | "nested";

  /** 探测是否成功 */
  success: boolean;

  /** 错误信息（可选） */
  error?: string;
}

/**
 * 探测器接口
 *
 * 所有探测器必须实现此接口，支持策略模式扩展
 */
export interface ModuleDetector {
  /** 探测器名称 */
  name: string;

  /** 探测器优先级（数字越小优先级越高） */
  priority: number;

  /** 检查该探测器是否适用于当前路径 */
  canDetect(repoPath: string): Promise<boolean>;

  /** 执行探测，返回发现的模块 */
  detect(
    repoPath: string,
    options?: DetectionOptions,
  ): Promise<DetectionResult>;
}

/**
 * 探测选项
 */
export interface DetectionOptions {
  /** 是否递归探测嵌套结构 */
  recursive?: boolean;

  /** 已发现的模块路径（用于去重） */
  discoveredPaths?: Set<string>;

  /** 最大递归深度 */
  maxDepth?: number;

  /** 是否跳过已知的忽略目录 */
  skipIgnoredDirs?: boolean;
}

/**
 * 模块发现完整结果
 *
 * Coordinator 返回的最终结果
 */
export interface ModuleDiscoveryResult {
  /** 发现的模块列表（已去重） */
  modules: ModuleInfo[];

  /** 模块总数 */
  moduleCount: number;

  /** 仓库类型：single-project | build-system-multi-module | business-domain-multi-project | hybrid | nested */
  repoType: RepoType;

  /** 各层探测结果（用于追溯） */
  layerResults: {
    rootBuildSystem: DetectionResult[];
    subProject: DetectionResult[];
    nested?: DetectionResult[];
  };

  /** 耦合模式 */
  couplingMode: CouplingMode;
}

/**
 * 仓库类型
 */
export type RepoType =
  | "single-project" // 单项目仓库
  | "build-system-multi-module" // 构建系统多模块（Maven/Gradle/npm workspaces）
  | "business-domain-multi-project" // 业务域多项目（子目录各自有构建配置）
  | "hybrid" // 混合型（构建系统声明部分，子目录还有独立项目）
  | "nested"; // 嵌套多模块

/**
 * 构建系统类型
 */
export type BuildSystemType =
  | "maven"
  | "gradle"
  | "npm"
  | "go"
  | "rust"
  | "python"
  | "unknown";

/**
 * 构建配置文件信息
 */
export interface BuildConfigInfo {
  /** 构建系统类型 */
  type: BuildSystemType;

  /** 配置文件路径 */
  configPath: string;

  /** 是否声明了子模块/子项目 */
  hasSubModules: boolean;

  /** 声明的子模块名列表 */
  declaredModules?: string[];
}

/**
 * 子目录扫描结果
 */
export interface SubProjectScanResult {
  /** 子目录路径 */
  path: string;

  /** 是否有构建配置 */
  hasBuildConfig: boolean;

  /** 构建配置信息（如有） */
  buildConfig?: BuildConfigInfo;

  /** 推断的模块类型 */
  inferredModuleType?: ModuleType;

  /** 推断的模块角色 */
  inferredModuleRole?: ModuleRole;
}

/**
 * 模块角色判断信号
 */
export interface RoleSignal {
  /** 信号名称 */
  name: string;

  /** 信号权重 */
  weight: number;

  /** 信号是否命中 */
  hit: boolean;

  /** 命中证据 */
  evidence?: string;
}
