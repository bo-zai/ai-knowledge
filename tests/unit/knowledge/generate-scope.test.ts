import { describe, expect, it } from 'vitest';
import { resolveGenerateScope } from '../../../src/knowledge/generate-scope';

describe('resolveGenerateScope', () => {
  it('defaults to all knowledge when no selector is provided', () => {
    expect(resolveGenerateScope({})).toEqual({
      knowledge: 'all',
      inferred: true,
      inferredFrom: 'default',
      target: undefined,
      legacyArgsUsed: [],
      warnings: [],
    });
  });

  it('accepts db knowledge without target', () => {
    expect(resolveGenerateScope({ knowledge: 'db' }).knowledge).toBe('db');
  });

  it('accepts capability knowledge without target', () => {
    expect(resolveGenerateScope({ knowledge: 'capability' }).knowledge).toBe('capability');
  });

  it('parses db target for db knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'db', target: 'users' }).target).toEqual({
      kind: 'db',
      value: 'users',
    });
  });

  it('parses capability target for capability knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'capability', target: 'order' }).target).toEqual({
      kind: 'capability',
      value: 'order',
    });
  });

  it('requires typed target for all knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'all', target: 'users' })).toThrow(
      '--target must use db:<name> or capability:<name> when --knowledge all is used',
    );
  });

  it('allows typed db target for all knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'all', target: 'db:users' }).target).toEqual({
      kind: 'db',
      value: 'users',
    });
  });

  it('allows typed capability target for all knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'all', target: 'capability:order' }).target).toEqual({
      kind: 'capability',
      value: 'order',
    });
  });

  it('rejects capability target for db knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'db', target: 'capability:order' })).toThrow(
      '--knowledge db cannot use capability target',
    );
  });

  it('rejects db target for capability knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'capability', target: 'db:users' })).toThrow(
      '--knowledge capability cannot use db target',
    );
  });

  it('infers capability knowledge from legacy --terms', () => {
    const result = resolveGenerateScope({ terms: ['order'] });
    expect(result.knowledge).toBe('capability');
    expect(result.inferred).toBe(true);
    expect(result.inferredFrom).toBe('legacy');
    expect(result.target).toEqual({ kind: 'capability', value: 'order' });
  });

  it('infers db knowledge from legacy --slice', () => {
    const result = resolveGenerateScope({ slice: 'database:users' });
    expect(result.knowledge).toBe('db');
    expect(result.inferred).toBe(true);
    expect(result.inferredFrom).toBe('legacy');
    expect(result.target).toEqual({ kind: 'db', value: 'users' });
  });

  it('explicit --knowledge overrides legacy inference', () => {
    const result = resolveGenerateScope({ knowledge: 'db', terms: ['order'] });
    expect(result.knowledge).toBe('db');
    expect(result.inferred).toBe(false);
    expect(result.inferredFrom).toBe('explicit');
  });
});
