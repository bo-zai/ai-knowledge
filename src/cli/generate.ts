import path from 'path';
import { logger, setLogLevel, setLogFile, closeLogFile } from '../shared/logger.js';
import { getEnvVar, getEnvVarOptional } from '../config/env.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';
import {
  resolveModelConfig,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
} from '../config/model-config.js';
import type { ModelConfig } from '../config/model-config.js';
import { resolveTargetRepo } from '../shared/resolve-target-repo.js';
import { resolveGenerateScope } from '../knowledge/generate-scope.js';
import {
  runGenerateOrchestration,
  type GenerateOrchestrationInput,
  type GenerateOrchestrationDeps,
  type GenerateTypeInput,
} from '../knowledge/generate-orchestrator.js';
import { runKnowledgeGeneratorForGroups, type LlmClaimsProvider } from '../generation/knowledge-generator.js';
import { buildEvidenceBundlesByPackage } from '../evidence/type-evidence-builder.js';
import { writeKnowledgePackage } from '../packaging/knowledge-package-writer.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';
import { initGraphData } from '../query/prepare-generation.js';
import { initDirectoryStructure } from '../knowledge/init-directory.js';
import { createOpenAiClient, generateWithClient } from '../generation/llm-client.js';

function isMockModel(model: string): boolean {
  return model.startsWith('test-');
}

interface GenerateOptions {
  repo?: string;
  path?: string;
  knowledge?: string;
  target?: string;
  out?: string;
  llmConfig?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  forceAnalyze?: boolean;
  verbose?: boolean;
  logFile?: string;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  if (options.verbose) {
    setLogLevel('debug');
  }

  // 设置日志文件
  if (options.logFile) {
    const logPath = path.resolve(options.logFile);
    setLogFile(logPath);
    logger.info(`Logging to file: ${logPath}`);
  }

  // Resolve target repo path
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;
  logger.debug(`Resolved repo path from ${resolved.source}: ${repoPath}`);

  // Resolve generation scope
  const scope = resolveGenerateScope({
    knowledge: options.knowledge,
    target: options.target,
  });

  for (const warning of scope.warnings) {
    logger.warn(warning);
  }

  // Load model config
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile(repoPath);

  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });

  const apiKey = resolvedConfig.apiKey || getEnvVarOptional(resolvedConfig.apiKeyEnv) || '';
  const modelConfig: ModelConfig = {
    baseUrl: resolvedConfig.baseUrl,
    apiKey,
    apiKeyEnv: resolvedConfig.apiKeyEnv,
    model: resolvedConfig.model,
  };
  const mockMode = isMockModel(modelConfig.model);

  logger.info(`Generating ai-knowledge for ${repoPath}`);
  logger.info(`Knowledge types: ${scope.types.join(', ')}`);
  if (scope.target) {
    logger.info(`Target: ${scope.target.kind}:${scope.target.value}`);
  }

  const outputRoot = options.out ? path.resolve(options.out) : repoPath;

  // Initialize graph data
  const graphStatus = await initGraphData({
    repoPath,
    forceAnalyze: options.forceAnalyze,
    mockMode,
  });
  logger.info(`Graph status: ${graphStatus.status}, nodes: ${graphStatus.nodeCount}`);

  // Initialize directory structure
  const layout = await initDirectoryStructure(outputRoot);

  // Build deps for orchestration
  const deps: GenerateOrchestrationDeps = {
    runGeneratorForType: async (input: GenerateTypeInput): Promise<KnowledgePackageContribution[]> => {
      const { type, target, verbose } = input;

      // Build evidence bundles grouped by package
      const evidenceGroups = await buildEvidenceBundlesByPackage({
        repoPath: input.repoPath,
        type,
        target,
        graphStatus: input.graphStatus,
      });

      if (evidenceGroups.length === 0) {
        logger.warn(`No evidence found for ${type}`);
        return [{
          stage: type.toLowerCase(),
          files: [],
          objects: [],
          report: {
            stage: type.toLowerCase(),
            ran: true,
            succeeded: 0,
            failed: 1,
            details: { error: 'no_evidence_found' },
          },
          warnings: ['no_evidence_found'],
        }];
      }

      // Create LLM client using OpenAI-compatible format
      const clientConfig: ModelConfig = {
        baseUrl: input.llm.baseUrl || modelConfig.baseUrl,
        apiKey: apiKey,
        model: input.llm.model || modelConfig.model,
        apiKeyEnv: input.llm.apiKeyEnv || modelConfig.apiKeyEnv,
      };
      const client = createOpenAiClient(clientConfig);

      // Create claims provider using llm-client
      const claimsProvider: LlmClaimsProvider = async (systemPrompt, userPrompt) => {
        const result = await generateWithClient(client, clientConfig.model, systemPrompt, userPrompt);
        return {
          rawText: result.text,
          model: clientConfig.model,
          usage: {
            promptTokens: 0,
            completionTokens: result.chunks,
          },
        };
      };

      // Run generator for all evidence groups (parallel)
      return runKnowledgeGeneratorForGroups(input, evidenceGroups, claimsProvider);
    },

    writePackage: async (input) => {
      await writeKnowledgePackage({
        layout: input.layout,
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
    graphStatus,
    layout,
    forceAnalyze: options.forceAnalyze,
    verbose: options.verbose,
    llm: {
      model: options.model,
      baseUrl: options.baseUrl,
      apiKeyEnv: options.apiKeyEnv,
      llmConfig: options.llmConfig,
    },
  };

  await runGenerateOrchestration({
    input: orchestrationInput,
    deps,
  });

  logger.info(`ai-knowledge generated at ${path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR)}`);
  closeLogFile();
}