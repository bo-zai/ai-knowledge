import { describe, expect, it } from 'vitest';
import { buildRouteEvidence } from '../../../src/evidence/route-evidence';

describe('buildRouteEvidence', () => {
  it('creates slice evidence bundle for route', () => {
    const bundle = buildRouteEvidence({
      route: 'GET /api/users',
      handler_file: 'src/routes/users.ts',
      response_keys: ['id', 'name'],
      error_keys: ['error', 'message'],
      middleware: ['auth'],
    });
    expect(bundle.slice.kind).toBe('route');
    expect(bundle.slice.id).toBe('route:GET /api/users');
    expect(bundle.facts.length).toBeGreaterThanOrEqual(1);
  });
});