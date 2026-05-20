import { describe, expect, it } from 'vitest';
import { execa } from 'execa';

describe('cli smoke test', () => {
  it('prints help successfully', async () => {
    const result = await execa('node', ['dist/cli/index.js', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('generate');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('clean');
  });
});