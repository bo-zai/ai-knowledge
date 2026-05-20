import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

describe('status command', () => {
  it('reports missing package before generation', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-'));
    await writeFile(join(repo, 'README.md'), '# test repo');
    const result = await execa('node', ['dist/cli/index.js', 'status', '--repo', repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bootstrap-knowledge');
    expect(result.stdout).toContain('missing');
  });
});