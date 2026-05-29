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
        directStatements: [],
        joinedStatements: [],
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

  it('requires field descriptions to use business context for ambiguous abbreviations', () => {
    const result = buildDbPrompt({ slice: { id: 'database:users', kind: 'database', title: 'users' } });
    expect(result.system).toContain('field-level disambiguation');
    expect(result.system).toContain('ambiguous abbreviations');
    expect(result.system).toContain('callerEvidence');
  });

  it('includes caller code evidence in user prompt when db_bundle is provided', () => {
    const result = buildDbPrompt({
      slice: { id: 'database:users', kind: 'database', title: 'users' },
      db_bundle: {
        table: 'users',
        mapperBindings: [],
        sqlStatements: [],
        directStatements: [],
        joinedStatements: [],
        relatedCode: [],
        fieldCandidates: [{ name: 'diff_level', source: 'mapper' }],
        entityEvidence: [],
        callerEvidence: [
          {
            sourceStatementId: 'selectById',
            callerClass: 'QuestionService',
            callerMethod: 'buildQuestionCard',
            callerFile: '/repo/QuestionService.java',
            callSiteSnippet: 'card.setDifficulty(questionMapper.selectById(id));',
            nearbyComments: ['根据题目难度构建卡片'],
            businessHints: ['题目难度'],
          },
        ],
        gaps: [],
        provenance: { source: 'test', repoPath: '/test', generatedAt: '2026-05-20' },
      },
    });
    expect(result.user).toContain('callerFile');
    expect(result.user).toContain('callSiteSnippet');
    expect(result.user).toContain('题目难度');
  });

  it('uses compact db evidence instead of duplicated sql bundles', () => {
    const result = buildDbPrompt({
      slice: { id: 'database:users', kind: 'database', title: 'users' },
      db_bundle: {
        table: 'users',
        mapperBindings: [
          {
            namespace: 'com.demo.UserMapper',
            methodId: 'selectById',
            statementType: 'select',
            mapperFile: '/repo/UserMapper.xml',
            accessType: 'direct',
          },
        ],
        sqlStatements: [
          {
            id: 'com.demo.UserMapper.selectById',
            sql: 'select id, diff_level from users where id = ?',
            statementType: 'select',
            tables: ['users'],
            fragmentRefs: [],
            accessType: 'direct',
          },
        ],
        directStatements: [
          {
            id: 'com.demo.UserMapper.selectById',
            sql: 'select id, diff_level from users where id = ?',
            statementType: 'select',
            tables: ['users'],
            fragmentRefs: [],
            accessType: 'direct',
          },
        ],
        joinedStatements: [],
        relatedCode: [],
        fieldCandidates: [{ name: 'diff_level', source: 'mapper', sourceStatementId: 'selectById' }],
        entityEvidence: [],
        callerEvidence: [],
        gaps: [],
        provenance: { source: 'test', repoPath: '/test', generatedAt: '2026-05-20' },
      },
    });

    const payload = JSON.parse(result.user) as { evidence: { db_bundle: Record<string, unknown> } };
    expect(payload.evidence.db_bundle).not.toHaveProperty('mapperBindings');
    expect(payload.evidence.db_bundle).not.toHaveProperty('sqlStatements');
    expect(payload.evidence.db_bundle).not.toHaveProperty('directStatements');
    expect(payload.evidence.db_bundle).not.toHaveProperty('joinedStatements');
    expect(payload.evidence.db_bundle).toHaveProperty('accessPaths');
    expect(payload.evidence.db_bundle).toHaveProperty('statementSamples');
  });
});
