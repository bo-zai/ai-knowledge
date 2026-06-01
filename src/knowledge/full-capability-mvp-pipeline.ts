import { buildCapabilityMvpInventory } from '../slicing/capability-mvp-inventory.js';
import {
  runCapabilityKnowledgePipeline,
  type CapabilityClaimsProviderResult,
} from './capability-knowledge-pipeline.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import type { KnowledgePackageFile, KnowledgePackageObjectRef } from '../packaging/knowledge-package-contribution.js';

export interface FullCapabilityMvpCapabilityReport {
  id: string;
  name: string;
  status: 'succeeded' | 'failed';
  capabilityId?: string;
  primaryDoc?: string;
  compatibilityView?: string;
  objectCount?: number;
  error?: string;
}

export interface FullCapabilityMvpResult {
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: {
    mode: 'full-mvp';
    succeeded: number;
    failed: number;
    capabilities: FullCapabilityMvpCapabilityReport[];
  };
  warnings: string[];
}

function rewriteFullCapabilityFilePath(path: string, inventoryId: string): string | undefined {
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

export async function runFullCapabilityMvpPipeline(input: {
  repoRoot: string;
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  model?: string;
}): Promise<FullCapabilityMvpResult> {
  // Auto-discover project capabilities
  const inventory = await buildCapabilityMvpInventory(input.repoRoot);

  if (inventory.length === 0) {
    throw new Error('No business capabilities discovered in project. Use --target or --terms to specify capability focus.');
  }
  const files: KnowledgePackageFile[] = [];
  const objects: KnowledgePackageObjectRef[] = [];
  const capabilities: FullCapabilityMvpCapabilityReport[] = [];
  const warnings: string[] = [];

  for (const item of inventory) {
    try {
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoRoot,
        targetTerms: item.targetTerms,
        targetPaths: item.targetPaths,
        claimsProvider: input.claimsProvider,
        llmMode: { requested: true, required: true, model: input.model },
      });

      const primaryDoc = result.files.find(file => file.path.startsWith('capabilities/') && file.path.endsWith('.md'))?.path;
      const compatibilityView = result.files.find(file => file.path.startsWith('views/capabilities/') && file.path.endsWith('.md'))?.path;

      for (const file of result.files) {
        const rewritten = rewriteFullCapabilityFilePath(file.path, item.id);
        if (!rewritten) continue;
        files.push({ path: rewritten, content: file.content });
      }

      objects.push(...result.objects.map(obj => ({
        id: obj.id,
        type: obj.type,
        path: `objects/${obj.type.toLowerCase()}/${obj.id}.yaml`,
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
    throw new Error(`Full capability MVP generation failed for all ${inventory.length} capabilities`);
  }

  const report = {
    mode: 'full-mvp' as const,
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