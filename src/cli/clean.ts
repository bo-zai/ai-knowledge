import { removeDir, fileExists } from "../shared/fs.js";
import { DEFAULT_KNOWLEDGE_DIR } from "../config/defaults.js";
import { resolveTargetRepo } from "../shared/resolve-target-repo.js";

interface CleanOptions {
  repo?: string;
  path?: string;
}

export async function runClean(options: CleanOptions): Promise<void> {
  // Resolve target repo path
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;
  const knowledgeDir = DEFAULT_KNOWLEDGE_DIR;
  const knowledgePath = `${repoPath}/${knowledgeDir}`;

  const exists = await fileExists(knowledgePath);

  if (!exists) {
    console.log(`ai-knowledge not found at ${knowledgePath}`);
    return;
  }

  await removeDir(knowledgePath);
  console.log(`Removed ${knowledgePath}`);
}
