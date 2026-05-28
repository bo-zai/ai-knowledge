import { resolveModelConfig, loadDefaultLlmConfigFile } from '../src/config/model-config.js';
import { getEnvVar } from '../src/config/env.js';
import { runKnowledgeReadRuntime } from '../src/agent-read-runtime/index.js';

const repoPath = process.argv[2] ?? process.cwd();
const instruction = process.argv.slice(3).join(' ') || 'Find the package name and cite the file evidence.';

async function main() {
  const fileConfig = await loadDefaultLlmConfigFile();
  const resolvedConfig = resolveModelConfig({ fileConfig });
  const apiKey = resolvedConfig.apiKey || getEnvVar(resolvedConfig.apiKeyEnv);

  console.log('Running KnowledgeReadRuntime...');
  console.log(`Repo: ${repoPath}`);
  console.log(`Instruction: ${instruction}`);
  console.log('---');

  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction,
    model: resolvedConfig.model,
    baseUrl: resolvedConfig.baseUrl,
    apiKey,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
