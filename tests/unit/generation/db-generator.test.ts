import { describe, expect, it } from 'vitest';
import { buildDbPrompt } from '../../../src/generation/object-generators/db-generator';

describe('buildDbPrompt', () => {
  it('returns system and user prompts', () => {
    const result = buildDbPrompt({ slice: { id: 'database:users', kind: 'database', title: 'users' } });
    expect(result.system).toContain('JSON');
    expect(result.user).toContain('DB');
  });

  it('emphasizes description_zh and description_source requirement', () => {
    const result = buildDbPrompt({ slice: { id: 'database:users', kind: 'database', title: 'users' } });
    expect(result.system).toContain('description_zh');
    expect(result.system).toContain('description_source');
  });

  it('includes output schema in user prompt', () => {
    const result = buildDbPrompt({ slice: { id: 'database:users', kind: 'database', title: 'users' } });
    expect(result.user).toContain('output_schema');
    expect(result.user).toContain('fields');
  });

  it('prefers comment source over inferred', () => {
    const result = buildDbPrompt({ slice: { id: 'database:users', kind: 'database', title: 'users' } });
    expect(result.system).toContain('comment');
    expect(result.system).toContain('inferred');
    expect(result.system).toContain('Prefer');
  });

  it('accepts db_bundle parameter', () => {
    const result = buildDbPrompt({
      slice: { id: 'database:users', kind: 'database', title: 'users' },
      db_bundle: {
        table: 'users',
        mapperBindings: [],
        sqlStatements: [],
        relatedCode: [],
        fieldCandidates: [{ name: 'id', source: 'mapper' }],
        entityEvidence: [],
        callerEvidence: [],
        gaps: [],
        provenance: { source: 'test', repoPath: '/test', generatedAt: '2026-05-20' },
      },
    });
    expect(result.user).toContain('db_bundle');
  });
});