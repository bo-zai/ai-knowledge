import type { KnowledgeReadTrace, ToolTraceEvent } from "./types.js";

export interface TraceCollector {
  recordToolCall(event: ToolTraceEvent): void;
  finalize(): KnowledgeReadTrace;
}

export function createTraceCollector(
  now: () => Date = () => new Date(),
): TraceCollector {
  const started = now();
  const startedAt = started.toISOString();
  const toolCalls: ToolTraceEvent[] = [];

  return {
    recordToolCall(event) {
      toolCalls.push(event);
    },
    finalize() {
      const finished = now();
      return {
        startedAt,
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        toolCalls: [...toolCalls],
        totalToolResultChars: toolCalls.reduce(
          (sum, event) => sum + event.acceptedBudgetChars,
          0,
        ),
      };
    },
  };
}
