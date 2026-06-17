import { buildCapabilityInventory } from '../slicing/capability-inventory.js';
import {
  runCapabilityKnowledgePipeline,
  type CapabilityClaimsProviderResult,
} from './capability-knowledge-pipeline.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import type { KnowledgePackageFile, KnowledgePackageObjectRef } from '../packaging/knowledge-package-contribution.js';
import { TYPE_TO_DIR } from './type-directory-map.js';

export interface CapabilityBatchItemReport {
  id: string;
  name: string;
  status: 'succeeded' | 'failed';
  capabilityId?: string;
  primaryDoc?: string;
  compatibilityView?: string;
  objectCount?: number;
  error?: string;
}

export interface CapabilityBatchPipelineResult {
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: {
    mode: 'capability-batch';
    succeeded: number;
    failed: number;
    capabilities: CapabilityBatchItemReport[];
  };
  warnings: string[];
}

export interface CapabilityInventoryPromptResult {
  rawText: string;
  model: string;
}

function rewriteCapabilityFilePath(path: string, inventoryId: string): string | undefined {
  if (path === 'catalog.yaml') return undefined;
  if (path === 'reports/generation.json') return undefined;
  if (path === 'reports/capability-generation.json') {
    return `reports/capabilities/${inventoryId}.json`;
  }
  if (path.startsWith('debug/')) {
    return `debug/capabilities/${inventoryId}/${path.replace(/^debug\//, '')}`;
  }
  return path;
}

export async function runCapabilityBatchPipeline(input: {
  repoRoot: string;
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  inventoryPromptProvider?: (
    systemPrompt: string,
    userPrompt: string,
  ) => Promise<CapabilityInventoryPromptResult>;
  onItemSucceeded?: (item: {
    inventoryId: string;
    inventoryName: string;
    result: Awaited<ReturnType<typeof runCapabilityKnowledgePipeline>>;
  }) => Promise<void>;
  model?: string;
}): Promise<CapabilityBatchPipelineResult> {
  console.log('[DEBUG] runCapabilityBatchPipeline: starting');
  // 先做静态聚类，再按需交给 LLM 做业务域归并与核心/辅助动作判定。
  const inventory = await buildCapabilityInventory(
    input.repoRoot,
    input.inventoryPromptProvider,
  );
  console.log(`[DEBUG] runCapabilityBatchPipeline: inventory built, ${inventory.length} items`);

  if (inventory.length === 0) {
    throw new Error('No business capabilities discovered in project. Use --target or --terms to specify capability focus.');
  }
  const files: KnowledgePackageFile[] = [];
  const objects: KnowledgePackageObjectRef[] = [];
  const capabilities: CapabilityBatchItemReport[] = [];
  const warnings: string[] = [];

  for (const item of inventory) {
    console.log(`[DEBUG] runCapabilityBatchPipeline: processing ${item.name}`);
    try {
      console.log(`[DEBUG] runCapabilityBatchPipeline: calling runCapabilityKnowledgePipeline for ${item.name}`);
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoRoot,
        targetTerms: item.targetTerms,
        targetPaths: item.targetPaths,
        domainKey: item.id,
        domainName: item.name,
        modulePaths: item.targetPaths,
        claimsProvider: input.claimsProvider,
        llmMode: { requested: true, required: true, model: input.model },
      });
      console.log(`[DEBUG] runCapabilityBatchPipeline: runCapabilityKnowledgePipeline completed for ${item.name}`);

      if (input.onItemSucceeded) {
        await input.onItemSucceeded({
          inventoryId: item.id,
          inventoryName: item.name,
          result,
        });
      }

      const primaryDoc = result.files.find(file => file.path.startsWith('capabilities/') && file.path.endsWith('.md'))?.path;
      const compatibilityView = result.files.find(file => file.path.startsWith('views/capabilities/') && file.path.endsWith('.md'))?.path;

      for (const file of result.files) {
        const rewritten = rewriteCapabilityFilePath(file.path, item.id);
        if (!rewritten) continue;
        files.push({ path: rewritten, content: file.content });
      }

      objects.push(...result.objects.map(obj => ({
        id: obj.id,
        type: obj.type,
        path: `objects/${TYPE_TO_DIR[obj.type] || 'unknown'}/${obj.id}.yaml`,
      })));

      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'succeeded',
        capabilityId: result.metadata.capabilityId,
        primaryDoc,
        compatibilityView,
        objectCount: result.objects.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${item.id}: ${message}`);
      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'failed',
        error: message,
      });
    }
  }

  const succeeded = capabilities.filter(c => c.status === 'succeeded').length;
  const failed = capabilities.filter(c => c.status === 'failed').length;

  if (succeeded === 0) {
    throw new Error(`Capability batch generation failed for all ${inventory.length} capabilities`);
  }

  const report = {
    mode: 'capability-batch' as const,
    succeeded,
    failed,
    capabilities,
  };

  files.push({
    path: 'reports/capability-inventory.json',
    content: JSON.stringify({ inventory, report }, null, 2) + '\n',
  });

  return { files, objects, report, warnings };
}
