# Capability LangGraph LLM Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `generate-capability` always use a LangGraph-based LLM claims runtime that repairs and validates model output before claims are accepted.

**Architecture:** Add a capability-specific LangGraph runtime under `src/generation`, wire it into the existing `claimsProvider(bundle)` boundary, strengthen pipeline success semantics, and keep existing `agent-read-runtime` tests green.

**Tech Stack:** TypeScript strict mode, `@langchain/langgraph`, `@langchain/openai`, existing model config, zod validation, Vitest, real validation on `music-education-app`.

---

## Requirements

- Do not use `git worktree`.
- Do not create a second LLM config system.
- Do not move business logic into `src/cli/`.
- Do not let LLM decide object IDs or file paths.
- Do not let LLM read the full repository.
- `generation/` may call LangGraph/model APIs; `packaging/` writes files.
- Real validation must use `D:\workspace\other_project\music-education-app`.
- Remove `--llm` and `--require-llm`; capability knowledge generation is always LLM-backed.
- A run with missing model config/API key or no accepted non-OPEN LLM claim must fail.

## Files

- Create: `src/generation/capability-langgraph-claims-runtime.ts`
- Create: `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/generation/capability-llm-claims-provider.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Strengthen Prompt Allowed Enums

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add failing prompt test**

Add:

```ts
it('lists allowed sddStageUses values for LLM output', () => {
  const bundle = makeBundle({
    capabilityHints: { nameCandidates: ['Goods Order capability'], relatedTerms: ['goods', 'order'] },
  });

  const prompt = buildCapabilityClaimPrompt(bundle);

  expect(prompt).toContain('sddStageUses allowed values');
  expect(prompt).toContain('requirement_clarification');
  expect(prompt).toContain('implementation_planning');
  expect(prompt).toContain('Do not invent other stage names');
});
```

- [ ] **Step 2: Update prompt**

In `buildCapabilityClaimPrompt()`, add:

```ts
lines.push('');
lines.push('ALLOWED ENUM VALUES:');
lines.push('suggestedType: CAP, TERM, FLOW, MOD, CON, VER, OPEN');
lines.push('confidence: high, medium, low');
lines.push('sddStageUses allowed values:');
lines.push('- requirement_clarification');
lines.push('- requirement_specification');
lines.push('- design_planning');
lines.push('- implementation_planning');
lines.push('- coding');
lines.push('- review');
lines.push('- validation');
lines.push('Do not invent other stage names.');
```

- [ ] **Step 3: Run test**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 2: Implement Capability LangGraph Runtime

**Files:**
- Create: `src/generation/capability-langgraph-claims-runtime.ts`
- Create: `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`

- [ ] **Step 1: Add tests**

Create `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`:

```ts
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';
import { runCapabilityClaimsLangGraph } from '../../../src/generation/capability-langgraph-claims-runtime.js';

