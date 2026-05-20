import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../../src/packaging/build-catalog';

describe('buildCatalog', () => {
  it('creates catalog with retrieval order and objects', () => {
    const catalog = buildCatalog({
      retrievalOrder: ['DB-users', 'MOD-handler'],
      objects: [
        { id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.md', slice_ids: ['db-users'] },
        { id: 'MOD-handler', type: 'MOD', path: 'objects/modules/MOD-handler.md', slice_ids: ['route:GET /users'] },
      ],
    });
    expect(catalog.retrieval_order).toHaveLength(2);
    expect(catalog.objects['DB-users']).toBeDefined();
    expect(catalog.objects['DB-users'].type).toBe('DB');
  });

  it('includes object counts by type', () => {
    const catalog = buildCatalog({
      retrievalOrder: ['DB-users', 'DB-orders', 'CON-auth'],
      objects: [
        { id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.md', slice_ids: ['db-users'] },
        { id: 'DB-orders', type: 'DB', path: 'objects/db/DB-orders.md', slice_ids: ['db-orders'] },
        { id: 'CON-auth', type: 'CON', path: 'objects/contracts/CON-auth.md', slice_ids: ['route:POST /auth'] },
      ],
    });
    expect(catalog.object_counts_by_type['DB']).toBe(2);
    expect(catalog.object_counts_by_type['CON']).toBe(1);
  });

  it('includes total object count', () => {
    const catalog = buildCatalog({
      retrievalOrder: ['DB-users', 'MOD-handler'],
      objects: [
        { id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.md', slice_ids: ['db-users'] },
        { id: 'MOD-handler', type: 'MOD', path: 'objects/modules/MOD-handler.md', slice_ids: ['route:GET /users'] },
      ],
    });
    expect(catalog.total_object_count).toBe(2);
  });

  it('includes schema version', () => {
    const catalog = buildCatalog({
      retrievalOrder: [],
      objects: [],
    });
    expect(catalog.schema_version).toBe(1);
  });

  it('includes status and maturity per object', () => {
    const catalog = buildCatalog({
      retrievalOrder: ['DB-users'],
      objects: [
        { id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.md', slice_ids: ['db-users'], status: 'fact', maturity: 'bootstrap' },
      ],
    });
    expect(catalog.objects['DB-users'].status).toBe('fact');
    expect(catalog.objects['DB-users'].maturity).toBe('bootstrap');
  });
});