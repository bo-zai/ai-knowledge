/**
 * 仓库分类类型定义
 *
 * 同时服务 generate 的项目类型识别和 partition 的分区模式选择。
 */

export type PrimaryProjectType =
  | "backend-service"
  | "frontend-app"
  | "cli-tool"
  | "library"
  | "mobile-app";

export type CompositeProjectType = "fullstack" | "monorepo" | "microservices";

export type SpecialProjectType =
  | "config-only"
  | "api-definition"
  | "static-site"
  | "test-only";

export type ProjectType =
  | PrimaryProjectType
  | CompositeProjectType
  | SpecialProjectType
  | "unknown";

export type PrimaryLanguage =
  | "java"
  | "typescript"
  | "javascript"
  | "go"
  | "python"
  | "kotlin"
  | "rust"
  | "other";

export type PartitionMode =
  | "business-domain"
  | "capability-domain"
  | "degraded-structure"
  | "unsupported";

export interface PackageInfo {
  name: string;
  path: string;
  type: ProjectType;
}

export interface ProjectTypeEvidence {
  directoryTree: string;
  configFiles: string[];
  entryCandidates: string[];
  readmeSnippet?: string;
  dependencies: string[];
  topLevelDirectories: string[];
  structuralSignals: string[];
}

export interface ProjectTypeIdentificationResult {
  projectType: ProjectType;
  primaryLanguage: PrimaryLanguage;
  framework?: string;
  techStack: string[];
  confidence: number;
  identificationEvidence: string[];
}

export interface PartitionModeResolutionResult {
  partitionMode: PartitionMode;
  confidence: number;
  evidence: string[];
}

export interface RepositoryClassificationContext {
  projectType: ProjectType;
  primaryLanguage: PrimaryLanguage;
  framework?: string;
  techStack: string[];
  confidence: number;
  identifiedAt: string;
  identificationEvidence: string[];
  partitionMode: PartitionMode;
  partitionModeConfidence: number;
  partitionModeEvidence: string[];
  packages?: PackageInfo[];
}

export interface GenerationMeta {
  lastCommitHash: string;
  lastGeneratedAt: string;
  version: string;
  projectTypeIdentifiedAt: string;
}
