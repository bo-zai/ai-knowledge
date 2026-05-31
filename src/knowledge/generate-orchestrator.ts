import { logger } from '../shared/logger.js';
import type { ResolvedGenerateScope } from './generate-scope.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';

export interface GenerateOrchestrationInput {
  repoPath: string;
  outputRoot: string;
  scope: ResolvedGenerateScope;
  forceAnalyze?: boolean;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
}

export interface GenerateOrchestrationDeps {
  runDb: (input: GenerateOrchestrationInput) => Promise<KnowledgePackageContribution>;
  runCapability: (input: GenerateOrchestrationInput) => Promise<KnowledgePackageContribution>;
  writePackage: (input: {
    outputRoot: string;
    knowledge: ResolvedGenerateScope['knowledge'];
    target: ResolvedGenerateScope['target'];
    contributions: KnowledgePackageContribution[];
  }) => Promise<void>;
}

function shouldRunDb(scope: ResolvedGenerateScope): boolean {
  if (scope.knowledge === 'db') return true;
  if (scope.knowledge === 'capability') return false;
  return !scope.target || scope.target.kind === 'db';
}

function shouldRunCapability(scope: ResolvedGenerateScope): boolean {
  if (scope.knowledge === 'capability') return true;
  if (scope.knowledge === 'db') return false;
  return !scope.target || scope.target.kind === 'capability';
}

function errorContribution(stage: 'db' | 'capability', error: string): KnowledgePackageContribution {
  return {
    stage,
    files: [],
    objects: [],
    report: { stage, ran: true, succeeded: 0, failed: 1, details: { error } },
    warnings: [error],
  };
}

export async function runGenerateOrchestration(input: {
  input: GenerateOrchestrationInput;
  deps: GenerateOrchestrationDeps;
}): Promise<{ contributions: KnowledgePackageContribution[] }> {
  const contributions: KnowledgePackageContribution[] = [];
  const { scope } = input.input;
  // Only suppress errors when the user didn't specify any generation params at all
  const suppressErrors = scope.inferred && scope.inferredFrom === 'default';

  if (shouldRunDb(scope)) {
    try {
      contributions.push(await input.deps.runDb(input.input));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`DB stage failed: ${msg}`);
      if (!suppressErrors) throw error;
      contributions.push(errorContribution('db', msg));
    }
  }

  if (shouldRunCapability(scope)) {
    try {
      contributions.push(await input.deps.runCapability(input.input));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Capability stage failed: ${msg}`);
      if (!suppressErrors) throw error;
      contributions.push(errorContribution('capability', msg));
    }
  }

  await input.deps.writePackage({
    outputRoot: input.input.outputRoot,
    knowledge: scope.knowledge,
    target: scope.target,
    contributions,
  });

  return { contributions };
}
