import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { copyFile, mkdir } from 'node:fs/promises';

async function createGitRepo(repo: string): Promise<void> {
  await execa('git', ['init'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: repo });
}

describe('generate end-to-end', () => {
  it('writes bootstrap-knowledge package to target repo', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-e2e-'));
    await writeFile(join(repo, 'README.md'), '# test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.cjs', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // 检查 manifest.yaml 存在
    const manifest = await readFile(join(repo, 'bootstrap-knowledge', 'manifest.yaml'), 'utf8');
    expect(manifest).toContain('schema_version');
    expect(manifest).toContain('knowledge_pack_type: bootstrap');

    // 检查 catalog.yaml 存在且包含统计信息
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('retrieval_order');
    expect(catalog).toContain('total_object_count');
  });

  it('keeps package generation alive when no objects are generated', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-empty-'));
    await writeFile(join(repo, 'README.md'), '# empty repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.cjs', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    const summary = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation-summary.md'), 'utf8');
    expect(summary).toContain('Generation Summary');
    expect(summary).toContain('**Total Objects:** 0');

    // 检查 STATUS 标记
    expect(summary).toContain('STATUS');
  });

  it('writes coverage-report.yaml with partial failure details', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-coverage-'));
    await writeFile(join(repo, 'README.md'), '# coverage test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.cjs', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    const coverage = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'coverage-report.yaml'), 'utf8');
    expect(coverage).toContain('success_rate');
    expect(coverage).toContain('is_partial');
    expect(coverage).toContain('is_empty');
  });

  it('writes object-stats.yaml with detailed statistics', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-stats-'));
    await writeFile(join(repo, 'README.md'), '# stats test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.cjs', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    const stats = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'object-stats.yaml'), 'utf8');
    expect(stats).toContain('generated_at');
    expect(stats).toContain('summary');
    expect(stats).toContain('by_type');
  });
});