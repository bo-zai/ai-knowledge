/**
 * Directory Structure Initialization
 *
 * Creates the knowledge package output directory skeleton before generation.
 * Follows design/03-knowledge-directory-structure.md specification.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { DEFAULT_KNOWLEDGE_DIR } from "../config/defaults.js";
import {
  ALL_KNOWLEDGE_TYPES,
  type KnowledgeType,
} from "../schemas/knowledge-type.js";

// 设计文档定义的 8 类知识目录（业务视角）
// ARCHITECTURE 类型使用根目录（空字符串），不在子目录中
export const KNOWLEDGE_DIRS = [
  "capabilities",
  "concepts",
  "boundaries",
  "external-systems",
  "constraints",
  "relations",
  "data-model",
  "workflows",
] as const;

// 技术类型目录（旧实现）
export const LEGACY_DIRS = [
  "terms",
  "contracts",
  "flows",
  "modules",
  "open",
  "ownership",
  "validation",
  "db",
] as const;

// 所有目录类型（业务 + 技术 + 根目录）
export const ALL_DIRS = [
  "", // 根目录（用于 ARCHITECTURE 类型）
  ...KNOWLEDGE_DIRS,
  ...LEGACY_DIRS,
] as const;

export type KnowledgeDir = (typeof KNOWLEDGE_DIRS)[number];
export type LegacyDir = (typeof LEGACY_DIRS)[number];
export type AllObjectDir = (typeof ALL_DIRS)[number];

/**
 * 知识类型 → 需清理的路径列表
 *
 * ARCHITECTURE 对应根目录文件，其他类型对应子目录。
 */
const KNOWLEDGE_TYPE_CLEANUP_MAP: Record<KnowledgeType, string[]> = {
  ARCHITECTURE: ["architecture.md", "project-context.json", "modules.json"],
  CAPABILITY: [
    "capabilities",
    "views/capabilities",
    "debug/capabilities",
    "debug/capability-llm-request.json",
    "debug/capability-llm-response.json",
    "reports/capabilities",
    "evidence",
    "functions",
    "objects/capabilities",
    "objects/concepts",
    "objects/workflows",
    "objects/modules",
    "objects/contracts",
    "objects/validation",
    "objects/boundaries",
  ],
  CONCEPT: ["concepts"],
  BOUNDARY: ["boundaries"],
  EXTERNAL: ["external-systems"],
  CONSTRAINT: ["constraints"],
  RELATION: ["relations"],
  DATA_MODEL: ["data-model"],
  WORKFLOW: ["workflows"],
};

/**
 * Package layout with paths to key directories and files.
 */
export interface PackageLayout {
  packageRoot: string; // {outputRoot}/ai-knowledge
  indexMdPath: string; // {packageRoot}/index.md
  knowledgeDirs: Record<KnowledgeDir, string>; // 各知识类型目录路径
  reportsDir: string; // {packageRoot}/.internal/reports (生成报告)
}

/**
 * 判断是否为全量生成（需要删除整个知识库）
 *
 * 全量生成：types 包含所有 9 类知识类型
 */
function isFullGeneration(types: KnowledgeType[]): boolean {
  return (
    types.length === ALL_KNOWLEDGE_TYPES.length &&
    types.every((t) => ALL_KNOWLEDGE_TYPES.includes(t))
  );
}

/**
 * 清理指定知识类型对应的目录
 *
 * @param packageRoot - ai-knowledge/ 根目录路径
 * @param types - 要清理的知识类型列表
 *
 * 行为：
 * - 全量生成（types 包含所有类型）：删除整个 ai-knowledge/
 * - 部分/单类型生成：只删除指定类型对应的目录/文件
 *   - ARCHITECTURE: 删除 architecture.md, project-context.json, modules.json
 *   - 其他类型：删除对应的子目录
 */
