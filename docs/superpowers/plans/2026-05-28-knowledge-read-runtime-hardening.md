# Knowledge Read Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the critical failure paths in the LangGraph knowledge read runtime so budget exhaustion, invalid model output, search bounds, and trace accounting are deterministic and test-covered.

**Architecture:** Keep the existing `src/agent-read-runtime/` module. Add explicit graph nodes for forced insufficient-evidence output, output validation, and one repair attempt; tighten local search file filtering; align trace accounting with budget accounting; add graph-level tests with an injectable fake model.

**Tech Stack:** TypeScript, LangGraph, `@langchain/core`, Zod, Vitest.

---

## File Structure

- Modify: `src/agent-read-runtime/types.ts`
  - Add optional trace accounting fields and search limit fields.

- Modify: `src/agent-read-runtime/context-budget.ts`
  - Add `maxSearchFileBytes` default.

- Modify: `src/agent-read-runtime/trace.ts`
  - Track accepted budget chars separately from returned chars.

- Modify: `src/agent-read-runtime/local-read-tools.ts`
  - Add bounded text-file filtering before search reads.

- Modify: `src/agent-read-runtime/graph-runtime.ts`
  - Add `force_insufficient_output`, real `output_validate`, `repair_output`, graph routing helpers, and injectable runtime deps.

- Modify: `tests/unit/agent-read-runtime/context-budget.test.ts`
  - Add default limit assertion for search file size.

- Modify: `tests/unit/agent-read-runtime/trace.test.ts`
  - Add accepted-budget-char aggregation test.

- Modify: `tests/unit/agent-read-runtime/local-read-tools.test.ts`
  - Add large-file and binary-file skip tests.

- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`
  - Add node helper tests and graph-level fake-model tests.

## Task 1: Extend Limits And Trace Types

**Files:**
- Modify: `src/agent-read-runtime/types.ts`
- Modify: `src/agent-read-runtime/context-budget.ts`
- Modify: `tests/unit/agent-read-runtime/context-budget.test.ts`

- [ ] **Step 1: Add failing limit test**

Append to `tests/unit/agent-read-runtime/context-budget.test.ts`:

```ts
it('defines a max search file size limit', () => {
  expect(DEFAULT_KNOWLEDGE_READ_LIMITS.maxSearchFileBytes).toBe(512_000);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/context-budget.test.ts
```

Expected:

```text
FAIL
expected undefined to be 512000
```

- [ ] **Step 3: Extend limit type**

Modify `src/agent-read-runtime/types.ts`:

```ts
export interface KnowledgeReadLimits {
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalToolResultChars: number;
  maxFileWindowLines: number;
  searchResultLimit: number;
  maxSearchFileBytes: number;
}
```

- [ ] **Step 4: Extend default limits**

Modify `src/agent-read-runtime/context-budget.ts`:

```ts
export const DEFAULT_KNOWLEDGE_READ_LIMITS: KnowledgeReadLimits = {
  maxToolCalls: 8,
  maxToolResultChars: 12_000,
  maxTotalToolResultChars: 40_000,
  maxFileWindowLines: 240,
  searchResultLimit: 30,
  maxSearchFileBytes: 512_000,
};
```

- [ ] **Step 5: Run focused test**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/context-budget.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/context-budget.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/agent-read-runtime/types.ts src/agent-read-runtime/context-budget.ts tests/unit/agent-read-runtime/context-budget.test.ts
git commit -m "feat: add knowledge read search file limit"
```

## Task 2: Align Trace Accounting With Budget Accounting

**Files:**
- Modify: `src/agent-read-runtime/types.ts`
- Modify: `src/agent-read-runtime/trace.ts`
- Modify: `src/agent-read-runtime/local-read-tools.ts`
- Modify: `tests/unit/agent-read-runtime/trace.test.ts`

- [ ] **Step 1: Add failing trace test**

Append to `tests/unit/agent-read-runtime/trace.test.ts`:

```ts
it('uses accepted budget chars for total tool result chars', () => {
  const trace = createTraceCollector();

  trace.recordToolCall({
    toolName: 'search_repo_text',
    args: { query: 'x' },
    startedAt: '2026-05-28T00:00:00.000Z',
    finishedAt: '2026-05-28T00:00:01.000Z',
    durationMs: 1000,
    returnedChars: 80,
    acceptedBudgetChars: 0,
    truncated: false,
    error: 'budget exceeded',
  });

  const result = trace.finalize();

  expect(result.totalToolResultChars).toBe(0);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/trace.test.ts
```

Expected:

```text
FAIL
Object literal may only specify known properties, or totalToolResultChars is 80
```

- [ ] **Step 3: Extend trace event type**

Modify `src/agent-read-runtime/types.ts`:

```ts
export interface ToolTraceEvent {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  returnedChars: number;
  acceptedBudgetChars: number;
  truncated: boolean;
  error?: string;
}
```

- [ ] **Step 4: Update trace aggregation**

Modify `src/agent-read-runtime/trace.ts`:

```ts
totalToolResultChars: toolCalls.reduce((sum, event) => sum + event.acceptedBudgetChars, 0),
```

- [ ] **Step 5: Update existing trace tests**

In `tests/unit/agent-read-runtime/trace.test.ts`, add `acceptedBudgetChars` to each existing `recordToolCall(...)` object. Use the same value as `returnedChars` for successful tool calls and `0` for error-only calls.

Example:

```ts
acceptedBudgetChars: 12,
```

- [ ] **Step 6: Update local tool trace event creation**

Modify `src/agent-read-runtime/local-read-tools.ts` inside `runTool`:

```ts
let acceptedBudgetChars = 0;
```

After `recordToolResult(...)`:

```ts
if (totalBudget.allowed) {
  acceptedBudgetChars = truncated.text.length;
  output = truncated.text;
} else {
  output = totalBudget.message ?? 'total tool result budget exceeded';
}
```

In `recordToolCall(...)`, include:

```ts
acceptedBudgetChars,
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/trace.test.ts tests/unit/agent-read-runtime/local-read-tools.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/trace.test.ts
PASS tests/unit/agent-read-runtime/local-read-tools.test.ts
```

- [ ] **Step 8: Commit**

Run:

```bash
git add src/agent-read-runtime/types.ts src/agent-read-runtime/trace.ts src/agent-read-runtime/local-read-tools.ts tests/unit/agent-read-runtime/trace.test.ts
git commit -m "fix: align knowledge read trace budget accounting"
```

## Task 3: Bound Search File Reads

**Files:**
- Modify: `src/agent-read-runtime/local-read-tools.ts`
- Modify: `tests/unit/agent-read-runtime/local-read-tools.test.ts`

- [ ] **Step 1: Add failing search-bound tests**

Append to `tests/unit/agent-read-runtime/local-read-tools.test.ts`:

```ts
it('skips files larger than the search file byte limit', async () => {
  await fs.writeFile(path.join(repoPath, 'src', 'large.ts'), 'needle'.repeat(100));

  const handlers = createLocalReadToolHandlers({
    repoPath,
    budget: createBudgetState({
      ...DEFAULT_KNOWLEDGE_READ_LIMITS,
      maxSearchFileBytes: 10,
    }),
    trace: createTraceCollector(),
  });

  const result = await handlers.searchRepoText({ query: 'needle', limit: 10 });

  expect(result).toContain('no matches');
});

it('skips obvious binary files during search', async () => {
  await fs.writeFile(path.join(repoPath, 'src', 'image.png'), Buffer.from([0, 1, 2, 3]));

  const handlers = createLocalReadToolHandlers({
    repoPath,
    budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
    trace: createTraceCollector(),
  });

  const result = await handlers.searchRepoText({ query: '\u0001', limit: 10 });

  expect(result).toContain('no matches');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/local-read-tools.test.ts
```

Expected:

```text
FAIL
expected result to contain no matches
```

- [ ] **Step 3: Add skip constants**

Modify `src/agent-read-runtime/local-read-tools.ts` near imports:

```ts
const SKIPPED_SEARCH_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.knowledge',
  'bootstrap-knowledge',
]);

const SKIPPED_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.exe',
  '.dll',
  '.wasm',
]);
```

- [ ] **Step 4: Use skip constants in walker**

Modify `walkFiles`:

```ts
if (entry.isDirectory()) {
  if (SKIPPED_SEARCH_DIRS.has(entry.name)) {
    continue;
  }
  files.push(...await walkFiles(fullPath));
} else if (entry.isFile()) {
  files.push(fullPath);
}
```

- [ ] **Step 5: Add searchable file helper**

Add helper in `createLocalReadToolHandlers`:

```ts
const isSearchableTextFile = async (file: string): Promise<boolean> => {
  if (SKIPPED_BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    return false;
  }
  const stat = await fs.stat(file);
  if (stat.size > input.budget.limits.maxSearchFileBytes) {
    return false;
  }
  return true;
};
```

- [ ] **Step 6: Use searchable file helper before read**

Modify `searchRaw` before `fs.readFile(file, 'utf8')`:

```ts
if (!(await isSearchableTextFile(file))) {
  continue;
}
```

After reading:

```ts
if (text.includes('\0')) {
  continue;
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/local-read-tools.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/local-read-tools.test.ts
```

- [ ] **Step 8: Commit**

Run:

```bash
git add src/agent-read-runtime/local-read-tools.ts tests/unit/agent-read-runtime/local-read-tools.test.ts
git commit -m "fix: bound knowledge read text search"
```

## Task 4: Add Graph Output Validation And Forced Insufficient Output

**Files:**
- Modify: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Add failing helper tests**

Append to `tests/unit/agent-read-runtime/graph-runtime.test.ts`:

```ts
import {
  buildForcedInsufficientOutput,
  validateFinalOutput,
} from '../../../src/agent-read-runtime/graph-runtime.js';
```

Then append tests:

```ts
it('builds valid insufficient evidence output', () => {
  const parsed = parseKnowledgeReadAgentOutput(buildForcedInsufficientOutput());

  expect(parsed.insufficientEvidence).toBe(true);
  expect(parsed.evidenceRefs).toEqual([]);
});

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
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
FAIL
No export named buildForcedInsufficientOutput
```

- [ ] **Step 3: Extend graph state**

Modify `src/agent-read-runtime/graph-runtime.ts` annotations:

```ts
parsedOutput: Annotation<KnowledgeReadAgentOutput | undefined>({
  reducer: (_, right) => right,
  default: () => undefined,
}),
validationError: Annotation<string | undefined>({
  reducer: (_, right) => right,
  default: () => undefined,
}),
```

Import `type KnowledgeReadAgentOutput`.

- [ ] **Step 4: Add forced output helper**

Add:

```ts
export function buildForcedInsufficientOutput(): string {
  return JSON.stringify({
    answer: 'Evidence budget was exhausted before enough evidence could be confirmed.',
    evidence_refs: [],
    insufficient_evidence: true,
  });
}
```

- [ ] **Step 5: Add validation helper**

Add:

```ts
export function validateFinalOutput(state: { finalText?: string; repairAttempts: number }): {
  parsedOutput?: KnowledgeReadAgentOutput;
  validationError?: string;
} {
  try {
    const parsed = parseKnowledgeReadAgentOutput(state.finalText ?? '');
    return {
      parsedOutput: {
        answer: parsed.answer,
        evidence_refs: parsed.evidenceRefs.map((ref) => ({
          file: ref.file,
          start_line: ref.startLine,
          end_line: ref.endLine,
          note: ref.note,
        })),
        insufficient_evidence: parsed.insufficientEvidence,
      },
      validationError: undefined,
    };
  } catch (error) {
    return {
      validationError: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 6: Add graph nodes**

Replace no-op `output_validate` node with:

```ts
.addNode('output_validate', async (state) => validateFinalOutput(state))
```

Add forced output node:

```ts
.addNode('force_insufficient_output', async () => ({
  finalText: buildForcedInsufficientOutput(),
}))
```

- [ ] **Step 7: Route budget exhaustion to forced output**

Replace `routeAfterBudgetCheck` with:

```ts
export function routeAfterBudgetCheck(state: { budgetExceeded: boolean; finalText?: string }): 'model_decide' | 'force_insufficient_output' | 'output_validate' {
  if (state.finalText) {
    return 'output_validate';
  }
  if (state.budgetExceeded) {
    return 'force_insufficient_output';
  }
  return 'model_decide';
}
```

Update route tests to expect `force_insufficient_output` for budget exhaustion.

- [ ] **Step 8: Add graph edges**

Change conditional edge map:

```ts
.addConditionalEdges('budget_check', routeAfterBudgetCheck, {
  model_decide: 'model_decide',
  force_insufficient_output: 'force_insufficient_output',
  output_validate: 'output_validate',
})
.addEdge('force_insufficient_output', 'output_validate')
```

Add validation terminal route for now:

```ts
.addEdge('output_validate', END)
```

- [ ] **Step 9: Read parsed output from final graph state**

Replace final parse after `graph.invoke(...)` with:

```ts
if (!response.parsedOutput) {
  throw new Error(response.validationError ?? 'Knowledge read output validation failed');
}

const parsed = {
  answer: response.parsedOutput.answer,
  evidenceRefs: response.parsedOutput.evidence_refs.map((ref) => ({
    file: ref.file,
    startLine: ref.start_line,
    endLine: ref.end_line,
    note: ref.note,
  })),
  insufficientEvidence: response.parsedOutput.insufficient_evidence,
};
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/graph-runtime.test.ts
```

- [ ] **Step 11: Commit**

Run:

```bash
git add src/agent-read-runtime/graph-runtime.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
git commit -m "fix: add knowledge read graph validation nodes"
```

## Task 5: Add One-Shot Output Repair

**Files:**
- Modify: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Add route helper tests**

Append to `tests/unit/agent-read-runtime/graph-runtime.test.ts`:

```ts
import { routeAfterValidation } from '../../../src/agent-read-runtime/graph-runtime.js';
```

Add tests:

```ts
it('routes validated output to end', () => {
  expect(routeAfterValidation({
    parsedOutput: {
      answer: 'ok',
      evidence_refs: [],
      insufficient_evidence: false,
    },
    validationError: undefined,
    repairAttempts: 0,
  })).toBe('__end__');
});

it('routes first validation failure to repair', () => {
  expect(routeAfterValidation({
    parsedOutput: undefined,
    validationError: 'bad json',
    repairAttempts: 0,
  })).toBe('repair_output');
});

it('routes second validation failure to failed', () => {
  expect(routeAfterValidation({
    parsedOutput: undefined,
    validationError: 'bad json',
    repairAttempts: 1,
  })).toBe('failed');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
FAIL
No export named routeAfterValidation
```

- [ ] **Step 3: Add validation route helper**

Add to `src/agent-read-runtime/graph-runtime.ts`:

```ts
export function routeAfterValidation(state: {
  parsedOutput?: KnowledgeReadAgentOutput;
  validationError?: string;
  repairAttempts: number;
}): typeof END | 'repair_output' | 'failed' {
  if (state.parsedOutput) {
    return END;
  }
  if (state.validationError && state.repairAttempts < 1) {
    return 'repair_output';
  }
  return 'failed';
}
```

- [ ] **Step 4: Add repair prompt helper**

Add:

```ts
function buildRepairPrompt(finalText: string | undefined, validationError: string | undefined): string {
  return [
    'Repair the previous output so it is valid JSON for this schema:',
    '{"answer":"string","evidence_refs":[{"file":"string","start_line":1,"end_line":1,"note":"string"}],"insufficient_evidence":false}',
    '',
    `Validation error: ${validationError ?? 'unknown'}`,
    '',
    'Previous output:',
    finalText ?? '',
    '',
    'Return only JSON.',
  ].join('\n');
}
```

- [ ] **Step 5: Add repair and failed nodes**

Add graph nodes:

```ts
.addNode('repair_output', async (state) => {
  const response = await model.invoke([
    new HumanMessage(buildRepairPrompt(state.finalText, state.validationError)),
  ]);
  return {
    finalText: messageContentToText(response.content),
    validationError: undefined,
    repairAttempts: state.repairAttempts + 1,
  };
})
.addNode('failed', async (state) => {
  throw new Error(state.validationError ?? 'Knowledge read output validation failed');
})
```

- [ ] **Step 6: Replace output_validate terminal edge**

Replace:

```ts
.addEdge('output_validate', END)
```

With:

```ts
.addConditionalEdges('output_validate', routeAfterValidation, {
  [END]: END,
  repair_output: 'repair_output',
  failed: 'failed',
})
.addEdge('repair_output', 'output_validate')
.addEdge('failed', END)
```

- [ ] **Step 7: Run graph-runtime tests**

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
git commit -m "fix: add knowledge read output repair node"
```

## Task 6: Add Graph-Level Fake Model Tests

**Files:**
- Modify: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Add injectable deps type**

Modify `src/agent-read-runtime/graph-runtime.ts`:

```ts
interface KnowledgeReadRuntimeDeps {
  model?: ReturnType<ChatOpenAI['bindTools']>;
}
```

Change runtime signature:

```ts
export async function runKnowledgeReadRuntime(
  input: KnowledgeReadRuntimeInput,
  deps: KnowledgeReadRuntimeDeps = {},
): Promise<KnowledgeReadResult> {
```

Use injected model:

```ts
const model = deps.model ?? new ChatOpenAI({
  model: input.model,
  apiKey: input.apiKey,
  configuration: {
    baseURL: input.baseUrl,
  },
  temperature: 0,
}).bindTools(tools);
```

- [ ] **Step 2: Add fake model test helper**

In `tests/unit/agent-read-runtime/graph-runtime.test.ts`, add imports:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AIMessage } from '@langchain/core/messages';
import { afterEach, beforeEach } from 'vitest';
import { runKnowledgeReadRuntime } from '../../../src/agent-read-runtime/graph-runtime.js';
```

Add fixture setup:

```ts
let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-read-graph-'));
  await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
  await fs.writeFile(path.join(repoPath, 'src', 'sample.ts'), 'export function saveOrder() { return "ok"; }\n');
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

function createFakeModel(responses: AIMessage[]) {
  let index = 0;
  return {
    async invoke() {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error('fake model exhausted');
      }
      return response;
    },
  };
}
```

- [ ] **Step 3: Add tool-loop test**

Append:

```ts
it('runs graph from model tool call to valid final output', async () => {
  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Inspect saveOrder',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
  }, {
    model: createFakeModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'read_file_window',
          args: { path: 'src/sample.ts', startLine: 1, endLine: 1 },
        }],
      }),
      new AIMessage({
        content: JSON.stringify({
          answer: 'saveOrder returns ok.',
          evidence_refs: [{ file: 'src/sample.ts', start_line: 1, end_line: 1, note: 'Function definition' }],
          insufficient_evidence: false,
        }),
      }),
    ]) as never,
  });

  expect(result.insufficientEvidence).toBe(false);
  expect(result.evidenceRefs[0]?.file).toBe('src/sample.ts');
  expect(result.toolCallsUsed).toBe(1);
});
```

- [ ] **Step 4: Add budget exhaustion graph test**

Append:

```ts
it('returns insufficient evidence when tool budget is exhausted', async () => {
  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Keep reading',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
    limits: { maxToolCalls: 1 },
  }, {
    model: createFakeModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'read_file_window',
          args: { path: 'src/sample.ts', startLine: 1, endLine: 1 },
        }],
      }),
    ]) as never,
  });

  expect(result.insufficientEvidence).toBe(true);
  expect(result.evidenceRefs).toEqual([]);
});
```

- [ ] **Step 5: Add repair graph test**

Append:

```ts
it('repairs invalid final JSON once', async () => {
  const result = await runKnowledgeReadRuntime({
    repoPath,
    instruction: 'Return final output',
    model: 'unused',
    baseUrl: 'http://unused',
    apiKey: 'unused',
  }, {
    model: createFakeModel([
      new AIMessage('not json'),
      new AIMessage(JSON.stringify({
        answer: 'repaired',
        evidence_refs: [],
        insufficient_evidence: true,
      })),
    ]) as never,
  });

  expect(result.answer).toBe('repaired');
  expect(result.insufficientEvidence).toBe(true);
});
```

- [ ] **Step 6: Run graph runtime tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/graph-runtime.test.ts
```

