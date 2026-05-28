import { describe, expect, it } from 'vitest';
import { createTraceCollector } from '../../../src/agent-read-runtime/trace.js';

describe('trace collector', () => {
  it('records tool events and finalizes aggregate trace', () => {
    const trace = createTraceCollector();

    trace.recordToolCall({
      toolName: 'read_file_window',
      args: { path: 'src/index.ts' },
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: '2026-05-28T00:00:01.000Z',
      durationMs: 1000,
      returnedChars: 12,
      truncated: false,
    });

    const result = trace.finalize();

    expect(result.toolCalls).toHaveLength(1);
    expect(result.totalToolResultChars).toBe(12);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('accumulates multiple tool calls', () => {
    const trace = createTraceCollector();

    trace.recordToolCall({
      toolName: 'read_file_window',
      args: { path: 'src/index.ts' },
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: '2026-05-28T00:00:01.000Z',
      durationMs: 1000,
      returnedChars: 100,
      truncated: false,
    });

    trace.recordToolCall({
      toolName: 'search_repo_text',
      args: { query: 'function' },
      startedAt: '2026-05-28T00:00:01.000Z',
      finishedAt: '2026-05-28T00:00:02.000Z',
      durationMs: 1000,
      returnedChars: 200,
      truncated: true,
    });

    const result = trace.finalize();

    expect(result.toolCalls).toHaveLength(2);
    expect(result.totalToolResultChars).toBe(300);
  });

  it('records error in tool call', () => {
    const trace = createTraceCollector();

    trace.recordToolCall({
      toolName: 'read_file_window',
      args: { path: 'outside.ts' },
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: '2026-05-28T00:00:00.100Z',
      durationMs: 100,
      returnedChars: 0,
      truncated: false,
      error: 'path is outside repo',
    });

    const result = trace.finalize();

    expect(result.toolCalls[0]?.error).toBe('path is outside repo');
  });
});