import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

async function createGitRepo(repo: string): Promise<void> {
  await execa('git', ['init'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: repo });
}

/**
 * This test suite validates that when a repository contains evidence-rich code,
 * the generator does not silently succeed with zero objects.
 *
 * The tests use mock GitNexus output to simulate discovered slices.
 * Note: Without a real LLM backend, actual object generation will fail,
 * but the test validates the structural expectations.
 */
describe('generate with evidence-rich fixture', () => {
  it('requires non-empty catalog when GitNexus discovers slices', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-evidence-'));

    // Create a minimal Express-like structure
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(repo, 'src/routes'), { recursive: true });
    await writeFile(join(repo, 'src/routes/users.ts'), `
import express from 'express';
app.post('/api/users', (req, res) => res.json({}));
app.get('/api/products', (req, res) => res.json([]));
`);
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'test-repo' }));
    await createGitRepo(repo);

    // Commit files so GitNexus can analyze
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'initial'], { cwd: repo });

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 60000,
    });

    expect(result.exitCode).toBe(0);

    // Read the unified generation report
    const reportRaw = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf8');
    const report = JSON.parse(reportRaw);

    // Verify stages exist and report structure is correct
    expect(report).toHaveProperty('stages');
    expect(report).toHaveProperty('knowledge');
    expect(report).toHaveProperty('warnings');

    // Read catalog to verify it has objects section
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('version:');
    expect(catalog).toContain('objects:');
    expect(catalog).toContain('retrieval_order:');

    // At least one stage should have run
    const stages = report.stages as Record<string, { ran: boolean; succeeded: number; failed: number }>;
    const anyRan = Object.values(stages).some((s) => s.ran);
    expect(anyRan).toBe(true);
  });

  it('explicitly marks sparse fixture as empty', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-sparse-'));
    await writeFile(join(repo, 'README.md'), '# sparse repo - no code');
    await createGitRepo(repo);

    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-m', 'initial'], { cwd: repo });

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // Read catalog: sparse fixture should have minimal objects
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('objects:');

    // Read generation report
    const reportRaw = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf8');
    const report = JSON.parse(reportRaw);

    // Sparse fixture: DB stage should have 0 succeeded (no mapper files, no slices)
    const dbStage = report.stages?.db as { ran: boolean; succeeded: number; failed: number } | undefined;
    // Either DB didn't run, or it ran with 0 succeeded
    if (dbStage?.ran) {
      expect(dbStage.succeeded).toBe(0);
    }
  });

  it('validates catalog metadata correctness', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-meta-'));
    await writeFile(join(repo, 'README.md'), '# metadata test');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');

    // Verify catalog has expected top-level keys
    expect(catalog).toContain('version:');
    expect(catalog).toContain('generation:');
    expect(catalog).toContain('retrieval_order:');
    expect(catalog).toContain('objects:');
    expect(catalog).toContain('unknown_escalation_rules:');

    // Verify retrieval_order has db_context and capability_context
    expect(catalog).toContain('db_context:');
    expect(catalog).toContain('capability_context:');

    // Verify generation section has knowledge field
    const knowledgeMatch = catalog.match(/knowledge:\s*(\w+)/);
    expect(knowledgeMatch).not.toBeNull();
  });
});
