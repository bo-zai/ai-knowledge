import { createGitNexusExecutor, runGitNexus } from './commands.js';
import { checkGitNexusIndex, ensureGitNexusIndex } from './ensure-index.js';

export interface GitNexusAdapter {
  ensureIndex: (repoPath: string) => Promise<void>;
  query: (command: string, args: string[], cwd?: string) => Promise<string>;
}

export function createGitNexusAdapter(): GitNexusAdapter {
  const exec = createGitNexusExecutor();
  return {
    ensureIndex: async (repoPath: string) => {
      await ensureGitNexusIndex({
        repoPath,
        execGitNexus: exec,
        hasIndex: async (path: string) => checkGitNexusIndex(path, exec),
      });
    },
    query: async (command: string, args: string[], cwd?: string) => {
      const result = await runGitNexus([command, ...args], cwd);
      return result.stdout;
    },
  };
}