function makeBundle(): EvidenceBundle {
  return {
    bundleId: 'BUNDLE-GOODS-ORDER',
    candidateId: 'CAND-GOODS-ORDER',
    repoProfile: { name: 'music-education-app' },
    confidence: 0.85,
    risks: [],
    capabilityHints: { nameCandidates: ['Goods Order capability'], relatedTerms: ['goods', 'order'] },
    entryPoints: [
      {
        ref: 'evidence://entry/EP-001',
        kind: 'service',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
        description: 'Spring service entry',
        matchedTerms: ['goods', 'order'],
        targetRelevance: 0.75,
      },
    ],
    flowTraces: [],
    behaviorSlices: [],
    dataContracts: [],
    moduleSurfaces: [],
    validationAnchors: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

function makeModel(outputs: string[]) {
  let index = 0;
  return {
    async invoke() {
      const content = outputs[index] ?? outputs[outputs.length - 1] ?? '[]';
      index += 1;
      return new AIMessage(content);
    },
  };
}

describe('runCapabilityClaimsLangGraph', () => {
  it('accepts valid model JSON with evidence-backed non-OPEN claim', async () => {
    const result = await runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: 'test-model',
      model: makeModel([
        JSON.stringify([
          {
            suggestedType: 'CAP',
            claimText: 'Goods Order capability is supported by OrderGoodsService.',
            confidence: 'medium',
            evidenceRefs: ['evidence://entry/EP-001'],
            decisionPoints: ['matched_capability'],
            sddStageUses: ['requirement_clarification'],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: 'Goods Order capability' },
          },
        ]),
      ]),
    });

    expect(result.claims).toHaveLength(1);
    expect(result.graphTrace.attempts).toBe(1);
    expect(result.graphTrace.repaired).toBe(false);
  });

  it('repairs invalid JSON once and accepts repaired claims', async () => {
    const result = await runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: 'test-model',
      model: makeModel([
        'not-json',
        JSON.stringify([
          {
            suggestedType: 'CAP',
            claimText: 'Goods Order capability is supported by OrderGoodsService.',
            confidence: 'medium',
            evidenceRefs: ['evidence://entry/EP-001'],
            decisionPoints: ['matched_capability'],
            sddStageUses: ['requirement_clarification'],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: 'Goods Order capability' },
          },
        ]),
      ]),
    });

    expect(result.claims).toHaveLength(1);
    expect(result.graphTrace.attempts).toBe(2);
    expect(result.graphTrace.repaired).toBe(true);
    expect(result.graphTrace.validationErrors.length).toBeGreaterThan(0);
  });

  it('fails when no accepted non-OPEN claim remains after evidence filtering', async () => {
    await expect(runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: 'test-model',
      model: makeModel([
        JSON.stringify([
          {
            suggestedType: 'CAP',
            claimText: 'Unsupported claim.',
            confidence: 'medium',
            evidenceRefs: ['evidence://entry/MISSING'],
            decisionPoints: [],
            sddStageUses: ['requirement_clarification'],
            unsupportedParts: [],
            blockedDecisions: [],
          },
        ]),
      ]),
    })).rejects.toThrow(/accepted non-OPEN/);
  });
});
```

- [ ] **Step 2: Implement runtime**

Create `src/generation/capability-langgraph-claims-runtime.ts`:

```ts
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { END, START, StateGraph, Annotation } from '@langchain/langgraph';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import { buildCapabilityClaimPrompt, filterCandidateClaims, type CandidateClaim } from './capability-claim-generator.js';
import { parseCapabilityClaimJson } from './capability-llm-claims-provider.js';

type ModelLike = {
  invoke(messages: unknown): Promise<AIMessage>;
};

export interface RunCapabilityClaimsLangGraphInput {
  bundle: EvidenceBundle;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  model?: ModelLike;
}

export interface CapabilityClaimsLangGraphResult {
  claims: CandidateClaim[];
  rawText: string;
  repairedText?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  graphTrace: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
}

const State = Annotation.Root({
  rawText: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  repairedText: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  claims: Annotation<CandidateClaim[] | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  validationError: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  validationErrors: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  attempts: Annotation<number>({ reducer: (_, value) => value, default: () => 0 }),
  repaired: Annotation<boolean>({ reducer: (_, value) => value, default: () => false }),
});

function messageToText(message: AIMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) return String((item as { text: unknown }).text);
      return '';
    }).join('');
  }
  return '';
}

function validateAcceptedClaims(text: string, bundle: EvidenceBundle): CandidateClaim[] {
  const parsed = parseCapabilityClaimJson(text);
  const filtered = filterCandidateClaims(parsed, bundle);
  if (!filtered.some((claim) => claim.suggestedType !== 'OPEN')) {
    throw new Error('LangGraph LLM output has no accepted non-OPEN claim after evidence filtering');
  }
  return filtered;
}

function buildSystemPrompt(): string {
  return [
    'You generate evidence-grounded capability knowledge claims for AI agents.',
    'Return only strict JSON array.',
    'Use only listed evidence refs.',
    'The program decides object IDs, paths, catalog, and package structure.',
  ].join('\n');
}

