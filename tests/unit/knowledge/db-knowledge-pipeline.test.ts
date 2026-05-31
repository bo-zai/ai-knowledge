import { describe, expect, it } from 'vitest';
import { buildDbStageReport } from '../../../src/knowledge/db-knowledge-pipeline';

describe('buildDbStageReport', () => {
  it('reports db stage counts and target', () => {
    expect(buildDbStageReport({ succeeded: 1, failed: 0, targetTable: 'users' })).toEqual({
      stage: 'db',
      ran: true,
      succeeded: 1,
      failed: 0,
      details: { targetTable: 'users' },
    });
  });
});
