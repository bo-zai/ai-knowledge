import { Command } from 'commander';
import { runGenerate } from './generate.js';
import { runStatus } from './status.js';
import { runClean } from './clean.js';

const program = new Command();

program
  .name('repo-knowledge-generator')
  .description('Generate bootstrap-knowledge packages from GitNexus + LLM')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate bootstrap knowledge package')
  .requiredOption('--repo <path>', 'Target repository path')
  .option('--slice <value>', 'Generate only specific slice')
  .option('--model <name>', 'LLM model name', 'gpt-4o')
  .option('--base-url <url>', 'LLM API base URL', 'https://api.openai.com/v1')
  .option('--api-key-env <name>', 'Environment variable for API key', 'OPENAI_API_KEY')
  .option('--force-analyze', 'Force GitNexus re-analysis')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    await runGenerate(options);
  });

program
  .command('status')
  .description('Show package status')
  .requiredOption('--repo <path>', 'Target repository path')
  .action(async (options) => {
    await runStatus(options.repo);
  });

program
  .command('clean')
  .description('Remove bootstrap knowledge package')
  .requiredOption('--repo <path>', 'Target repository path')
  .action(async (options) => {
    await runClean(options.repo);
  });

program.parse();