export async function cleanupKnowledgeDirs(
  packageRoot: string,
  types: KnowledgeType[],
): Promise<void> {
  // Safety check: must be ai-knowledge
  if (path.basename(packageRoot) !== DEFAULT_KNOWLEDGE_DIR) {
    throw new Error(
      `Refusing to cleanup invalid package root: ${packageRoot} (basename must be '${DEFAULT_KNOWLEDGE_DIR}')`,
    );
  }

  logger.info(
    `Cleaning up knowledge directories for types: ${types.join(", ")}`,
  );

  // 全量生成：删除整个 ai-knowledge/
  if (isFullGeneration(types)) {
    logger.info("Full generation mode: removing entire ai-knowledge/");
    try {
      await fs.rm(packageRoot, { recursive: true, force: true });
      logger.info("Removed entire ai-knowledge/ directory");
    } catch (e) {
      // Windows 上可能有文件锁定，尝试逐个删除
      logger.debug(
        `Cannot fully remove ${packageRoot}, cleaning subdirectories`,
      );
      for (const dirName of KNOWLEDGE_DIRS) {
        const subDir = path.join(packageRoot, dirName);
        try {
          await fs.rm(subDir, { recursive: true, force: true });
        } catch {
          // 忽略子目录删除失败
        }
      }
      // 清理根目录文件
      for (const file of [
        "architecture.md",
        "project-context.json",
        "modules.json",
        "index.md",
      ]) {
        try {
          await fs.rm(path.join(packageRoot, file), { force: true });
        } catch {
          // 忽略
        }
      }
      // 清理 .internal 目录
      try {
        await fs.rm(path.join(packageRoot, ".internal"), {
          recursive: true,
          force: true,
        });
      } catch {
        // 忽略
      }
    }
    return;
  }

  // 部分/单类型生成：只删除对应目录
  for (const type of types) {
    const cleanupPaths = KNOWLEDGE_TYPE_CLEANUP_MAP[type];
    if (!cleanupPaths) {
      logger.warn(`Unknown knowledge type: ${type}, skipping cleanup`);
      continue;
    }

    for (const cleanupPath of cleanupPaths) {
      const fullPath = path.join(packageRoot, cleanupPath);
      try {
        await fs.rm(fullPath, { recursive: true, force: true });
        logger.debug(`Removed: ${cleanupPath}`);
      } catch (e) {
        // 文件不存在或删除失败，忽略
        logger.debug(
          `Cannot remove ${cleanupPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  logger.info("Knowledge directories cleanup completed");
}

/**
 * 确保指定知识类型对应的目录存在
 *
 * @param packageRoot - ai-knowledge/ 根目录路径
 * @param types - 需要的知识类型列表
 *
 * 行为：
 * - 确保 ai-knowledge/ 根目录存在
 * - 确保 types 对应的子目录存在
 * - 确保 .internal/reports/ 目录存在（用于存储生成报告）
 * - 不删除任何现有内容
 *
 * 返回：
 * - PackageLayout: 包含所有目录路径
 */
export async function ensureDirectoryStructure(
  packageRoot: string,
  types: KnowledgeType[],
): Promise<PackageLayout> {
  // Safety check: must be ai-knowledge
  if (path.basename(packageRoot) !== DEFAULT_KNOWLEDGE_DIR) {
    throw new Error(
      `Refusing to initialize invalid package root: ${packageRoot} (basename must be '${DEFAULT_KNOWLEDGE_DIR}')`,
    );
  }

  logger.info(
    `Ensuring directory structure at ${packageRoot} for types: ${types.join(", ")}`,
  );

  // 确保根目录存在
  await fs.mkdir(packageRoot, { recursive: true });

  // 确保各知识类型目录存在（根据 types 决定）
  const knowledgeDirs: Record<KnowledgeDir, string> = {} as Record<
    KnowledgeDir,
    string
  >;
  for (const dirName of KNOWLEDGE_DIRS) {
    const dirPath = path.join(packageRoot, dirName);
    await fs.mkdir(dirPath, { recursive: true });
    knowledgeDirs[dirName] = dirPath;
  }

  // 确保报告目录存在（放在 .internal 下）
  const internalDir = path.join(packageRoot, ".internal");
  await fs.mkdir(internalDir, { recursive: true });
  const reportsDir = path.join(internalDir, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const indexMdPath = path.join(packageRoot, "index.md");

  logger.info("Directory structure ensured");

  return {
    packageRoot,
    indexMdPath,
    knowledgeDirs,
    reportsDir,
  };
}

/**
 * @deprecated Use cleanupKnowledgeDirs + ensureDirectoryStructure instead.
 *
 * 旧版本的初始化函数，会删除整个 ai-knowledge/ 目录。
 * 保留此函数是为了向后兼容，但新代码应使用分离的函数。
 */
export async function initDirectoryStructure(
  outputRoot: string,
): Promise<PackageLayout> {
  const packageRoot = path.resolve(outputRoot, DEFAULT_KNOWLEDGE_DIR);

  // 全量清理（旧行为）
  await cleanupKnowledgeDirs(packageRoot, ALL_KNOWLEDGE_TYPES);

  // 确保目录存在
  return ensureDirectoryStructure(packageRoot, ALL_KNOWLEDGE_TYPES);
}
