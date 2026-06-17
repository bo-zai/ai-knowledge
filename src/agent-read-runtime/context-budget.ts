import type { KnowledgeReadLimits } from "./types.js";

export const DEFAULT_KNOWLEDGE_READ_LIMITS: KnowledgeReadLimits = {
  maxToolCalls: 8,
  maxToolResultChars: 12_000,
  maxTotalToolResultChars: 40_000,
  maxFileWindowLines: 240,
  searchResultLimit: 30,
  maxSearchFileBytes: 512_000,
};

export interface BudgetState {
  limits: KnowledgeReadLimits;
  toolCallsUsed: number;
  totalToolResultChars: number;
}

export function resolveKnowledgeReadLimits(
  input?: Partial<KnowledgeReadLimits>,
): KnowledgeReadLimits {
  return {
    ...DEFAULT_KNOWLEDGE_READ_LIMITS,
    ...input,
  };
}

export function createBudgetState(limits: KnowledgeReadLimits): BudgetState {
  return {
    limits,
    toolCallsUsed: 0,
    totalToolResultChars: 0,
  };
}

export function truncateToolResult(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n[truncated]`,
    truncated: true,
  };
}

export function recordToolCall(state: BudgetState): {
  allowed: boolean;
  message?: string;
} {
  if (state.toolCallsUsed >= state.limits.maxToolCalls) {
    return {
      allowed: false,
      message: `tool call budget exceeded: ${state.toolCallsUsed}/${state.limits.maxToolCalls}`,
    };
  }

  state.toolCallsUsed += 1;
  return { allowed: true };
}

export function recordToolResult(
  state: BudgetState,
  text: string,
): { allowed: boolean; message?: string } {
  const nextTotal = state.totalToolResultChars + text.length;
  if (nextTotal > state.limits.maxTotalToolResultChars) {
    return {
      allowed: false,
      message: `total tool result budget exceeded: ${nextTotal}/${state.limits.maxTotalToolResultChars}`,
    };
  }

  state.totalToolResultChars = nextTotal;
  return { allowed: true };
}
