import { describe, expect, it, vi } from 'vitest';
import { ensureGitNexusIndex } from '../../../src/gitnexus/ensure-index';

describe('ensureGitNexusIndex', () => {
  it('runs analyze when index is missing', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'ok' });
    await ensureGitNexusIndex({ repoPath: '/tmp/repo', execGitNexus: exec, hasIndex: async () => false });
    expect(exec).toHaveBeenCalledWith(['analyze', '/tmp/repo'], '/tmp/repo');
  });

  it('skips analyze when index exists', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'ok' });
    await ensureGitNexusIndex({ repoPath: '/tmp/repo', execGitNexus: exec, hasIndex: async () => true });
    expect(exec).not.toHaveBeenCalled();
  });
});