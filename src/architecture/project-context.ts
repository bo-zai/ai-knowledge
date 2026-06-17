/**
 * 项目类型定义
 *
 * 按执行模型分类的主类型、复合类型和特殊类型
 */

/** 主项目类型 */
export type PrimaryProjectType =
  | "backend-service"
  | "frontend-app"
  | "cli-tool"
  | "library"
  | "mobile-app";

/** 复合项目类型 */
export type CompositeProjectType = "fullstack" | "monorepo" | "microservices";

/** 特殊项目类型 */
export type SpecialProjectType =
  | "config-only"
  | "api-definition"
  | "static-site"
  | "test-only";

/** 所有项目类型 */
export type ProjectType =
  | PrimaryProjectType
  | CompositeProjectType
  | SpecialProjectType
  | "unknown";

/** 主语言类型 */
export type PrimaryLanguage =
  | "java"
  | "typescript"
  | "javascript"
  | "go"
  | "python"
  | "kotlin"
  | "rust"
  | "other";

/** 子包信息（monorepo/fullstack 时使用） */
export interface PackageInfo {
  name: string;
  path: string;
  type: ProjectType;
}

/** 项目上下文结构 */
export interface ProjectContext {
  /** 项目类型 */
  projectType: ProjectType;

  /** 主语言 */
  primaryLanguage: PrimaryLanguage;

  /** 框架名称（如 spring-boot, react, vue） */
  framework?: string;

  /** 技术栈列表 */
  techStack: string[];

  /** 识别置信度 0.0~1.0 */
  confidence: number;

  /** 识别时间 */
  identifiedAt: string;

  /** 识别依据 */
  identificationEvidence: string[];

  /** 子包信息（复合类型时） */
  packages?: PackageInfo[];
}

/** 项目类型识别证据 */
export interface ProjectTypeEvidence {
  /** 目录树（顶层 2~3 层） */
  directoryTree: string;

  /** 配置文件路径列表 */
  configFiles: string[];

  /** 入口文件候选 */
  entryCandidates: string[];

  /** README 片段 */
  readmeSnippet?: string;

  /** 依赖列表 */
  dependencies: string[];
}

/** 项目类型识别结果 */
export interface ProjectTypeIdentificationResult {
  projectType: ProjectType;
  primaryLanguage: PrimaryLanguage;
  framework?: string;
  techStack: string[];
  confidence: number;
  identificationEvidence: string[];
}

/** 生成元信息 */
export interface GenerationMeta {
  /** 上次生成的 commit hash */
  lastCommitHash: string;

  /** 上次生成时间 */
  lastGeneratedAt: string;

  /** 知识库版本 */
  version: string;

  /** 项目类型识别时间 */
  projectTypeIdentifiedAt: string;
}
