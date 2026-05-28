import { describe, expect, it } from 'vitest';
import {
  parseKnowledgeReadAgentOutput,
  routeAfterBudgetCheck,
  buildForcedInsufficientOutput,
  validateFinalOutput,
} from '../../../src/agent-read-runtime/graph-runtime.js';

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
});

describe('budget check routing', () => {
  it('routes to force insufficient output when budget is exhausted and no final text', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: undefined,
    });

    expect(next).toBe('force_insufficient_output');
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

  it('routes to output validate when budget exhausted but final text exists', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: 'some text',
    });

    expect(next).toBe('output_validate');
  });
});

describe('forced insufficient output', () => {
  it('builds valid insufficient evidence output', () => {
    const parsed = parseKnowledgeReadAgentOutput(buildForcedInsufficientOutput());

    expect(parsed.insufficientEvidence).toBe(true);
    expect(parsed.evidenceRefs).toEqual([]);
  });
});

describe('output validation', () => {
  it('validates final output into parsed output', () => {
    const result = validateFinalOutput({
      finalText: JSON.stringify({
        answer: 'ok',
        evidence_refs: [],
        insufficient_evidence: false,
      }),
      repairAttempts: 0,
    });

    expect(result.parsedOutput?.answer).toBe('ok');
    expect(result.validationError).toBeUndefined();
  });

  it('captures validation error for invalid final output', () => {
    const result = validateFinalOutput({
      finalText: 'plain text',
      repairAttempts: 0,
    });

    expect(result.parsedOutput).toBeUndefined();
    expect(result.validationError).toContain('Agent output is not valid JSON');
  });
});