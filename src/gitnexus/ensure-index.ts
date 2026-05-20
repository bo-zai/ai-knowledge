import type { GitNexusExecutor } from './types.js';

export interface EnsureIndexDeps {
  repoPath: string;
  execGitNexus: GitNexusExecutor;
  hasIndex: (repoPath: string) => Promise<boolean>;
}

export async function ensureGitNexusIndex(deps: EnsureIndexDeps): Promise<void> {
  const indexed = await deps.hasIndex(deps.repoPath);
  if (indexed) return;
  await deps.execGitNexus(['analyze', deps.repoPath], deps.repoPath);
}

// 默认的索引检查实现（基于 GitNexus status 命令）
export async function checkGitNexusIndex(repoPath: string, exec: GitNexusExecutor): Promise<boolean> {
  try {
    const result = await exec(['status', repoPath], repoPath);
    return result.stdout.includes('indexed');
  } catch {
    return false;
  }
}