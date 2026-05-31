import path from 'path';
import { logger, setLogLevel } from '../shared/logger.js';
import { getEnvVar, getEnvVarOptional } from '../config/env.js';
import {
  resolveModelConfig,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
} from '../config/model-config.js';
import { resolveTargetRepo } from '../shared/resolve-target-repo.js';
import { ensureIndex, hasIndex } from '../query/index-service.js';
import { createCapabilityLlmClaimsProvider } from '../generation/capability-llm-claims-provider.js';
import {
  runCapabilityKnowledgePipeline,
  capabilityResultToContribution,
  type CapabilityClaimsProviderResult,
} from '../knowledge/capability-knowledge-pipeline.js';
import { resolveGenerateScope } from '../knowledge/generate-scope.js';
import {
  runGenerateOrchestration,
  type GenerateOrchestrationInput,
  type GenerateOrchestrationDeps,
} from '../knowledge/generate-orchestrator.js';
import { runDbKnowledgePipeline } from '../knowledge/db-knowledge-pipeline.js';
import { writeKnowledgePackage } from '../packaging/knowledge-package-writer.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';

function parseCommaList(value?: string): string[] {
  return value
    ? value.split(',').map(item => item.trim()).filter(item => item.length > 0)
    : [];
}

function isMockModel(model: string): boolean {
  return model.startsWith('test-');
}

interface GenerateOptions {
  repo?: string;
  path?: string;
  knowledge?: string;
  target?: string;
  slice?: string;
  terms?: string;
  paths?: string;
  out?: string;
  llmConfig?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  forceAnalyze?: boolean;
  verbose?: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  if (options.verbose) {
    setLogLevel('debug');
  }

  // Resolve target repo path
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;
  logger.debug(`Resolved repo path from ${resolved.source}: ${repoPath}`);

  const targetTerms = parseCommaList(options.terms);
  const targetPaths = parseCommaList(options.paths);

  // Resolve generation scope
  const scope = resolveGenerateScope({
    knowledge: options.knowledge,
    target: options.target,
    terms: targetTerms.length > 0 ? targetTerms : undefined,
    paths: targetPaths.length > 0 ? targetPaths : undefined,
    slice: options.slice,
  });

  for (const warning of scope.warnings) {
    logger.warn(warning);
  }

