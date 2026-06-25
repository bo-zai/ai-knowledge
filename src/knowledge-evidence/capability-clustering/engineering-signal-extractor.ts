import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_WINDOW = "180 days ago";

export async function collectRecentFileChangeCounts(input: {
  repoRoot: string;
  filePaths: string[];
  since?: string;
}): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const uniquePaths = [...new Set(input.filePaths.filter(Boolean))];
  await Promise.all(
    uniquePaths.map(async (filePath) => {
      const count = await countRecentCommits({
        repoRoot: input.repoRoot,
        filePath,
        since: input.since ?? DEFAULT_GIT_WINDOW,
      });
      result.set(filePath, count);
    }),
  );
  return result;
}

async function countRecentCommits(input: {
  repoRoot: string;
  filePath: string;
  since: string;
}): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `--since=${input.since}`, "--format=%H", "--", input.filePath],
      {
        cwd: input.repoRoot,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
    return stdout.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}
