import { Command } from 'commander';
import { ALL_KNOWLEDGE_TYPES } from '../schemas/knowledge-type.js';
import { getSupportedAgentIds } from '../skills/index.js';

const program = new Command();

const knowledgeOptions = [...ALL_KNOWLEDGE_TYPES.map(t => t.toLowerCase()), 'all', 'phase1', 'phase2'].join(', ');
const agentOptions = getSupportedAgentIds().join(', ');

program
  .name('rkg')
  .description('Generate ai-knowledge packages from embedded analysis + LLM')
  .version('0.1.0', '-v, --version', 'output the version number')
  .helpOption('-h, --help', 'display help for command');

program
  .command('generate [path]')
  .description('Generate ai-knowledge package. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .option(`--knowledge <type>`, `Knowledge type to generate: ${knowledgeOptions}. Defaults to all.`)
  .option('--target <selector>', 'Generate one target, for example concept:order-status or capability:user-management')
  .option('--out <path>', 'Output directory (defaults to target repo root)')
  .option('--llm-config <path>', 'Path to JSON LLM config file')
  .option('--force-analyze', 'Force embedded analysis re-run')
  .option('--no-init-skills', 'Skip automatic skill initialization')
  .option('--verbose', 'Enable verbose logging')
  .option('--log-file <path>', 'Write logs to file (for debugging)')
  .action(async (path, options) => {
    const { runGenerate } = await import('./generate.js');
    await runGenerate({ ...options, path });
  });

program
  .command('init-skills [path]')
  .description('Initialize AI Agent skills for the project. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .option(`--agents <ids>`, `Agents to initialize: ${agentOptions}. Defaults to claude-code.`)
  .option('--force', 'Force re-initialization even if skills exist')
  .option('--no-update-agents-md', 'Skip updating AGENTS.md')
  .option('--verbose', 'Enable verbose logging')
  .action(async (path, options) => {
    const { runInitSkills } = await import('./init-skills.js');
    await runInitSkills({ ...options, path });
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
  .description('Remove ai-knowledge package. If no path specified, uses current directory.')
  .option('--repo <path>', 'Target repository path (overrides positional argument)')
  .action(async (path, options) => {
    const { runClean } = await import('./clean.js');
    await runClean({ ...options, path });
  });

program.parseAsync();