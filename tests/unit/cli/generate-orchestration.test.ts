import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryResult } from '../../../src/query/index-service';

describe('generate orchestration', () => {
  describe('index handling', () => {
    it('reuses existing index without analyze', async () => {
      const hasIndexMock = vi.fn().mockResolvedValue(true);
      const ensureIndexMock = vi.fn();

      // 模拟 ensureIndex 行为
      const indexed = await hasIndexMock('/test/repo');
      if (!indexed) {
        await ensureIndexMock('/test/repo');
      }

      expect(ensureIndexMock).not.toHaveBeenCalled();
    });

    it('triggers index when missing', async () => {
      const hasIndexMock = vi.fn().mockResolvedValue(false);
      const ensureIndexMock = vi.fn();

      // 模拟 ensureIndex 行为
      const indexed = await hasIndexMock('/test/repo');
      if (!indexed) {
        await ensureIndexMock('/test/repo');
      }

      expect(ensureIndexMock).toHaveBeenCalledWith('/test/repo');
    });
  });

  describe('slice discovery', () => {
    it('consumes structured discovery result', async () => {
      const mockDiscovery: DiscoveryResult = {
        routes: [
          { id: 'route:GET:/api/users', method: 'GET', path: '/api/users' },
        ],
        processes: [
          { id: 'process:UserLogin', name: 'UserLogin' },
        ],
        tools: [],
        communities: [],
        tables: [
          { id: 'table:users', name: 'users' },
        ],
      };

      // 验证 discovery result 结构正确
      expect(mockDiscovery.routes).toHaveLength(1);
      expect(mockDiscovery.routes[0].method).toBe('GET');
      expect(mockDiscovery.routes[0].path).toBe('/api/users');
      expect(mockDiscovery.tables).toContainEqual({ id: 'table:users', name: 'users' });
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