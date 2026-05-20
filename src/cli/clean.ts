import { removeDir, fileExists } from '../shared/fs.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';

export async function runClean(repoPath: string): Promise<void> {
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