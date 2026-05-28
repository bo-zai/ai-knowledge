import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_READ_LIMITS,
  createBudgetState,
  recordToolCall,
  recordToolResult,
  truncateToolResult,
} from '../../../src/agent-read-runtime/context-budget.js';

describe('context budget', () => {
  it('truncates a single tool result to the configured char limit', () => {
    const result = truncateToolResult('abcdef', 4);

    expect(result.text).toBe('abcd\n[truncated]');
    expect(result.truncated).toBe(true);
  });

  it('does not truncate when within limit', () => {
    const result = truncateToolResult('abc', 10);

    expect(result.text).toBe('abc');
    expect(result.truncated).toBe(false);
  });

  it('tracks total returned characters', () => {
    const state = createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS);

    const first = recordToolResult(state, 'abc');
    const second = recordToolResult(state, 'defgh');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(state.totalToolResultChars).toBe(8);
  });

  it('rejects results after the cumulative budget is exhausted', () => {
    const state = createBudgetState({
      ...DEFAULT_KNOWLEDGE_READ_LIMITS,
      maxTotalToolResultChars: 5,
    });

    recordToolResult(state, 'abcde');
    const next = recordToolResult(state, 'f');

    expect(next.allowed).toBe(false);
    expect(next.message).toContain('total tool result budget exceeded');
  });

  it('tracks tool call count', () => {
    const state = createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS);

    const first = recordToolCall(state);
    const second = recordToolCall(state);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(state.toolCallsUsed).toBe(2);
  });

  it('rejects tool calls after max calls exhausted', () => {
    const state = createBudgetState({
      ...DEFAULT_KNOWLEDGE_READ_LIMITS,
      maxToolCalls: 2,
    });

    recordToolCall(state);
    recordToolCall(state);
    const third = recordToolCall(state);

    expect(third.allowed).toBe(false);
    expect(third.message).toContain('tool call budget exceeded');
  });

  it('defines a max search file size limit', () => {
    expect(DEFAULT_KNOWLEDGE_READ_LIMITS.maxSearchFileBytes).toBe(512_000);
  });
});
