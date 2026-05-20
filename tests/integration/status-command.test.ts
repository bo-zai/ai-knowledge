import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

describe('status command', () => {
  it('reports missing package before generation', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-'));
    await writeFile(join(repo, 'README.md'), '# test repo');
    const result = await execa('node', ['dist/cli/index.cjs', 'status', '--repo', repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bootstrap-knowledge');
    expect(result.stdout).toContain('missing');
  });

  it('reports structured status when package exists', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-status-'));
    const bootstrapDir = join(repo, 'bootstrap-knowledge');
    const reportsDir = join(bootstrapDir, 'reports');

    await mkdir(bootstrapDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });

    // 创建模拟的 manifest.yaml
    await writeFile(join(bootstrapDir, 'manifest.yaml'), `
schema_version: 1
knowledge_pack_type: bootstrap
repo_id: test-repo
repo_root: ${repo}
generated_at: 2026-05-20T00:00:00Z
gitnexus_version: 1.0.0
object_types: [DB, CON, MOD]
`);

    // 创建模拟的 catalog.yaml
    await writeFile(join(bootstrapDir, 'catalog.yaml'), `
schema_version: 1
retrieval_order: [DB-users, CON-auth]
objects:
  DB-users:
    type: DB
    path: objects/db/DB-users.md
    slice_ids: [db-users]
    status: fact
    maturity: bootstrap
  CON-auth:
    type: CON
    path: objects/contracts/CON-auth.md
    slice_ids: [route:POST /auth]
    status: fact
    maturity: bootstrap
object_counts_by_type:
  DB: 1
  CON: 1
total_object_count: 2
`);

    // 创建模拟的 coverage-report.yaml
    await writeFile(join(reportsDir, 'coverage-report.yaml'), `
success_rate: 2/2
success_percentage: 100
failures: []
warnings: []
is_partial: false
is_empty: false
`);

    const result = await execa('node', ['dist/cli/index.cjs', 'status', '--repo', repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bootstrap-knowledge: present');
    expect(result.stdout).toContain('Manifest');
    expect(result.stdout).toContain('Catalog');
    expect(result.stdout).toContain('Total Objects: 2');
    expect(result.stdout).toContain('STATUS: complete');
  });

  it('reports partial status when failures exist', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-partial-'));
    const bootstrapDir = join(repo, 'bootstrap-knowledge');
    const reportsDir = join(bootstrapDir, 'reports');

    await mkdir(bootstrapDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });

    await writeFile(join(bootstrapDir, 'manifest.yaml'), `
schema_version: 1
knowledge_pack_type: bootstrap
repo_id: test-repo
generated_at: 2026-05-20T00:00:00Z
object_types: [DB, CON]
`);

    await writeFile(join(bootstrapDir, 'catalog.yaml'), `
retrieval_order: [DB-users]
objects:
  DB-users:
    type: DB
    path: objects/db/DB-users.md
    slice_ids: [db-users]
object_counts_by_type:
  DB: 1
total_object_count: 1
`);

    await writeFile(join(reportsDir, 'coverage-report.yaml'), `
success_rate: 1/2
success_percentage: 50
failures:
  - id: CON-auth
    type: CON
    error: validation failed
warnings: []
is_partial: true
`);

    const result = await execa('node', ['dist/cli/index.cjs', 'status', '--repo', repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('STATUS: partial');
    expect(result.stdout).toContain('Failures: 1');
  });
});