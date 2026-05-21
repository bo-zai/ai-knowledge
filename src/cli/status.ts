import { fileExists, readText } from '../shared/fs.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';
import YAML from 'yaml';

export async function runStatus(repoPath: string): Promise<void> {
  const bootstrapDir = DEFAULT_BOOTSTRAP_DIR;
  const manifestPath = `${repoPath}/${bootstrapDir}/manifest.yaml`;
  const catalogPath = `${repoPath}/${bootstrapDir}/catalog.yaml`;
  const coveragePath = `${repoPath}/${bootstrapDir}/reports/coverage-report.yaml`;

  const exists = await fileExists(manifestPath);

  if (!exists) {
    console.log(`bootstrap-knowledge: missing`);
    console.log(`Path: ${repoPath}/${bootstrapDir}`);
    console.log(`To generate, run: repo-knowledge-generator generate --repo ${repoPath}`);
    return;
  }

  try {
    // 解析 manifest
    const manifestContent = await readText(manifestPath);
    const manifest = YAML.parse(manifestContent) as Record<string, unknown>;

    console.log(`bootstrap-knowledge: present`);
    console.log(`Path: ${repoPath}/${bootstrapDir}`);
    console.log('');
    console.log('=== Manifest ===');
    console.log(`Schema Version: ${manifest.schema_version}`);
    console.log(`Knowledge Pack Type: ${manifest.knowledge_pack_type}`);
    console.log(`Repo ID: ${manifest.repo_id}`);
    console.log(`Generated At: ${manifest.generated_at}`);
    console.log(`Analysis Version: ${manifest.analysis_version}`);
    console.log(`Object Types: ${(manifest.object_types as string[])?.join(', ') ?? 'unknown'}`);

    // 解析 catalog
    const catalogExists = await fileExists(catalogPath);
    if (catalogExists) {
      const catalogContent = await readText(catalogPath);
      const catalog = YAML.parse(catalogContent) as Record<string, unknown>;

      console.log('');
      console.log('=== Catalog ===');
      const retrievalOrder = catalog.retrieval_order as string[] ?? [];
      const objects = catalog.objects as Record<string, unknown> ?? {};

      console.log(`Total Objects: ${Object.keys(objects).length}`);
      console.log(`Retrieval Order: ${retrievalOrder.length} items`);

      // 按类型统计
      const typeCounts: Record<string, number> = {};
      for (const obj of Object.values(objects)) {
        if (obj && typeof obj === 'object' && 'type' in obj) {
          const type = obj.type as string;
          typeCounts[type] = (typeCounts[type] ?? 0) + 1;
        }
      }

      console.log('Object Counts by Type:');
      for (const [type, count] of Object.entries(typeCounts)) {
        console.log(`  ${type}: ${count}`);
      }
    }

    // 解析 coverage report
    const coverageExists = await fileExists(coveragePath);
    if (coverageExists) {
      const coverageContent = await readText(coveragePath);
      const coverage = YAML.parse(coverageContent) as Record<string, unknown>;

      console.log('');
      console.log('=== Coverage Report ===');
      console.log(`Success Rate: ${coverage.success_rate ?? 'unknown'}`);

      const failures = coverage.failures as Array<Record<string, unknown>> ?? [];
      if (failures.length > 0) {
        console.log(`Failures: ${failures.length}`);
        console.log('Failed Objects:');
        for (const failure of failures) {
          console.log(`  - ${failure.id} (${failure.type}): ${failure.error}`);
        }
      }

      const warnings = coverage.warnings as Array<Record<string, unknown>> ?? [];
      if (warnings.length > 0) {
        console.log(`Warnings: ${warnings.length}`);
      }

      // 显示是否为 partial 状态
      if (failures.length > 0) {
        console.log('');
        console.log('STATUS: partial (some objects failed to generate)');
      } else {
        console.log('');
        console.log('STATUS: complete');
      }
    }

  } catch (error) {
    console.log(`bootstrap-knowledge: error reading package`);
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}