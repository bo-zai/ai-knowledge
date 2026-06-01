import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { GenerateKnowledge, GenerateTarget } from '../knowledge/generate-scope.js';
import type { KnowledgePackageContribution } from './knowledge-package-contribution.js';

export async function writeKnowledgePackage(input: {
  outputRoot: string;
  knowledge: GenerateKnowledge;
  target?: GenerateTarget;
  contributions: KnowledgePackageContribution[];
}): Promise<void> {
  const packageRoot = path.resolve(input.outputRoot, 'bootstrap-knowledge');
  if (path.basename(packageRoot) !== 'bootstrap-knowledge') {
    throw new Error(`Refusing to clean invalid package root: ${packageRoot}`);
  }

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });

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
      summary: 'bootstrap-knowledge is a generated capability knowledge package for coding agents.',
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
