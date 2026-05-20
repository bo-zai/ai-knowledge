import { describe, expect, it } from 'vitest';
import { parseGeneratorOutput } from '../../../src/generation/parse-output';

describe('parseGeneratorOutput', () => {
  it('parses valid object output', () => {
    const result = parseGeneratorOutput('{"objects":[{"id":"DB-users"}],"warnings":[]}');
    expect(result.objects).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseGeneratorOutput('not json')).toThrow();
  });
});