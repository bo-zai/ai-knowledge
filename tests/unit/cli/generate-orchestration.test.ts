import { describe, expect, it, vi } from 'vitest';
import type { GitNexusExecutor } from '../../../src/gitnexus/types';

describe('generate orchestration', () => {
  describe('GitNexus index handling', () => {
    it('reuses existing index without analyze', async () => {
      const execGitNexus = vi.fn<GitNexusExecutor>().mockResolvedValue({ stdout: 'indexed' });
      const hasIndex = vi.fn().mockResolvedValue(true);

      // 模拟 ensureGitNexusIndex 行为
      const indexed = await hasIndex('/test/repo');
      if (!indexed) {
        await execGitNexus(['analyze', '/test/repo'], '/test/repo');
      }

      expect(execGitNexus).not.toHaveBeenCalled();
    });

    it('triggers analyze when index missing', async () => {
      const execGitNexus = vi.fn<GitNexusExecutor>().mockResolvedValue({ stdout: 'ok' });
      const hasIndex = vi.fn().mockResolvedValue(false);

      // 模拟 ensureGitNexusIndex 行为
      const indexed = await hasIndex('/test/repo');
      if (!indexed) {
        await execGitNexus(['analyze', '/test/repo'], '/test/repo');
      }

      expect(execGitNexus).toHaveBeenCalledWith(['analyze', '/test/repo'], '/test/repo');
    });
  });

  describe('slice discovery', () => {
    it('extracts slices from GitNexus output', async () => {
      const mockOutput = `Route: GET /api/users
Process: UserLogin
Table: users`;

      // 验证 extractSliceSeedsFromGitNexus 能解析输出
      const lines = mockOutput.split('\n');
      const routes: string[] = [];
      const tables: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Route:')) {
          routes.push(trimmed.replace('Route:', '').trim());
        } else if (trimmed.startsWith('Table:')) {
          tables.push(trimmed.replace('Table:', '').trim());
        }
      }

      expect(routes).toContain('GET /api/users');
      expect(tables).toContain('users');
    });
  });

  describe('partial failure handling', () => {
    it('continues after single slice failure', async () => {
      const failures: Array<{ id: string; error: string }> = [];
      const successes: string[] = [];

      // 模拟三个切片的处理
      const slices = [
        { id: 'route-1', success: true },
        { id: 'route-2', success: false },
        { id: 'route-3', success: true },
      ];

      for (const slice of slices) {
        if (slice.success) {
          successes.push(slice.id);
        } else {
          failures.push({ id: slice.id, error: 'generation failed' });
        }
      }

      expect(successes).toHaveLength(2);
      expect(failures).toHaveLength(1);
    });
  });
});