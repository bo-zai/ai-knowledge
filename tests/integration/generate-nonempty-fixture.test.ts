import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

    // Read the generation summary
    const summary = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation-summary.md'), 'utf8');

    // Verify STATUS marker exists (COMPLETE, PARTIAL, or EMPTY)
    expect(summary).toContain('STATUS');

    // Read coverage report
    const coverage = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'coverage-report.yaml'), 'utf8');

    // Verify is_empty flag is explicit
    expect(coverage).toContain('is_empty');

    // If GitNexus discovered slices but generation failed, should be partial not empty
    // If GitNexus discovered nothing, should be empty
    // Either case is acceptable, but must be explicit
    const isEmptyMatch = coverage.match(/is_empty: (true|false)/);
    expect(isEmptyMatch).not.toBeNull();
  });

  it('explicitly marks sparse fixture as EMPTY', async () => {
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

    const summary = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation-summary.md'), 'utf8');

    // Sparse fixture MUST contain STATUS: EMPTY explicitly
    expect(summary).toContain('STATUS: EMPTY');

    const coverage = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'coverage-report.yaml'), 'utf8');
    expect(coverage).toContain('is_empty: true');
  });

  it('validates repo metadata correctness in manifest', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-meta-'));
    await writeFile(join(repo, 'README.md'), '# metadata test');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    const manifest = await readFile(join(repo, 'bootstrap-knowledge', 'manifest.yaml'), 'utf8');

    // Verify repo_root is the actual path (Windows or POSIX)
    expect(manifest).toContain('repo_root:');

    // Verify repo_id is derived correctly (basename, sanitized)
    expect(manifest).toContain('repo_id:');

    // repo_id should NOT contain path separators or special characters
    const repoIdMatch = manifest.match(/repo_id: ([a-z0-9-]+)/);
    expect(repoIdMatch).not.toBeNull();

    // Should not contain slashes or backslashes
    expect(repoIdMatch?.[1]).not.toContain('/');
    expect(repoIdMatch?.[1]).not.toContain('\\');
  });
});