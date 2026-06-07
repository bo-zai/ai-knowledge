/**
 * 生成元信息（.meta）文件处理
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { GenerationMeta } from './project-context.js';

/** 默认知识库目录名 */
const DEFAULT_KNOWLEDGE_DIR = 'ai-knowledge';

/** 默认版本号 */
const DEFAULT_VERSION = '1.0.0';

/**
 * 读取生成元信息
 */
export async function loadGenerationMeta(outputRoot: string): Promise<GenerationMeta | null> {
  const filePath = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR, '.meta');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as GenerationMeta;
  } catch {
    return null;
  }
}

/**
 * 保存生成元信息
 */
export async function saveGenerationMeta(
  outputRoot: string,
  commitHash: string,
  projectTypeIdentifiedAt: string,
): Promise<void> {
  const filePath = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR, '.meta');

  const meta: GenerationMeta = {
    lastCommitHash: commitHash,
    lastGeneratedAt: new Date().toISOString(),
    version: DEFAULT_VERSION,
    projectTypeIdentifiedAt,
  };

  await fs.writeFile(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

/**
 * 获取当前仓库的 HEAD commit hash
 */
export async function getCurrentCommitHash(repoPath: string): Promise<string> {
  try {
    // 使用 git rev-parse HEAD 获取当前 commit hash
    const { execSync } = await import('node:child_process');
    const hash = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    return hash;
  } catch {
    // git 命令失败，返回空字符串
    return '';
  }
}

/**
 * 检查是否需要重新识别项目类型
 *
 * 条件：目录结构显著变化或 projectTypeIdentifiedAt 超过一定时间
 */
export function shouldReidentifyProjectType(
  meta: GenerationMeta | null,
  topDirChanges: boolean,
): boolean {
  if (!meta) return true;

  // 目录结构变化
  if (topDirChanges) return true;

  // 超过 30 天重新识别
  const identifiedAt = new Date(meta.projectTypeIdentifiedAt);
  const daysSinceIdentification = (Date.now() - identifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceIdentification > 30) return true;

  return false;
}