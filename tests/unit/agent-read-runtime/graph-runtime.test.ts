import { describe, expect, it } from 'vitest';
import { parseKnowledgeReadAgentOutput, routeAfterBudgetCheck } from '../../../src/agent-read-runtime/graph-runtime.js';

describe('graph runtime output parsing', () => {
  it('parses valid JSON output', () => {
    const output = parseKnowledgeReadAgentOutput(JSON.stringify({
      answer: 'The function trims the id.',
      evidence_refs: [
        {
          file: 'src/sample.ts',
          start_line: 1,
          end_line: 2,
          note: 'Function definition',
        },
      ],
      insufficient_evidence: false,
    }));

    expect(output.answer).toBe('The function trims the id.');
    expect(output.evidenceRefs[0]?.file).toBe('src/sample.ts');
    expect(output.insufficientEvidence).toBe(false);
  });

  it('rejects non-json output', () => {
    expect(() => parseKnowledgeReadAgentOutput('plain text')).toThrow('Agent output is not valid JSON');
  });

  it('rejects invalid schema', () => {
    expect(() => parseKnowledgeReadAgentOutput(JSON.stringify({ foo: 'bar' }))).toThrow();
  });

  it('routes to output validation after budget is exhausted', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: undefined,
    });

    expect(next).toBe('output_validate');
  });

  it('routes to model decide when budget remains', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: false,
      finalText: undefined,
    });

    expect(next).toBe('model_decide');
  });

  it('routes to output validation when final text exists', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: false,
      finalText: 'some text',
    });

    expect(next).toBe('output_validate');
  });
});
