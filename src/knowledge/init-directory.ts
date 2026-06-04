/**
 * Directory Structure Initialization
 *
 * Creates the knowledge package output directory skeleton before generation.
 * Follows design/03-knowledge-directory-structure.md specification.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';

// 设计文档定义的 8 类知识目录（业务视角）
export const KNOWLEDGE_DIRS = [
  'capabilities',
  'concepts',
  'boundaries',
  'external-systems',
  'constraints',
  'relations',
  'data-model',
  'workflows',
] as const;

// 技术类型目录（旧实现）
export const LEGACY_DIRS = [
  'terms',
  'contracts',
  'flows',
  'modules',
  'open',
  'ownership',
  'validation',
  'db',
] as const;

// 所有目录类型（业务 + 技术）
export const ALL_DIRS = [
  ...KNOWLEDGE_DIRS,
  ...LEGACY_DIRS,
] as const;

export type KnowledgeDir = typeof KNOWLEDGE_DIRS[number];
export type LegacyDir = typeof LEGACY_DIRS[number];
export type AllObjectDir = typeof ALL_DIRS[number];

/**
 * Package layout with paths to key directories and files.
 */
export interface PackageLayout {
  packageRoot: string;       // {outputRoot}/ai-knowledge
  indexMdPath: string;       // {packageRoot}/index.md
  knowledgeDirs: Record<KnowledgeDir, string>;  // 各知识类型目录路径
  reportsDir: string;        // {packageRoot}/reports (生成报告)
}

/**
 * Initialize the knowledge package directory structure.
 *
 * Creates empty directory skeleton (no knowledge files yet).
 */
export async function initDirectoryStructure(outputRoot: string): Promise<PackageLayout> {
  const packageRoot = path.resolve(outputRoot, DEFAULT_KNOWLEDGE_DIR);

  // Safety check: must be ai-knowledge
  if (path.basename(packageRoot) !== DEFAULT_KNOWLEDGE_DIR) {
    throw new Error(`Refusing to initialize invalid package root: ${packageRoot} (basename must be '${DEFAULT_KNOWLEDGE_DIR}')`);
  }

  logger.info(`Initializing directory structure at ${packageRoot}`);

  // Clean old output
  await fs.rm(packageRoot, { recursive: true, force: true });

  // Create directory skeleton
  await fs.mkdir(packageRoot, { recursive: true });

  // 创建各知识类型目录
  const knowledgeDirs: Record<KnowledgeDir, string> = {} as Record<KnowledgeDir, string>;
  for (const dirName of KNOWLEDGE_DIRS) {
    const dirPath = path.join(packageRoot, dirName);
    await fs.mkdir(dirPath, { recursive: true });
    knowledgeDirs[dirName] = dirPath;
  }

  // 创建报告目录（用于存储生成报告）
  const reportsDir = path.join(packageRoot, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const indexMdPath = path.join(packageRoot, 'index.md');

  logger.info('Directory structure initialized');

  return {
    packageRoot,
    indexMdPath,
    knowledgeDirs,
    reportsDir,
  };
}