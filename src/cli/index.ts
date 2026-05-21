import { Command } from 'commander';

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
  .option('--llm-config <path>', 'Path to JSON LLM config file')
  .option('--model <name>', 'LLM model name')
  .option('--base-url <url>', 'LLM API base URL')
  .option('--api-key-env <name>', 'Environment variable for API key')
  .option('--force-analyze', 'Force GitNexus re-analysis')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    const { runGenerate } = await import('./generate.js');
    await runGenerate(options);
  });

program
  .command('status')
  .description('Show package status')
  .requiredOption('--repo <path>', 'Target repository path')
  .action(async (options) => {
    const { runStatus } = await import('./status.js');
    await runStatus(options.repo);
  });

program
  .command('clean')
  .description('Remove bootstrap knowledge package')
  .requiredOption('--repo <path>', 'Target repository path')
  .action(async (options) => {
    const { runClean } = await import('./clean.js');
    await runClean(options.repo);
  });

program.parse();
