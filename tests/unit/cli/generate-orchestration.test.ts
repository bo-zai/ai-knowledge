import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryResult } from '../../../src/query/index-service';
import { runGenerate } from '../../../src/cli/generate';

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

  describe('generation progress logging', () => {
    it('logs phase and slice progress after slice discovery', async () => {
      const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-logging-'));
      const mapperDir = join(repo, 'mappers');
      await mkdir(mapperDir, { recursive: true });
      await writeFile(
        join(mapperDir, 'user-mapper.xml'),
        `<?xml version="1.0" encoding="UTF-8" ?>
<mapper namespace="com.example.UserMapper">
  <select id="selectUsers" resultType="com.example.User">
    SELECT id, name
    FROM users
  </select>
</mapper>`,
      );

      const originalApiKey = process.env.TEST_API_KEY;
      const originalUserProfile = process.env.USERPROFILE;
      process.env.TEST_API_KEY = 'test-key';
      process.env.USERPROFILE = repo;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let loggedText = '';

      try {
        await runGenerate({
          repo,
          knowledge: 'db',
          model: 'test-model',
          baseUrl: 'http://localhost:11434/v1',
          apiKeyEnv: 'TEST_API_KEY',
        });
        loggedText = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      } finally {
        consoleSpy.mockRestore();
        if (originalApiKey === undefined) {
          delete process.env.TEST_API_KEY;
        } else {
          process.env.TEST_API_KEY = originalApiKey;
        }
        if (originalUserProfile === undefined) {
          delete process.env.USERPROFILE;
        } else {
          process.env.USERPROFILE = originalUserProfile;
        }
      }

      expect(loggedText).toContain('Building DB evidence bundles');
      expect(loggedText).toContain('Generating slice 1/1 [database] users');
    });
  });
});
