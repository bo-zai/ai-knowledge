# Knowledge Agent Read Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LangGraph-based local read runtime that lets an LLM call restricted repository read tools before later knowledge generation steps.

**Architecture:** Create a new `src/agent-read-runtime/` module with stable input/output types, local read tools, budget enforcement, trace capture, and a LangGraph workflow. Keep this module independent from current business knowledge object generators.

**Tech Stack:** TypeScript, LangGraph, `@langchain/core`, `@langchain/openai`, Zod, Vitest, existing OpenAI-compatible model config.

---

## File Structure

- Create: `src/agent-read-runtime/types.ts`
  - Owns public runtime contracts, trace types, limits, and parsed agent output type.

- Create: `src/agent-read-runtime/context-budget.ts`
  - Owns default limits, per-result truncation, total budget accounting, and tool-call counting.

- Create: `src/agent-read-runtime/local-read-tools.ts`
  - Owns local read-only LangChain tools and path safety checks.

- Create: `src/agent-read-runtime/trace.ts`
  - Owns trace collector helpers used by tools and runtime.

- Create: `src/agent-read-runtime/graph-runtime.ts`
  - Owns `ChatOpenAI`, graph state, graph nodes, final JSON parsing, and retry wiring.

- Create: `src/agent-read-runtime/index.ts`
  - Re-exports public API only.

- Modify: `package.json`
  - Add `langchain` and `@langchain/openai`.

- Create: `tests/unit/agent-read-runtime/context-budget.test.ts`
  - Covers truncation and cumulative budget behavior.

- Create: `tests/unit/agent-read-runtime/local-read-tools.test.ts`
  - Covers file window reads, search, path escape rejection, and truncation.

- Create: `tests/unit/agent-read-runtime/trace.test.ts`
  - Covers trace event recording.

- Create: `tests/unit/agent-read-runtime/graph-runtime.test.ts`
  - Covers output JSON parsing helpers and final result normalization without calling a real provider.

## Task 1: Add Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install LangChain dependencies**

Run:

```bash
npm install @langchain/core @langchain/langgraph @langchain/openai
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

- [ ] **Step 2: Confirm package entries**

Check that `package.json` contains dependencies equivalent to:

```json
{
  "dependencies": {
    "@langchain/core": "^1",
    "@langchain/langgraph": "^1",
    "@langchain/openai": "^1"
  }
}
```

- [ ] **Step 3: Run dependency type smoke check**

Run:

```bash
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json package-lock.json
git commit -m "chore: add langgraph runtime dependencies"
```

## Task 2: Define Runtime Types

**Files:**
- Create: `src/agent-read-runtime/types.ts`
- Create: `src/agent-read-runtime/index.ts`
- Test: `npm run typecheck`

- [ ] **Step 1: Create public types**

Create `src/agent-read-runtime/types.ts` with:

```ts
import { z } from 'zod';

export interface EvidenceRef {
  file: string;
  startLine: number;
  endLine: number;
  note: string;
}

export interface KnowledgeReadLimits {
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalToolResultChars: number;
  maxFileWindowLines: number;
  searchResultLimit: number;
}

export interface KnowledgeReadRuntimeInput {
  repoPath: string;
  instruction: string;
  initialContext?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  limits?: Partial<KnowledgeReadLimits>;
}

export interface ToolTraceEvent {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  returnedChars: number;
  truncated: boolean;
  error?: string;
}

export interface KnowledgeReadTrace {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  toolCalls: ToolTraceEvent[];
  totalToolResultChars: number;
}

export interface KnowledgeReadResult {
  answer: string;
  evidenceRefs: EvidenceRef[];
  insufficientEvidence: boolean;
  toolCallsUsed: number;
  trace: KnowledgeReadTrace;
}

export const KnowledgeReadAgentOutputSchema = z.object({
  answer: z.string(),
  evidence_refs: z.array(z.object({
    file: z.string(),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    note: z.string(),
  })),
  insufficient_evidence: z.boolean(),
});

