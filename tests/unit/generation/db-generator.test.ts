import { describe, expect, it } from 'vitest';
import { buildDbPrompt } from '../../../src/generation/object-generators/db-generator';

describe('buildDbPrompt', () => {
  it('returns system and user prompts', () => {
    const result = buildDbPrompt({ tableName: 'users' });
    expect(result.system).toContain('JSON');
    expect(result.user).toContain('DB');
  });
});