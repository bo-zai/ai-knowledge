/**
 * Target Repository Resolver
 *
 * Unified logic for resolving target repository path from CLI options.
 * Priority: --repo > positional path > cwd git root > cwd fallback
 */

import { getGitRoot, hasGitDir } from '../engine/storage/git.js';

export interface ResolveRepoInput {
  repoOption?: string;
  positionalPath?: string;
  cwd?: string;
}

export interface ResolveRepoResult {
  repoPath: string;
  source: 'repo_option' | 'positional_path' | 'cwd_git_root' | 'cwd_fallback';
}

/**
 * Resolve target repository path with unified priority rules.
 */
export function resolveTargetRepo(input: ResolveRepoInput): ResolveRepoResult {
  const cwd = input.cwd ?? process.cwd();

  // Priority 1: explicit --repo option
  if (input.repoOption) {
    return {
      repoPath: input.repoOption,
      source: 'repo_option',
    };
  }

  // Priority 2: positional path argument
  if (input.positionalPath) {
    return {
      repoPath: input.positionalPath,
      source: 'positional_path',
    };
  }

  // Priority 3: cwd git root (if in a git repo)
  if (hasGitDir(cwd)) {
    const gitRoot = getGitRoot(cwd);
    if (gitRoot) {
      return {
        repoPath: gitRoot,
        source: 'cwd_git_root',
      };
    }
  }

  // Priority 4: fallback to cwd
  return {
    repoPath: cwd,
    source: 'cwd_fallback',
  };
}