export type KnowledgeReadAgentOutput = z.infer<typeof KnowledgeReadAgentOutputSchema>;
```

- [ ] **Step 2: Create public re-export**

Create `src/agent-read-runtime/index.ts` with:

```ts
export type {
  EvidenceRef,
  KnowledgeReadAgentOutput,
  KnowledgeReadLimits,
  KnowledgeReadResult,
  KnowledgeReadRuntimeInput,
  KnowledgeReadTrace,
  ToolTraceEvent,
} from './types.js';

export { KnowledgeReadAgentOutputSchema } from './types.js';
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 4: Commit**

Run:

```bash
git add src/agent-read-runtime/types.ts src/agent-read-runtime/index.ts
git commit -m "feat: define knowledge read runtime contracts"
```

## Task 3: Implement Budget Guard

**Files:**
- Create: `src/agent-read-runtime/context-budget.ts`
- Create: `tests/unit/agent-read-runtime/context-budget.test.ts`

- [ ] **Step 1: Write failing budget tests**

Create `tests/unit/agent-read-runtime/context-budget.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_READ_LIMITS,
  createBudgetState,
  recordToolResult,
  truncateToolResult,
} from '../../../src/agent-read-runtime/context-budget.js';

describe('context budget', () => {
  it('truncates a single tool result to the configured char limit', () => {
    const result = truncateToolResult('abcdef', 4);

    expect(result.text).toBe('abcd\n[truncated]');
    expect(result.truncated).toBe(true);
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
Cannot find module '../../../src/agent-read-runtime/context-budget.js'
```

- [ ] **Step 3: Implement budget module**

Create `src/agent-read-runtime/context-budget.ts` with:

```ts
import type { KnowledgeReadLimits } from './types.js';

export const DEFAULT_KNOWLEDGE_READ_LIMITS: KnowledgeReadLimits = {
  maxToolCalls: 8,
  maxToolResultChars: 12_000,
  maxTotalToolResultChars: 40_000,
  maxFileWindowLines: 240,
  searchResultLimit: 30,
};

export interface BudgetState {
  limits: KnowledgeReadLimits;
  toolCallsUsed: number;
  totalToolResultChars: number;
}

export function resolveKnowledgeReadLimits(input?: Partial<KnowledgeReadLimits>): KnowledgeReadLimits {
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

export function truncateToolResult(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n[truncated]`,
    truncated: true,
  };
}

export function recordToolCall(state: BudgetState): { allowed: boolean; message?: string } {
  if (state.toolCallsUsed >= state.limits.maxToolCalls) {
    return {
      allowed: false,
      message: `tool call budget exceeded: ${state.toolCallsUsed}/${state.limits.maxToolCalls}`,
    };
  }

  state.toolCallsUsed += 1;
  return { allowed: true };
}