  // Load model config
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile();

  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });
  const apiKey = resolvedConfig.apiKey || getEnvVar(resolvedConfig.apiKeyEnv);
  const modelConfig = {
    baseUrl: resolvedConfig.baseUrl,
    apiKey,
    apiKeyEnv: resolvedConfig.apiKeyEnv,
    model: resolvedConfig.model,
  };
  const mockMode = isMockModel(modelConfig.model);

  logger.info(`Generating bootstrap-knowledge for ${repoPath}`);
  logger.info(`Knowledge: ${scope.knowledge}${scope.inferred ? ' (default)' : ''}`);
  if (scope.target) {
    logger.info(`Target: ${scope.target.kind}:${scope.target.value}`);
  }

  const outputRoot = options.out ? path.resolve(options.out) : repoPath;

  // Build orchestration deps
  const deps: GenerateOrchestrationDeps = {
    runDb: async (input: GenerateOrchestrationInput) => {
      const dbTarget = input.scope.target?.kind === 'db' ? input.scope.target : undefined;
      return runDbKnowledgePipeline({
        repoPath: input.repoPath,
        target: dbTarget,
        forceAnalyze: input.forceAnalyze,
        verbose: input.verbose,
        modelConfig,
      });
    },

    runCapability: async (input: GenerateOrchestrationInput) => {
      // Resolve capability-specific LLM config using repo path (not project-level cwd)
      const capFileConfig = options.llmConfig
        ? await loadLlmConfigFile(options.llmConfig)
        : await loadDefaultLlmConfigFile(input.repoPath);

      const capResolvedConfig = resolveModelConfig({
        baseUrl: options.baseUrl,
        apiKeyEnv: options.apiKeyEnv,
        model: options.model,
        fileConfig: capFileConfig,
      });

      const capApiKey = capResolvedConfig.apiKey || getEnvVarOptional(capResolvedConfig.apiKeyEnv);
      if (!capApiKey) {
        throw new Error(
          `LLM API key is missing. Set ${capResolvedConfig.apiKeyEnv} environment variable or provide apiKey in config file.`,
        );
      }

      if (input.verbose) {
        console.log('Generating capability knowledge:');
        console.log(`  Repository: ${input.repoPath}`);
        console.log(`  LLM runtime: langgraph`);
        console.log(`  LLM model: ${capResolvedConfig.model}`);
      }

      await ensureIndex(input.repoPath);
      if (!(await hasIndex(input.repoPath))) {
        throw new Error(`No analysis index found for ${input.repoPath}. Run analysis first or use --force-analyze.`);
      }

      const provider = createCapabilityLlmClaimsProvider({
        model: capResolvedConfig.model,
        apiKey: capApiKey,
        baseUrl: capResolvedConfig.baseUrl,
      });

      const claimsProvider = async (bundle: EvidenceBundle): Promise<CapabilityClaimsProviderResult> => {
        const result = await provider(bundle);
        return {
          claims: result.claims,
          debug: {
            request: {
              model: result.model,
              systemPrompt: result.systemPrompt,
              userPrompt: result.userPrompt,
            },
            response: { rawText: result.rawText },
          },
          graphTrace: result.graphTrace,
        };
      };

      const capTerms = input.scope.target?.kind === 'capability' ? [input.scope.target.value] : targetTerms;
      const capPaths = targetPaths.length > 0 ? targetPaths : [];
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoPath,
        targetTerms: capTerms,
        targetPaths: capPaths,
        claimsProvider,
        llmMode: { requested: true, required: true, model: capResolvedConfig.model },
      });

      if (result.files.length === 0) {
        throw new Error(`No capability knowledge files generated for target repository: ${input.repoPath}`);
      }

      // Log capability generation summary
      console.log(`Generated ${result.files.length} files for capability: ${result.metadata.capabilityId}`);
      console.log(`Object types: ${result.objects.map(o => o.type).join(', ')}`);
      const llm = result.metadata.llm;
      console.log('LLM runtime: langgraph');
      console.log(`  Called: ${llm.called}, Succeeded: ${llm.succeeded}`);
      console.log(`  Claims: ${llm.rawClaimCount} raw, ${llm.acceptedClaimCount} accepted, ${llm.skeletonClaimCount} skeleton, ${llm.finalClaimCount} final`);
      if (llm.error) console.log(`  Error: ${llm.error}`);
      for (const warning of result.metadata.warnings) {
        console.warn(`Warning: ${warning}`);
      }

      return capabilityResultToContribution(result);
    },

    writePackage: async (input) => {
      await writeKnowledgePackage({
        outputRoot: input.outputRoot,
        knowledge: input.knowledge,
        target: input.target,
        contributions: input.contributions,
      });
    },
  };

  const orchestrationInput: GenerateOrchestrationInput = {
    repoPath,
    outputRoot,
    scope,
    forceAnalyze: options.forceAnalyze,
    verbose: options.verbose,
    llm: {
      model: options.model,
      baseUrl: options.baseUrl,
      apiKeyEnv: options.apiKeyEnv,
      llmConfig: options.llmConfig,
    },
  };

  const { contributions } = await runGenerateOrchestration({
    input: orchestrationInput,
    deps,
  });

  // Print summary
  for (const c of contributions) {
    const status = c.report.ran ? `${c.report.succeeded} succeeded, ${c.report.failed} failed` : 'skipped';
    logger.info(`${c.stage} stage: ${status}`);
  }

  logger.info(`Bootstrap-knowledge generated at ${path.join(outputRoot, 'bootstrap-knowledge')}`);
}
