import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { copyFile, mkdir } from 'node:fs/promises';

describe('generate end-to-end', () => {
  it('writes bootstrap-knowledge package to target repo', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-e2e-'));
    await writeFile(join(repo, 'README.md'), '# test repo');

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
    });

    expect(result.exitCode).toBe(0);

    // 检查 manifest.yaml 存在
    const manifest = await readFile(join(repo, 'bootstrap-knowledge', 'manifest.yaml'), 'utf8');
    expect(manifest).toContain('schema_version');
    expect(manifest).toContain('knowledge_pack_type: bootstrap');

    // 检查 catalog.yaml 存在
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('retrieval_order');
  });

  it('keeps package generation alive when no objects are generated', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-empty-'));
    await writeFile(join(repo, 'README.md'), '# empty repo');

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
    });

    expect(result.exitCode).toBe(0);

    const summary = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation-summary.md'), 'utf8');
    expect(summary).toContain('Generation Summary');
    expect(summary).toContain('**Total Objects:** 0');
  });
});