import path from 'path';
import {
  resolveModelConfig,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
} from '../config/model-config.js';
import { createCapabilityLlmClaimsProvider } from '../generation/capability-llm-claims-provider.js';
import { runCapabilityKnowledgePipeline, type CapabilityClaimsProviderResult } from '../knowledge/capability-knowledge-pipeline.js';
import { writeCapabilityKnowledgePackage } from '../packaging/capability-knowledge-writer.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';

function parseCommaList(value?: string): string[] {
  return value
    ? value.split(',').map(item => item.trim()).filter(item => item.length > 0)
    : [];
}

export interface RunGenerateCapabilityOptions {
  path?: string;
  repo?: string;
  terms?: string;
  paths?: string;
  out?: string;
  llmConfig?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  verbose?: boolean;
}

export async function runGenerateCapability(options: RunGenerateCapabilityOptions): Promise<void> {
  const { path: positionalPath, repo, terms, paths, out, verbose } = options;

  const repoPath = repo || positionalPath || '.';
  const resolvedRepoPath = path.resolve(repoPath);

  const targetTerms = parseCommaList(terms);
  const targetPaths = parseCommaList(paths);
  const outputRoot = out ? path.resolve(out) : resolvedRepoPath;

  if (verbose) {
    console.log('Generating capability knowledge:');
    console.log(`  Repository: ${resolvedRepoPath}`);
    console.log(`  Target terms: ${targetTerms.join(', ') || '(default)'}`);
    console.log(`  Target paths: ${targetPaths.join(', ') || '(default)'}`);
    console.log(`  Output: ${outputRoot}`);
    console.log(`  LLM runtime: langgraph`);
  }

  // Resolve model config - always required
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile(resolvedRepoPath);

  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });

  if (!resolvedConfig.apiKey) {
    throw new Error(
      `LLM API key is missing. Set ${resolvedConfig.apiKeyEnv} environment variable or provide apiKey in config file.`,
    );
  }

  if (verbose) {
    console.log(`  LLM model: ${resolvedConfig.model}`);
  }

  const provider = createCapabilityLlmClaimsProvider({
    model: resolvedConfig.model,
    apiKey: resolvedConfig.apiKey,
    baseUrl: resolvedConfig.baseUrl,
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
        response: {
          rawText: result.rawText,
        },
      },
      graphTrace: result.graphTrace,
    };
  };

  const result = await runCapabilityKnowledgePipeline({
    repoRoot: resolvedRepoPath,
    targetTerms,
    targetPaths,
    claimsProvider,
    llmMode: {
      requested: true,
      required: true,
      model: resolvedConfig.model,
    },
  });

  if (result.files.length === 0) {
    throw new Error(`No capability knowledge files generated for target repository: ${resolvedRepoPath}`);
  }

  await writeCapabilityKnowledgePackage({
    outputRoot,
    objects: result.objects,
    capabilityId: result.metadata.capabilityId,
    evidenceIndex: result.evidenceIndex,
    report: result.report,
    debug: result.debug,
  });

  console.log(`Generated ${result.files.length} files for capability: ${result.metadata.capabilityId}`);
  console.log(`Object types: ${result.objects.map(o => o.type).join(', ')}`);
  console.log(`Output directory: ${path.join(outputRoot, 'bootstrap-knowledge')}`);

  // Print LLM summary
  const llm = result.metadata.llm;
  console.log(`LLM runtime: langgraph`);
  console.log(`  Called: ${llm.called}, Succeeded: ${llm.succeeded}`);
  console.log(`  Claims: ${llm.rawClaimCount} raw, ${llm.acceptedClaimCount} accepted, ${llm.skeletonClaimCount} skeleton, ${llm.finalClaimCount} final`);
  if (llm.error) {
    console.log(`  Error: ${llm.error}`);
  }

  // Print warnings
  for (const warning of result.metadata.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}
