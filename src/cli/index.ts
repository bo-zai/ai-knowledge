import { Command } from 'commander';

const program = new Command();

program
  .name('rkg')
  .description('Generate bootstrap-knowledge packages from embedded analysis + LLM')
  .version('0.1.0', '-v, --version', 'output the version number')
  .helpOption('-h, --help', 'display help for command');

program
  .command('generate [path]')
  .description('Generate bootstrap knowledge package. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .option('--slice <value>', 'Generate only specific slice')
  .option('--llm-config <path>', 'Path to JSON LLM config file')
  .option('--model <name>', 'LLM model name')
  .option('--base-url <url>', 'LLM API base URL')
  .option('--api-key-env <name>', 'Environment variable for API key')
  .option('--force-analyze', 'Force embedded analysis re-run')
  .option('--verbose', 'Enable verbose logging')
  .action(async (path, options) => {
    const { runGenerate } = await import('./generate.js');
    await runGenerate({ ...options, path });
  });

program
  .command('status [path]')
  .description('Show package status. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .action(async (path, options) => {
    const { runStatus } = await import('./status.js');
    await runStatus({ ...options, path });
  });

program
  .command('clean [path]')
  .description('Remove bootstrap knowledge package. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .action(async (path, options) => {
    const { runClean } = await import('./clean.js');
    await runClean({ ...options, path });
  });

program
  .command('generate-capability [path]')
  .description('Generate capability-oriented knowledge package from target repository')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .option('--terms <terms>', 'Comma-separated target terms (e.g., db,mybatis,knowledge)')
  .option('--paths <paths>', 'Comma-separated target paths (e.g., src/main,src/test)')
  .option('--out <path>', 'Output directory (defaults to target repo root)')
  .option('--llm-config <path>', 'Path to JSON LLM config file')
  .option('--model <name>', 'LLM model name')
  .option('--base-url <url>', 'LLM API base URL')
  .option('--api-key-env <name>', 'Environment variable for API key')
  .option('--verbose', 'Enable verbose logging')
  .action(async (path, options) => {
    const { runGenerateCapability } = await import('./generate-capability.js');
    await runGenerateCapability({ ...options, path });
  });

program.parse();