import { fileExists, readText } from '../shared/fs.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';

export async function runStatus(repoPath: string): Promise<void> {
  const bootstrapDir = DEFAULT_BOOTSTRAP_DIR;
  const manifestPath = `${repoPath}/${bootstrapDir}/manifest.yaml`;

  const exists = await fileExists(manifestPath);

  if (!exists) {
    console.log(`bootstrap-knowledge: missing`);
    console.log(`Path: ${repoPath}/${bootstrapDir}`);
    console.log(`To generate, run: repo-knowledge-generator generate --repo ${repoPath}`);
    return;
  }

  try {
    const manifestContent = await readText(manifestPath);
    console.log(`bootstrap-knowledge: present`);
    console.log(`Path: ${repoPath}/${bootstrapDir}`);
    console.log(`Generated at: extracting from manifest...`);

    // 简化输出
    const lines = manifestContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('generated_at:')) {
        console.log(line);
      }
      if (line.startsWith('repo_id:')) {
        console.log(line);
      }
    }
  } catch (error) {
    console.log(`bootstrap-knowledge: error reading manifest`);
    console.log(`Error: ${error}`);
  }
}