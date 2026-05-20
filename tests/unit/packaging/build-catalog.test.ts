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
});