function buildRepairPrompt(rawText: string | undefined, error: string | undefined, userPrompt: string): string {
  return [
    'Repair the previous output into a strict JSON array matching the requested schema.',
    'Do not add markdown fences.',
    'Use only allowed sddStageUses enum values from the original instruction.',
    'Use only evidence refs listed in the original instruction.',
    '',
    `Validation error: ${error ?? 'unknown'}`,
    '',
    'Original instruction:',
    userPrompt,
    '',
    'Previous output:',
    rawText ?? '',
  ].join('\n');
}

export async function runCapabilityClaimsLangGraph(input: RunCapabilityClaimsLangGraphInput): Promise<CapabilityClaimsLangGraphResult> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildCapabilityClaimPrompt(input.bundle);
  const model = input.model ?? new ChatOpenAI({
    model: input.modelName,
    apiKey: input.apiKey,
    configuration: input.baseUrl ? { baseURL: input.baseUrl } : undefined,
    temperature: 0,
  });

  const graph = new StateGraph(State)
    .addNode('model_generate', async () => {
      const response = await model.invoke([
        new HumanMessage(`${systemPrompt}\n\n${userPrompt}`),
      ]);
      return {
        rawText: messageToText(response),
        attempts: 1,
      };
    })
    .addNode('parse_validate', async (state) => {
      const text = state.repairedText ?? state.rawText ?? '';
      try {
        return {
          claims: validateAcceptedClaims(text, input.bundle),
          validationError: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          validationError: message,
          validationErrors: [message],
        };
      }
    })
    .addNode('repair_json', async (state) => {
      const response = await model.invoke([
        new HumanMessage(buildRepairPrompt(state.rawText, state.validationError, userPrompt)),
      ]);
      return {
        repairedText: messageToText(response),
        attempts: 2,
        repaired: true,
      };
    })
    .addNode('failed', async (state) => {
      throw new Error(state.validationError ?? 'Capability LangGraph claim generation failed');
    })
    .addEdge(START, 'model_generate')
    .addEdge('model_generate', 'parse_validate')
    .addConditionalEdges('parse_validate', (state) => {
      if (state.claims) return END;
      if (state.attempts < 2) return 'repair_json';
      return 'failed';
    }, {
      [END]: END,
      repair_json: 'repair_json',
      failed: 'failed',
    })
    .addEdge('repair_json', 'parse_validate')
    .addEdge('failed', END)
    .compile();

  const result = await graph.invoke({});

  if (!result.claims) {
    throw new Error(result.validationError ?? 'Capability LangGraph claim generation failed');
  }

  return {
    claims: result.claims,
    rawText: result.rawText ?? '',
    repairedText: result.repairedText,
    model: input.modelName,
    systemPrompt,
    userPrompt,
    graphTrace: {
      attempts: result.attempts,
      repaired: result.repaired,
      validationErrors: result.validationErrors,
    },
  };
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-langgraph-claims-runtime.test.ts
```

Expected: pass.

## Task 3: Route Capability Provider Through LangGraph

**Files:**
- Modify: `src/generation/capability-llm-claims-provider.ts`
- Modify: `tests/unit/generation/capability-llm-claims-provider.test.ts`

- [ ] **Step 1: Update provider to wrap LangGraph runtime**

Replace direct prompt/generate parsing in `createCapabilityLlmClaimsProvider()` with a call to `runCapabilityClaimsLangGraph()`.

Provider input should become:

```ts
export interface CreateCapabilityLlmClaimsProviderInput {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  modelInstance?: {
    invoke(messages: unknown): Promise<AIMessage>;
  };
}
```

Implementation:

```ts
const result = await runCapabilityClaimsLangGraph({
  bundle,
  modelName: input.model,
  apiKey: input.apiKey,
  baseUrl: input.baseUrl,
  model: input.modelInstance,
});

return {
  claims: result.claims,
  rawText: result.repairedText ?? result.rawText,
  model: result.model,
  systemPrompt: result.systemPrompt,
  userPrompt: result.userPrompt,
  graphTrace: result.graphTrace,
};
```

- [ ] **Step 2: Keep `parseCapabilityClaimJson()` export**

Do not delete `parseCapabilityClaimJson()`. Runtime tests and future diagnostics still use it.

- [ ] **Step 3: Update tests**

Adjust provider tests to inject `modelInstance` instead of `generate()`.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-llm-claims-provider.test.ts tests/unit/generation/capability-langgraph-claims-runtime.test.ts
```

