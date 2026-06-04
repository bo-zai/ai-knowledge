import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { GenerateKnowledge, GenerateTarget } from '../knowledge/generate-scope.js';
import type { KnowledgePackageContribution } from './knowledge-package-contribution.js';
import type { PackageLayout } from '../knowledge/init-directory.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';
import { generateEntryFiles } from './entry-files-generator.js';
import { getRepoBasename } from '../shared/path-utils.js';

export async function writeKnowledgePackage(input: {
  layout: PackageLayout;
  knowledge: GenerateKnowledge;
  target?: GenerateTarget;
  contributions: KnowledgePackageContribution[];
}): Promise<void> {
  const packageRoot = input.layout.packageRoot;

  // Collect primary docs and supporting material paths
  const allFiles = input.contributions.flatMap(contribution => contribution.files);
  const primaryCapabilityDocs = allFiles
    .filter(file => file.path.startsWith('capabilities/') && file.path.endsWith('.md'))
    .map(file => file.path)
    .sort();
  const compatibilityViews = allFiles
    .filter(file => file.path.startsWith('views/capabilities/') && file.path.endsWith('.md'))
    .map(file => file.path)
    .sort();

  const objects = input.contributions.flatMap(contribution => contribution.objects);
  const catalog: Record<string, unknown> = {
    version: 1,
    entry: {
      summary: `ai-knowledge is a generated capability knowledge package for coding agents.`,
      primary_docs: primaryCapabilityDocs,
      compatibility_views: compatibilityViews,
      supporting_material: {
        objects: 'objects/**',
        evidence: 'evidence/index.jsonl',
        reports: 'reports/**',
        debug: 'debug/**',
      },
      agent_must: [
        'read matching capabilities/*.md before planning capability changes',
        'use evidence refs for key claims',
        'stop when unknown boundaries block implementation or validation',
      ],
    },
    generation: {
      knowledge: input.knowledge,
      target: input.target ?? null,
    },
    retrieval_order: {
      db_context: ['DB'],
      capability_context: ['CAP', 'TERM', 'FLOW', 'CON', 'MOD', 'VER', 'OPEN'],
    },
    objects: Object.fromEntries(objects.map(object => [
      object.id,
      { type: object.type, path: object.path, slice_ids: object.sliceIds ?? [] },
    ])),
    capability_docs: primaryCapabilityDocs,
    unknown_escalation_rules: [
      { if_no_term_match_for_core_noun: true },
      { if_external_system_has_no_contract: true },
      { if_no_verification_object_for_capability: true },
      { if_ownership_conflict_detected: true },
    ],
  };

  await fs.writeFile(path.join(packageRoot, 'catalog.yaml'), YAML.stringify(catalog), 'utf-8');

  const report = {
    knowledge: input.knowledge,
    target: input.target ?? null,
    stages: Object.fromEntries(input.contributions.map(contribution => [contribution.stage, contribution.report])),
    warnings: input.contributions.flatMap(contribution => contribution.warnings),
  };

  await fs.mkdir(path.join(packageRoot, 'reports'), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'reports', 'generation.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8',
  );

  // Generate entry files (AGENT.md and index.md)
  const repoName = getRepoBasename(input.layout.packageRoot.replace(`/${DEFAULT_KNOWLEDGE_DIR}`, '').replace(`\\${DEFAULT_KNOWLEDGE_DIR}`, ''));
  const entryFiles = await generateEntryFiles({
    repoName,
    outputRoot: packageRoot,
    contributions: input.contributions,
    generatedAt: new Date().toISOString(),
  });

  for (const file of entryFiles) {
    const fullPath = path.join(packageRoot, file.path);
    await fs.writeFile(fullPath, file.content, 'utf-8');
  }

  for (const contribution of input.contributions) {
    for (const file of contribution.files) {
      if (file.path === 'catalog.yaml' || file.path === 'reports/generation.json') {
        continue;
      }
      const fullPath = path.join(packageRoot, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
    }
  }
}
