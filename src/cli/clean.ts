import { removeDir, fileExists } from '../shared/fs.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';
import { resolveTargetRepo } from '../shared/resolve-target-repo.js';

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
  const bootstrapDir = DEFAULT_BOOTSTRAP_DIR;
  const bootstrapPath = `${repoPath}/${bootstrapDir}`;

  const exists = await fileExists(bootstrapPath);

  if (!exists) {
    console.log(`bootstrap-knowledge not found at ${bootstrapPath}`);
    return;
  }

  await removeDir(bootstrapPath);
  console.log(`Removed ${bootstrapPath}`);
}