export function recordToolResult(state: BudgetState, text: string): { allowed: boolean; message?: string } {
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
```

- [ ] **Step 4: Export budget helpers**

Modify `src/agent-read-runtime/index.ts`:

```ts
export {
  DEFAULT_KNOWLEDGE_READ_LIMITS,
  createBudgetState,
  recordToolCall,
  recordToolResult,
  resolveKnowledgeReadLimits,
  truncateToolResult,
} from './context-budget.js';
```

- [ ] **Step 5: Run test to verify pass**

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
git add src/agent-read-runtime/context-budget.ts src/agent-read-runtime/index.ts tests/unit/agent-read-runtime/context-budget.test.ts
git commit -m "feat: add knowledge read context budget"
```

## Task 4: Implement Trace Collector

**Files:**
- Create: `src/agent-read-runtime/trace.ts`
- Create: `tests/unit/agent-read-runtime/trace.test.ts`

- [ ] **Step 1: Write failing trace test**

Create `tests/unit/agent-read-runtime/trace.test.ts` with:

```ts
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
Cannot find module '../../../src/agent-read-runtime/trace.js'
```

- [ ] **Step 3: Implement trace collector**

Create `src/agent-read-runtime/trace.ts` with:

```ts
import type { KnowledgeReadTrace, ToolTraceEvent } from './types.js';

export interface TraceCollector {
  recordToolCall(event: ToolTraceEvent): void;
  finalize(): KnowledgeReadTrace;
}

export function createTraceCollector(now: () => Date = () => new Date()): TraceCollector {
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
        totalToolResultChars: toolCalls.reduce((sum, event) => sum + event.returnedChars, 0),
      };
    },
  };
}
```

- [ ] **Step 4: Export trace collector**

Modify `src/agent-read-runtime/index.ts`:

```ts
export { createTraceCollector, type TraceCollector } from './trace.js';
```

- [ ] **Step 5: Run test to verify pass**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/trace.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/trace.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/agent-read-runtime/trace.ts src/agent-read-runtime/index.ts tests/unit/agent-read-runtime/trace.test.ts
git commit -m "feat: add knowledge read trace collector"
```

## Task 5: Implement Local Read Tools

**Files:**
- Create: `src/agent-read-runtime/local-read-tools.ts`
- Create: `tests/unit/agent-read-runtime/local-read-tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/unit/agent-read-runtime/local-read-tools.test.ts` with:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBudgetState, DEFAULT_KNOWLEDGE_READ_LIMITS } from '../../../src/agent-read-runtime/context-budget.js';
import { createLocalReadToolHandlers } from '../../../src/agent-read-runtime/local-read-tools.js';
import { createTraceCollector } from '../../../src/agent-read-runtime/trace.js';

let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-read-tools-'));
  await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(repoPath, 'tests'), { recursive: true });
  await fs.writeFile(path.join(repoPath, 'src', 'sample.ts'), [
    'export function saveOrder(id: string) {',
    '  return id.trim();',
    '}',
    '',
    'export function loadOrder(id: string) {',
    '  return saveOrder(id);',
    '}',
  ].join('\n'));
  await fs.writeFile(path.join(repoPath, 'tests', 'sample.test.ts'), 'import { saveOrder } from "../src/sample";\n');
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe('local read tool handlers', () => {
  it('reads a file window with line numbers', async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({ path: 'src/sample.ts', startLine: 1, endLine: 2 });

    expect(result).toContain('1 | export function saveOrder');
    expect(result).toContain('2 |   return id.trim();');
  });

  it('rejects path traversal outside the repo', async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readFileWindow({ path: '../outside.ts', startLine: 1, endLine: 1 });

    expect(result).toContain('path is outside repo');
  });

  it('searches repo text without returning whole files', async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.searchRepoText({ query: 'saveOrder', limit: 10 });

    expect(result).toContain('src/sample.ts:1');
    expect(result).toContain('tests/sample.test.ts:1');
  });

  it('finds related tests by symbol name', async () => {
    const handlers = createLocalReadToolHandlers({
      repoPath,
      budget: createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS),
      trace: createTraceCollector(),
    });

    const result = await handlers.readRelatedTests({ symbol: 'saveOrder', limit: 10 });

    expect(result).toContain('tests/sample.test.ts:1');
  });
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
Cannot find module '../../../src/agent-read-runtime/local-read-tools.js'
```

- [ ] **Step 3: Implement local read handlers and tools**

Create `src/agent-read-runtime/local-read-tools.ts` with these exports and behavior:

```ts
import fs from 'fs/promises';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BudgetState } from './context-budget.js';
import { recordToolCall, recordToolResult, truncateToolResult } from './context-budget.js';
import type { TraceCollector } from './trace.js';

interface LocalReadToolInput {
  repoPath: string;
  budget: BudgetState;
  trace: TraceCollector;
}

export interface LocalReadToolHandlers {
  readFileWindow(input: { path: string; startLine: number; endLine: number }): Promise<string>;
  searchRepoText(input: { query: string; limit?: number }): Promise<string>;
  readSymbolDefinition(input: { symbol: string; limit?: number }): Promise<string>;
  readSymbolReferences(input: { symbol: string; limit?: number }): Promise<string>;
  readRelatedTests(input: { path?: string; symbol?: string; limit?: number }): Promise<string>;
}

export function createLocalReadToolHandlers(input: LocalReadToolInput): LocalReadToolHandlers {
  const runTool = async <T extends Record<string, unknown>>(
    toolName: string,
    args: T,
    handler: () => Promise<string>,
  ): Promise<string> => {
    const started = new Date();
    const callBudget = recordToolCall(input.budget);
    if (!callBudget.allowed) {
      return callBudget.message ?? 'tool call budget exceeded';
    }

    let output = '';
    let error: string | undefined;
    try {
      const raw = await handler();
      const truncated = truncateToolResult(raw, input.budget.limits.maxToolResultChars);
      const totalBudget = recordToolResult(input.budget, truncated.text);
      output = totalBudget.allowed ? truncated.text : totalBudget.message ?? 'total tool result budget exceeded';
      return output;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      output = `tool error: ${error}`;
      return output;
    } finally {
      const finished = new Date();
      input.trace.recordToolCall({
        toolName,
        args,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        returnedChars: output.length,
        truncated: output.endsWith('[truncated]'),
        ...(error ? { error } : {}),
      });
    }
  };

  const resolveRepoFile = async (relativePath: string): Promise<string> => {
    const root = path.resolve(input.repoPath);
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`path is outside repo: ${relativePath}`);
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new Error(`path is not a file: ${relativePath}`);
    }
    return target;
  };

  const readFileWindowRaw = async (relativePath: string, startLine: number, endLine: number): Promise<string> => {
    if (startLine < 1 || endLine < startLine) {
      throw new Error(`invalid line window: ${startLine}-${endLine}`);
    }
    if (endLine - startLine + 1 > input.budget.limits.maxFileWindowLines) {
      throw new Error(`line window exceeds limit: ${input.budget.limits.maxFileWindowLines}`);
    }
    const target = await resolveRepoFile(relativePath);
    const text = await fs.readFile(target, 'utf8');
    const lines = text.split(/\r?\n/);
    return lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index} | ${line}`)
      .join('\n');
  };

  const walkFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const searchRaw = async (query: string, limit?: number, onlyTests = false): Promise<string> => {
    const normalized = query.trim();
    if (!normalized) {
      throw new Error('query is required');
    }
    const max = Math.min(limit ?? input.budget.limits.searchResultLimit, input.budget.limits.searchResultLimit);
    const root = path.resolve(input.repoPath);
    const files = await walkFiles(root);
    const matches: string[] = [];
    for (const file of files) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (onlyTests && !relative.includes('test') && !relative.includes('spec')) {
        continue;
      }
      let text = '';
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (line.includes(normalized)) {
          matches.push(`${relative}:${index + 1}: ${line.trim()}`);
          if (matches.length >= max) {
            return matches.join('\n');
          }
        }
      }
    }
    return `no matches for "${normalized}"`;
  };

  return {
    readFileWindow(args) {
      return runTool('read_file_window', args, () => readFileWindowRaw(args.path, args.startLine, args.endLine));
    },
    searchRepoText(args) {
      return runTool('search_repo_text', args, () => searchRaw(args.query, args.limit));
    },
    readSymbolDefinition(args) {
      return runTool('read_symbol_definition', args, () => searchRaw(`function ${args.symbol}`, args.limit));
    },
    readSymbolReferences(args) {
      return runTool('read_symbol_references', args, () => searchRaw(args.symbol, args.limit));
    },
    readRelatedTests(args) {
      const query = args.symbol ?? args.path ?? '';
      return runTool('read_related_tests', args, () => searchRaw(query, args.limit, true));
    },
  };
}
```

Then add `createLocalReadTools(...)` below the handlers in the same file:

```ts
export function createLocalReadTools(input: LocalReadToolInput) {
  const handlers = createLocalReadToolHandlers(input);

  return [
    tool(handlers.readFileWindow, {
      name: 'read_file_window',
      description: 'Read a bounded line window from a file under the target repository.',
      schema: z.object({
        path: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      }),
    }),
    tool(handlers.searchRepoText, {
      name: 'search_repo_text',
      description: 'Search literal text in the repository and return matching file lines.',
      schema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readSymbolDefinition, {
      name: 'read_symbol_definition',
      description: 'Find likely definition lines for a symbol by literal search.',
      schema: z.object({
        symbol: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readSymbolReferences, {
      name: 'read_symbol_references',
      description: 'Find likely references for a symbol by literal search.',
      schema: z.object({
        symbol: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readRelatedTests, {
      name: 'read_related_tests',
      description: 'Find likely test anchors related to a path or symbol.',
      schema: z.object({
        path: z.string().optional(),
        symbol: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
    }),
  ];
}
```

- [ ] **Step 4: Export local read tools**

Modify `src/agent-read-runtime/index.ts`:

```ts
export {
  createLocalReadToolHandlers,
  createLocalReadTools,
  type LocalReadToolHandlers,
} from './local-read-tools.js';
```

- [ ] **Step 5: Run tool tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/local-read-tools.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/local-read-tools.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/agent-read-runtime/local-read-tools.ts src/agent-read-runtime/index.ts tests/unit/agent-read-runtime/local-read-tools.test.ts
git commit -m "feat: add local knowledge read tools"
```

## Task 6: Implement LangGraph Runtime Wrapper

**Files:**
- Create: `src/agent-read-runtime/graph-runtime.ts`
- Modify: `src/agent-read-runtime/index.ts`
- Create: `tests/unit/agent-read-runtime/graph-runtime.test.ts`

- [ ] **Step 1: Write failing parsing tests**

Create `tests/unit/agent-read-runtime/graph-runtime.test.ts` with:

```ts
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

  it('routes to output validation after budget is exhausted', () => {
    const next = routeAfterBudgetCheck({
      budgetExceeded: true,
      finalText: undefined,
    });

    expect(next).toBe('output_validate');
  });
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
Cannot find module '../../../src/agent-read-runtime/graph-runtime.js'
```

- [ ] **Step 3: Implement runtime wrapper**

Create `src/agent-read-runtime/graph-runtime.ts` with:

```ts
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { END, START, StateGraph } from '@langchain/langgraph';
import { withRetry } from '../generation/retry.js';
import { createBudgetState, resolveKnowledgeReadLimits } from './context-budget.js';
import { createLocalReadTools } from './local-read-tools.js';
import { createTraceCollector } from './trace.js';
import {
  KnowledgeReadAgentOutputSchema,
  type KnowledgeReadResult,
  type KnowledgeReadRuntimeInput,
} from './types.js';

const SYSTEM_PROMPT = `You are a repository evidence reader for a knowledge generation pipeline.
Use only the provided local read tools to inspect repository evidence.
Do not request whole-repository reads.
Do not invent facts.
If evidence is insufficient, set insufficient_evidence to true.
Return only JSON with keys: answer, evidence_refs, insufficient_evidence.`;

interface GraphRuntimeState {
  messages: Array<HumanMessage | AIMessage | ToolMessage>;
  finalText?: string;
  budgetExceeded: boolean;
  repairAttempts: number;
}

export function routeAfterBudgetCheck(state: Pick<GraphRuntimeState, 'budgetExceeded' | 'finalText'>): 'model_decide' | 'output_validate' {
  if (state.finalText || state.budgetExceeded) {
    return 'output_validate';
  }
  return 'model_decide';
}

export function parseKnowledgeReadAgentOutput(text: string): Omit<KnowledgeReadResult, 'toolCallsUsed' | 'trace'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Agent output is not valid JSON');
  }

  const output = KnowledgeReadAgentOutputSchema.parse(parsed);
  return {
    answer: output.answer,
    evidenceRefs: output.evidence_refs.map((ref) => ({
      file: ref.file,
      startLine: ref.start_line,
      endLine: ref.end_line,
      note: ref.note,
    })),
    insufficientEvidence: output.insufficient_evidence,
  };
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

export async function runKnowledgeReadRuntime(input: KnowledgeReadRuntimeInput): Promise<KnowledgeReadResult> {
  const limits = resolveKnowledgeReadLimits(input.limits);
  const budget = createBudgetState(limits);
  const trace = createTraceCollector();
  const tools = createLocalReadTools({
    repoPath: input.repoPath,
    budget,
    trace,
  });
  const toolMap = new Map(tools.map((item) => [item.name, item]));

  const model = new ChatOpenAI({
    model: input.model,
    apiKey: input.apiKey,
    configuration: {
      baseURL: input.baseUrl,
    },
    temperature: 0,
  }).bindTools(tools);

  const userPrompt = [
    SYSTEM_PROMPT,
    input.initialContext ? `Initial context:\n${input.initialContext}` : '',
    `Instruction:\n${input.instruction}`,
  ].filter(Boolean).join('\n\n');

  const graph = new StateGraph<GraphRuntimeState>({
    channels: {
      messages: {
        value: (left, right) => [...left, ...right],
        default: () => [],
      },
      finalText: {
        value: (_left, right) => right,
        default: () => undefined,
      },
      budgetExceeded: {
        value: (_left, right) => right,
        default: () => false,
      },
      repairAttempts: {
        value: (_left, right) => right,
        default: () => 0,
      },
    },
  })
    .addNode('model_decide', async (state) => {
      const response = await model.invoke(state.messages);
      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return {
          messages: [response],
          finalText: messageContentToText(response.content),
        };
      }
      return { messages: [response] };
    })
    .addNode('tool_execute', async (state) => {
      const last = state.messages[state.messages.length - 1];
      if (!(last instanceof AIMessage)) {
        return {};
      }
      const toolMessages: ToolMessage[] = [];
      for (const call of last.tool_calls ?? []) {
        const selected = toolMap.get(call.name);
        const content = selected
          ? String(await selected.invoke(call.args ?? {}))
          : `unknown tool: ${call.name}`;
        toolMessages.push(new ToolMessage({
          content,
          tool_call_id: call.id ?? call.name,
        }));
      }
      return {
        messages: toolMessages,
        budgetExceeded: budget.toolCallsUsed >= budget.limits.maxToolCalls
          || budget.totalToolResultChars >= budget.limits.maxTotalToolResultChars,
      };
    })
    .addNode('budget_check', async (state) => state)
    .addNode('output_validate', async (state) => state)
    .addEdge(START, 'model_decide')
    .addConditionalEdges('model_decide', (state) => {
      const last = state.messages[state.messages.length - 1];
      if (last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0) {
        return 'tool_execute';
      }
      return 'output_validate';
    }, {
      tool_execute: 'tool_execute',
      output_validate: 'output_validate',
    })
    .addEdge('tool_execute', 'budget_check')
    .addConditionalEdges('budget_check', routeAfterBudgetCheck, {
      model_decide: 'model_decide',
      output_validate: 'output_validate',
    })
    .addEdge('output_validate', END)
    .compile();

  const response = await withRetry(
    () => graph.invoke({
      messages: [new HumanMessage(userPrompt)],
      budgetExceeded: false,
      repairAttempts: 0,
    }),
    { maxRetries: 3, delayMs: 1000 },
  );
  const finalText = response.finalText ?? messageContentToText(response.messages[response.messages.length - 1]?.content);
  const parsed = parseKnowledgeReadAgentOutput(finalText);
  const finalizedTrace = trace.finalize();

  return {
    ...parsed,
    toolCallsUsed: budget.toolCallsUsed,
    trace: finalizedTrace,
  };
}
```

- [ ] **Step 4: Export runtime**

Modify `src/agent-read-runtime/index.ts`:

```ts
export {
  parseKnowledgeReadAgentOutput,
  routeAfterBudgetCheck,
  runKnowledgeReadRuntime,
} from './graph-runtime.js';
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

Expected:

```text
PASS tests/unit/agent-read-runtime/graph-runtime.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/agent-read-runtime/graph-runtime.ts src/agent-read-runtime/index.ts tests/unit/agent-read-runtime/graph-runtime.test.ts
git commit -m "feat: add langgraph knowledge read runtime"
```

## Task 7: Add A CLI-Free Smoke Script For Manual Verification

**Files:**
- Create: `scripts/debug-knowledge-read-runtime.mts`

- [ ] **Step 1: Create smoke script**

Create `scripts/debug-knowledge-read-runtime.mts` with:

```ts
import { resolveModelConfig, loadDefaultLlmConfigFile } from '../src/config/model-config.js';
import { runKnowledgeReadRuntime } from '../src/agent-read-runtime/index.js';

const repoPath = process.argv[2] ?? process.cwd();
const instruction = process.argv.slice(3).join(' ') || 'Find the package name and cite the file evidence.';
const fileConfig = await loadDefaultLlmConfigFile();
const modelConfig = resolveModelConfig({ fileConfig });

const result = await runKnowledgeReadRuntime({
  repoPath,
  instruction,
  model: modelConfig.model,
  baseUrl: modelConfig.baseUrl,
  apiKey: modelConfig.apiKey,
});

console.log(JSON.stringify(result, null, 2));
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

- [ ] **Step 3: Run the script in mock-free local mode**

Run with a real configured provider:

```bash
npx tsx scripts/debug-knowledge-read-runtime.mts D:\workspace\ai-wiki "Read package.json and identify the CLI binary name with evidence."
```

Expected:

```text
{
  "answer": "...",
  "evidenceRefs": [
    {
      "file": "package.json",
      "startLine": ...,
      "endLine": ...,
      "note": "..."
    }
  ],
  "insufficientEvidence": false,
  "toolCallsUsed": ...
}
```

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/debug-knowledge-read-runtime.mts
git commit -m "chore: add knowledge read runtime smoke script"
```

## Task 8: Full Verification

**Files:**
- All files changed in previous tasks

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

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected:

```text
all tests pass
```

- [ ] **Step 5: Commit verification fixes**

If verification required small fixes, commit them:

```bash
git add src/agent-read-runtime tests/unit/agent-read-runtime scripts/debug-knowledge-read-runtime.mts package.json package-lock.json
git commit -m "test: verify knowledge read runtime"
```

If no fixes were needed, do not create an empty commit.

## Implementation Notes

- Keep all tools read-only.
- Do not add MCP in this implementation.
- Do not add `deepagents` in this implementation.
- Do not use `langchain createAgent` as the main runtime loop.
- Do not wire this runtime into `src/cli/generate.ts` yet.
- Do not expose shell execution to the model.
- Do not allow absolute paths outside `repoPath`.
- Keep comments in Chinese if comments are added to source files.

## Self-Review Checklist

- Spec coverage: tasks cover framework dependency, local tools, budget, trace, graph runtime wrapper, and verification.
- Placeholder scan: this plan has no deferred sections or unspecified behavior.
- Type consistency: `KnowledgeReadResult`, `KnowledgeReadLimits`, `TraceCollector`, and runtime exports are consistently named across tasks.
- Scope check: this plan intentionally excludes business knowledge object generation and MCP.
