import { describe, expect, it } from 'vitest';
import { dbObjectSchema } from '../../../src/schemas/db';

describe('schemas', () => {
  it('rejects db fields without chinese description source', () => {
    const bad = {
      id: 'DB-users',
      type: 'DB',
      title: 'users',
      status: 'fact',
      maturity: 'bootstrap',
      scope: 'db.users',
      repo: 'sample',
      slice_ids: ['db-users'],
      evidence_primary: ['schema.sql'],
      evidence_secondary: [],
      stale_if: [],
      generated_by: 'test',
      generated_at: '2026-05-20T00:00:00Z',
      table_name: 'users',
      table_name_zh: '用户表',
      schema_name: 'public',
      source_kind: 'ddl',
      primary_key: ['id'],
      indexes: [],
      foreign_keys: [],
      read_by: [],
      write_by: [],
      fields: [{ name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', constraints: [] }],
    };
    expect(() => dbObjectSchema.parse(bad)).toThrow();
  });
});