Expected: pass.

## Task 4: Make Pipeline LLM Success Mandatory

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Add failing test**

Add:

```ts
it('throws when provider claims are all filtered out', async () => {
  await expect(runCapabilityKnowledgePipeline({
    repoRoot,
    targetTerms: ['goods', 'order'],
    targetPaths: ['src'],
    claimsProvider: async () => ({
      claims: [
        {
          suggestedType: 'CAP',
          claimText: 'Unsupported LLM claim.',
          confidence: 'medium',
          evidenceRefs: ['evidence://missing/REF-001'],
          decisionPoints: [],
          sddStageUses: ['requirement_clarification'],
          unsupportedParts: [],
          blockedDecisions: [],
        },
      ],
    }),
  })).rejects.toThrow(/accepted non-OPEN/);
});
```

Add another test:

```ts
it('throws when no claimsProvider is supplied', async () => {
  await expect(runCapabilityKnowledgePipeline({
    repoRoot,
    targetTerms: ['goods', 'order'],
    targetPaths: ['src'],
  })).rejects.toThrow(/LLM claimsProvider is required/);
});
```

- [ ] **Step 2: Move success decision after filtering**

In pipeline:

1. At the start of pipeline, require `claimsProvider`:

```ts
if (!claimsProvider) {
  throw new Error('LLM claimsProvider is required for capability knowledge generation');
}
```

2. Do not set `llmSucceeded = true` immediately after provider returns.
3. After `filteredProviderClaims` is computed:

```ts
const hasAcceptedNonOpenProviderClaim = filteredProviderClaims.some(claim => claim.suggestedType !== 'OPEN');

if (!hasAcceptedNonOpenProviderClaim) {
  llmSucceeded = false;
  llmError = llmError ?? 'LLM generation produced no accepted non-OPEN claims after evidence filtering';
  throw new Error(`LLM generation failed: ${llmError}`);
}

llmSucceeded = true;
```

4. Keep skeleton claims only as supplemental claims after at least one LLM non-OPEN claim has been accepted.

- [ ] **Step 3: Avoid double wrapping LLM errors**

When catching errors that already start with:

```text
LLM generation failed:
```

rethrow as-is.

- [ ] **Step 4: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 5: Add LangGraph Metadata To Report

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Extend report type**

Add:

```ts
llmRuntime?: 'direct' | 'langgraph';
graph?: {
  attempts: number;
  repaired: boolean;
  validationErrors: string[];
};
```

- [ ] **Step 2: Include graph metadata**

Pipeline should pass provider debug graph trace into report:

```ts
llmRuntime: 'langgraph',
graph: providerDebug?.graphTrace,
```

If current debug type lacks `graphTrace`, add it:

```ts
graphTrace?: {
  attempts: number;
  repaired: boolean;
  validationErrors: string[];
};
```

- [ ] **Step 3: Update writer test**

Assert report JSON can include:

```json
"llmRuntime": "langgraph"
```

- [ ] **Step 4: Run packaging/pipeline tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 6: Wire CLI To Mandatory LangGraph Provider

**Files:**
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Remove direct generateWithClient usage from capability CLI**

`src/cli/generate-capability.ts` must no longer import:

```ts
generateWithClient
createOpenAiClient
```

Instead, pass model config to `createCapabilityLlmClaimsProvider()`:

```ts
const provider = createCapabilityLlmClaimsProvider({
  model: resolvedConfig.model,
  apiKey: resolvedConfig.apiKey,
  baseUrl: resolvedConfig.baseUrl,
});
```

Also remove support for:

```text
--llm
--require-llm
```

from `src/cli/index.ts` and `RunGenerateCapabilityOptions`.

- [ ] **Step 2: Keep existing config resolution**

Continue using:

```ts
loadDefaultLlmConfigFile
loadLlmConfigFile
resolveModelConfig
```

Do not add new config options.

If API key is missing, throw before discovery:

```ts
throw new Error(`LLM API key is missing. Set ${resolvedConfig.apiKeyEnv} or provide apiKey in llm config.`);
```

