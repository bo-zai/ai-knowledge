import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolMocks = vi.hoisted(() => ({
  initLbug: vi.fn(),
  initLbugWithDb: vi.fn(),
  executeQuery: vi.fn(),
  closeLbug: vi.fn(),
}));

vi.mock('../../../src/engine/lbug/pool-adapter.js', () => poolMocks);

import {
  initReadOnlyLbugWithDb,
  withReadOnlyLbug,
} from '../../../src/engine/lbug/read-only-session.js';

describe('withReadOnlyLbug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolMocks.initLbug.mockResolvedValue(undefined);
    poolMocks.initLbugWithDb.mockResolvedValue(undefined);
    poolMocks.executeQuery.mockResolvedValue([{ count: 1 }]);
    poolMocks.closeLbug.mockResolvedValue(undefined);
  });

  it('通过稳定的只读池执行查询', async () => {
    const dbPath = path.join('repo', '.knowledge', 'lbug');

    const rows = await withReadOnlyLbug(dbPath, query => query('MATCH (n) RETURN n'));

    const repoId = poolMocks.initLbug.mock.calls[0][0] as string;
    expect(rows).toEqual([{ count: 1 }]);
    expect(repoId).toBe(`read-only:${path.resolve(dbPath)}`);
    expect(poolMocks.initLbug).toHaveBeenCalledWith(repoId, dbPath);
    expect(poolMocks.executeQuery).toHaveBeenCalledWith(repoId, 'MATCH (n) RETURN n');
    expect(poolMocks.closeLbug).not.toHaveBeenCalled();
  });

  it('查询失败时保留池供后续查询复用', async () => {
    const dbPath = path.join('repo', '.knowledge', 'lbug');
    poolMocks.executeQuery.mockRejectedValue(new Error('query failed'));

    await expect(
      withReadOnlyLbug(dbPath, query => query('MATCH (n) RETURN n')),
    ).rejects.toThrow('query failed');

    expect(poolMocks.closeLbug).not.toHaveBeenCalled();
  });

  it('将分析阶段数据库句柄交给同一路径只读池', async () => {
    const dbPath = path.join('repo', '.knowledge', 'lbug');
    const db = {} as never;

    await initReadOnlyLbugWithDb(dbPath, db);

    expect(poolMocks.initLbugWithDb).toHaveBeenCalledWith(
      `read-only:${path.resolve(dbPath)}`,
      db,
      dbPath,
    );
  });
});
