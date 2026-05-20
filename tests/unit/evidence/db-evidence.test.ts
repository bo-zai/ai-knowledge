import { describe, expect, it } from 'vitest';
import { mergeDbFieldSources } from '../../../src/evidence/db-evidence';

describe('mergeDbFieldSources', () => {
  it('prefers comment source over inferred source', () => {
    const fields = mergeDbFieldSources([
      { name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', description_source: 'comment', constraints: [] },
      { name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '用户编号', description_source: 'inferred', constraints: [] },
    ]);
    expect(fields[0].description_zh).toBe('主键');
    expect(fields[0].description_source).toBe('comment');
  });
});