- [ ] **Step 3: Print runtime**

Verbose output should include:

```text
LLM runtime: langgraph
```

for every `generate-capability` run.

- [ ] **Step 4: Update integration assertions**

Update integration tests:

- remove optional fallback tests for `--llm`
- remove required-mode tests for `--require-llm`
- add a test that `generate-capability --llm` fails as an unknown option
- add a test that `generate-capability --require-llm` fails as an unknown option
- assert report contains:

```ts
expect(report.llmRuntime).toBe('langgraph');
```

- [ ] **Step 5: Run integration tests**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 7: Verify Existing LangGraph Runtime Still Works

**Files:**
- No source changes unless tests fail.

- [ ] **Step 1: Run agent read runtime tests**

Run:

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts tests/unit/agent-read-runtime/local-read-tools.test.ts tests/unit/agent-read-runtime/context-budget.test.ts
```

Expected: pass.

- [ ] **Step 2: Confirm no API break**

Check:

```bash
rg -n "runKnowledgeReadRuntime|StateGraph|ChatOpenAI" src tests
```

Expected:

- `runKnowledgeReadRuntime` signature unchanged.
- Existing tests still inject fake model successfully.

## Task 8: Full Verification

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Mandatory LangGraph Validation

**Files:**
- No source changes unless validation fails.

- [ ] **Step 1: Run real command**

Use config file:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-langgraph-validation --llm-config D:\workspace\ai-wiki\llm.config.json --verbose
```

Or env. Use the model and API key env configured on this machine. This example uses `qianfan-code-latest` and `OPENAI_API_KEY`:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-langgraph-validation --model qianfan-code-latest --api-key-env OPENAI_API_KEY --verbose
```

Expected:

```text
LLM runtime: langgraph
Succeeded: true
```

- [ ] **Step 2: Inspect report**

```bash
Get-Content D:\tmp\music-education-app-capability-langgraph-validation\bootstrap-knowledge\reports\capability-generation.json
```

Expected:

```json
"llmRuntime": "langgraph"
"llmCalled": true
"llmSucceeded": true
```

- [ ] **Step 3: Inspect generated object quality**

```bash
rg -n "MyBatis evidence processing|TERM-MYBATIS-MAPPER|service_implementation|data_access_layer|business_logic|persistence_layer|is a discovered business capability supported by repository evidence|has a repository-derived execution flow|is a data or schema contract related" D:\tmp\music-education-app-capability-langgraph-validation\bootstrap-knowledge
```

Expected:

```text
no matches
```

- [ ] **Step 4: Verify evidence refs**

```powershell
$root = "D:\tmp\music-education-app-capability-langgraph-validation\bootstrap-knowledge"
$indexRefs = Get-Content "$root\evidence\index.jsonl" | ForEach-Object { ($_ | ConvertFrom-Json).ref }
$objectRefs = rg --no-filename -o "evidence://[A-Za-z0-9/.-]+" "$root\objects"
$missing = $objectRefs | Where-Object { $_ -notin $indexRefs } | Sort-Object -Unique
if ($missing) { $missing; exit 1 } else { "all evidence refs resolved" }
```

Expected:

```text
all evidence refs resolved
```

## Task 10: Final Review Checklist

**Files:**
- Review only.

- [ ] **Step 1: Check architecture boundaries**

Confirm:

- `src/cli/generate-capability.ts` only resolves options/config and calls pipeline.
- LangGraph orchestration lives in `src/generation`.
- File writes remain in `src/packaging`.
- LLM does not decide IDs/paths.

- [ ] **Step 2: Check status**

```bash
git status --short
```

Expected:

- generated `bootstrap-knowledge/` under repo root is not committed unless explicitly required.
- `D:\tmp` validation output is not in git.

- [ ] **Step 3: Final response**

Report:

```text
LLM runtime: langgraph
LLM called: yes/no
LLM succeeded: yes/no
Graph attempts:
Graph repaired: yes/no
LLM accepted claims:
Skeleton added claims:
Generated capability:
Evidence refs verified: yes/no
LangGraph base tests passed: yes/no
Real project command:
```
