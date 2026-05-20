#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('repo-knowledge-generator')
  .description('Generate bootstrap-knowledge packages from GitNexus + LLM')
  .version('0.1.0');

program.command('generate').description('Generate bootstrap knowledge package');
program.command('status').description('Show package status');
program.command('clean').description('Remove bootstrap knowledge package');

program.parse();