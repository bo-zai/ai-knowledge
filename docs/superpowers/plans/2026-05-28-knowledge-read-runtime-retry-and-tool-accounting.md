# Knowledge Read Runtime Retry And Tool Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent deterministic validation failures from retrying the whole graph, and make unknown tool calls consume budget and appear in trace.

**Architecture:** Keep the existing `graph-runtime.ts` workflow. Add a non-retryable validation error, a graph-local retry helper, and unknown-tool accounting inside `tool_execute`.

**Tech Stack:** TypeScript, LangGraph, Vitest.

---

## File Structure

- Modify: `src/agent-read-runtime/graph-runtime.ts`
  - Add `KnowledgeReadValidationError`
  - Add graph-local retry helper
  - Change `failed` node error type
  - Account for unknown tools in budget and trace

- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`
  - Add validation non-retry test
  - Add unknown tool budget/trace test
  - Add unknown tool max-call truncation test

## Task 1: Add Non-Retryable Validation Error

**Files:**
- Modify: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Add failing validation retry test**

Append to `tests/unit/agent-read-runtime/graph-runtime.test.ts` inside `describe('graph-level integration', ...)`:

```ts
it('does not retry the whole graph after repair validation fails', async () => {
  let calls = 0;
  const badModel = {
    async invoke() {
      calls += 1;
      return new AIMessage('still not json');
    },
  };

  await expect(runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Return invalid output',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
  }, {
    model: badModel as never,
  })).rejects.toThrow('Knowledge read output validation failed');

  expect(calls).toBe(2);
});
```

Expected current behavior:

```text
FAIL
expected calls to be 2, received 6
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
FAIL
expected calls to be 2
```

- [ ] **Step 3: Add validation error class**

In `src/agent-read-runtime/graph-runtime.ts`, after `SYSTEM_PROMPT`, add:

```ts
export class KnowledgeReadValidationError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeReadValidationError';
  }
}
```

- [ ] **Step 4: Change failed node to throw validation error**

Replace current failed node:

```ts
.addNode('failed', async (state) => {
  throw new Error(state.validationError ?? 'Knowledge read output validation failed');
})
```

With:

```ts
.addNode('failed', async (state) => {
  throw new KnowledgeReadValidationError(
    state.validationError ?? 'Knowledge read output validation failed',
  );
})
```

- [ ] **Step 5: Add graph-local retry helper**

Add helper above `runKnowledgeReadRuntime()`:

```ts
async function invokeGraphWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof KnowledgeReadValidationError) {
        throw error;
      }
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
```

- [ ] **Step 6: Replace withRetry usage**

Remove import:

```ts
import { withRetry } from '../generation/retry.js';
```

Replace:

```ts
const response = await withRetry(
  () => graph.invoke({
    messages: [new HumanMessage(userPrompt)],
    budgetExceeded: false,
    repairAttempts: 0,
  }),
  { maxRetries: 3, delayMs: 1000 },
);
```

With:

```ts
const response = await invokeGraphWithRetry(() => graph.invoke({
  messages: [new HumanMessage(userPrompt)],
  budgetExceeded: false,
  repairAttempts: 0,
}));
```

- [ ] **Step 7: Run graph tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/graph-runtime.test.ts
```

- [ ] **Step 8: Commit**

Run:

```bash
git add src/agent-read-runtime/graph-runtime.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
git commit -m "fix: avoid retrying knowledge read validation failures"
```

## Task 2: Account For Unknown Tool Calls

**Files:**
- Modify: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Add failing unknown tool trace test**

Append to `tests/unit/agent-read-runtime/graph-runtime.test.ts` inside `describe('graph-level integration', ...)`:

```ts
it('counts and traces unknown tool calls', async () => {
  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Call an unknown tool first',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
  }, {
    model: createFakeModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call-unknown',
          name: 'read_everything',
          args: {},
        }],
      }),
      new AIMessage(JSON.stringify({
        answer: 'unknown tool was rejected',
        evidence_refs: [],
        insufficient_evidence: true,
      })),
    ]) as never,
  });

  expect(result.toolCallsUsed).toBe(1);
  expect(result.trace.toolCalls[0]?.toolName).toBe('read_everything');
  expect(result.trace.toolCalls[0]?.error).toBe('unknown tool');
});
```

