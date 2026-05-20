import { describe, expect, it } from 'vitest';
import { buildConPrompt } from '../../../src/generation/object-generators/contract-generator';

describe('buildConPrompt', () => {
  it('returns system and user prompts for contract generation', () => {
    const result = buildConPrompt({
      route: 'POST /api/auth',
      handler_file: 'src/services/auth.ts',
    });
    expect(result.system).toContain('contract');
    expect(result.system).toContain('interface_kind');
    expect(result.user).toContain('CON');
  });

  it('prompt mentions Chinese descriptions requirement', () => {
    const result = buildConPrompt({ test: 'data' });
    expect(result.system).toContain('Chinese');
    expect(result.system).toContain('description_zh');
  });

  it('prompt mentions input_shape and output_shape', () => {
    const result = buildConPrompt({ test: 'data' });
    expect(result.system).toContain('input_shape');
    expect(result.system).toContain('output_shape');
  });
});