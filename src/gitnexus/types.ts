export interface GitNexusResult {
  stdout: string;
}

export type GitNexusExecutor = (args: string[], cwd?: string) => Promise<GitNexusResult>;