- [ ] **Step 7: Commit**

Run:

```bash
git add src/agent-read-runtime/graph-runtime.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
git commit -m "test: cover knowledge read graph runtime flow"
```

## Task 7: Full Verification

**Files:**
- All modified runtime and test files

- [ ] **Step 1: Run focused runtime tests**

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

- [ ] **Step 4: Run full test suite**

Run:

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
git commit -m "test: verify knowledge read runtime hardening"
```

If no fixes were needed, do not create an empty commit.

## Implementation Notes

- Keep runtime independent from `src/cli/generate.ts`.
- Do not add MCP.
- Do not add `deepagents`.
- Do not add shell execution.
- Do not make search parse `.gitignore` in this round.
- Keep public `runKnowledgeReadRuntime(input)` compatible; injected deps are optional and for tests.
- Keep comments in source code 简体中文 when comments are necessary.

## Self-Review Checklist

- Spec coverage: tasks cover budget exhaustion, output validation, repair, search bounds, trace accounting, graph-level tests, and verification.
- Placeholder scan: no task relies on unspecified follow-up behavior.
- Type consistency: `KnowledgeReadLimits`, `ToolTraceEvent`, `KnowledgeReadAgentOutput`, and graph route helper names are consistent across tasks.
- Scope check: this plan does not connect the runtime to business object generation.