Expected current behavior:

```text
FAIL
expected toolCallsUsed to be 1, received 0
```

- [ ] **Step 2: Add unknown tool budget truncation test**

Append:

```ts
it('forces insufficient evidence after repeated unknown tools exhaust budget', async () => {
  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Keep calling unknown tools',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
    limits: { maxToolCalls: 1 },
  }, {
    model: createFakeModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call-unknown',
          name: 'read_everything',
          args: {},
        }],
      }),
    ]) as never,
  });

  expect(result.insufficientEvidence).toBe(true);
  expect(result.toolCallsUsed).toBe(1);
});
```

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
FAIL
expected toolCallsUsed to be 1
```

- [ ] **Step 4: Import budget helper**

Modify `src/agent-read-runtime/graph-runtime.ts` import from `context-budget.ts`:

```ts
import {
  createBudgetState,
  recordToolCall,
  resolveKnowledgeReadLimits,
} from './context-budget.js';
```

- [ ] **Step 5: Add unknown tool trace helper**

Add inside `runKnowledgeReadRuntime()` before graph creation:

```ts
const recordUnknownToolCall = (toolName: string, args: Record<string, unknown>): string => {
  const started = new Date();
  const callBudget = recordToolCall(budget);
  const content = callBudget.allowed
    ? `unknown tool: ${toolName}`
    : callBudget.message ?? 'tool call budget exceeded';
  const finished = new Date();

  trace.recordToolCall({
    toolName,
    args,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    returnedChars: content.length,
    acceptedBudgetChars: 0,
    truncated: false,
    error: 'unknown tool',
  });

  return content;
};
```

- [ ] **Step 6: Use helper for unknown tool branch**

Replace:

```ts
} else {
  content = `unknown tool: ${call.name}`;
}
```

With:

```ts
} else {
  content = recordUnknownToolCall(call.name, call.args ?? {});
}
```

- [ ] **Step 7: Confirm budget check catches unknown tool calls**

Leave existing budgetExceeded calculation:

```ts
budgetExceeded: budget.toolCallsUsed >= budget.limits.maxToolCalls
  || budget.totalToolResultChars >= budget.limits.maxTotalToolResultChars,
```

This now works because unknown tools increment `budget.toolCallsUsed`.

- [ ] **Step 8: Run graph tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/graph-runtime.test.ts
```

- [ ] **Step 9: Commit**

Run:

```bash
git add src/agent-read-runtime/graph-runtime.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
git commit -m "fix: account for unknown knowledge read tool calls"
```

## Task 3: Full Verification

**Files:**
- All modified runtime and test files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/context-budget.test.ts tests/unit/agent-read-runtime/trace.test.ts tests/unit/agent-read-runtime/local-read-tools.test.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected:

```text
build completes successfully
```

- [ ] **Step 4: Run full test suite after build completes**

Run only after `npm run build` has fully completed:

```bash
npm test
```

Expected:

```text
all tests pass
```

- [ ] **Step 5: Commit verification fixes if needed**

If verification required small fixes:

```bash
git add src/agent-read-runtime tests/unit/agent-read-runtime
git commit -m "test: verify knowledge read retry and tool accounting"
```

If no fixes were needed, do not create an empty commit.

## Implementation Notes

- Do not change `runKnowledgeReadRuntime(input)` callers.
- Keep optional dependency injection only for tests.
- Do not use global `withRetry()` if it cannot exclude validation errors.
- Unknown tools should not count as accepted evidence chars.
- Unknown tools must count as tool calls.
- Do not run `npm run build` and `npm test` concurrently because build cleans `dist`.

## Self-Review Checklist

- Spec coverage: tasks cover validation retry behavior and unknown tool accounting.
- Placeholder scan: no task contains deferred or unspecified implementation.
- Type consistency: `KnowledgeReadValidationError`, `recordUnknownToolCall`, and `invokeGraphWithRetry` are used consistently.
- Scope check: no business object generation or MCP changes are included.

