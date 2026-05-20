import { execa } from 'execa';
import type { GitNexusExecutor, GitNexusResult } from './types.js';

export async function runGitNexus(args: string[], cwd?: string): Promise<GitNexusResult> {
  const result = await execa('gitnexus', args, { cwd });
  return { stdout: result.stdout };
}

export function createGitNexusExecutor(): GitNexusExecutor {
  return runGitNexus;
}