# Capability LLM Knowledge Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real LLM-backed claim generation to `generate-capability` by reusing the existing model config and LLM client infrastructure while keeping the program responsible for structure, IDs, paths, schema validation, and evidence enforcement.

**Architecture:** Add a capability-specific LLM claims provider under `src/generation`, wire it into `runCapabilityKnowledgePipeline()` through the existing `claimsProvider` boundary, expose CLI LLM options in `generate-capability`, and write reports/debug artifacts through `packaging`.

**Tech Stack:** TypeScript strict mode, OpenAI-compatible `openai` client, existing `ModelConfig`, zod validation, Vitest, Windows PowerShell real-project validation.

---

## Requirements

- Do not use `git worktree`.
- Do not put business logic in `src/cli/`.
- Do not let `generation/` write files.
- Only `src/generation/llm-client.ts` may call the model SDK directly.
- LLM must not receive unrestricted full-repo context.
- LLM must not decide object IDs, paths, or object type set.
- `--require-llm` must fail instead of silently falling back.
- Real validation must run against `D:\workspace\other_project\music-education-app`.

## Files

- Create: `src/generation/capability-llm-claims-provider.ts`
- Create: `tests/unit/generation/capability-llm-claims-provider.test.ts`
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Make Capability Prompt Strict JSON

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add a failing prompt test**

Add this test:

```ts
it('instructs the model to return strict JSON only and never invent facts', () => {
  const bundle = makeBundle({
    capabilityHints: { nameCandidates: ['Goods Order capability'], relatedTerms: ['goods', 'order'] },
  });

  const prompt = buildCapabilityClaimPrompt(bundle);

  expect(prompt).toContain('Return strict JSON array only');
  expect(prompt).toContain('do not invent facts');
  expect(prompt).toContain('do not create object IDs or file paths');
  expect(prompt).toContain('missing evidence becomes OPEN');
});
```

Use the existing fixture helper style in this test file.

- [ ] **Step 2: Update `buildCapabilityClaimPrompt()` hard rules**

In `src/generation/capability-claim-generator.ts`, change the hard rules block to include:

```ts
'- Return strict JSON array only; no markdown fences, no prose before or after JSON',
'- use only bundle evidence',
'- every non-OPEN claim cites evidence refs',
'- missing evidence becomes OPEN',
'- do not invent facts',
'- do not mark inference as fact',
'- do not create object IDs or file paths',
'- do not decide directory structure',
'- low confidence non-OPEN claims are rejected',
```

Update the output section to include a compact JSON example matching `CandidateClaimSchema`.

- [ ] **Step 3: Run prompt tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 2: Add Capability LLM Claims Provider

**Files:**
- Create: `src/generation/capability-llm-claims-provider.ts`
- Create: `tests/unit/generation/capability-llm-claims-provider.test.ts`

- [ ] **Step 1: Write provider tests**

Create `tests/unit/generation/capability-llm-claims-provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';
import {
  createCapabilityLlmClaimsProvider,
  parseCapabilityClaimJson,
} from '../../../src/generation/capability-llm-claims-provider.js';

function makeBundle(): EvidenceBundle {
  return {
    bundleId: 'BUNDLE-GOODS-ORDER',
    candidateId: 'CAND-GOODS-ORDER',
    repoProfile: { name: 'music-education-app' },
    confidence: 0.85,
    risks: [],
    capabilityHints: {
      nameCandidates: ['Goods Order capability'],
      relatedTerms: ['goods', 'order'],
    },
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
    flowTraces: [
      {
        ref: 'evidence://flow/FLOW-EVID-001',
        steps: [{ action: 'create order goods', location: 'src/main/java/demo/OrderGoodsService.java' }],
        matchedTerms: ['goods', 'order'],
        targetRelevance: 0.75,
      },
    ],
    behaviorSlices: [],
    dataContracts: [],
    moduleSurfaces: [],
    validationAnchors: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

describe('capability llm claims provider', () => {
  it('parses a strict JSON claim array', () => {
    const claims = parseCapabilityClaimJson(JSON.stringify([
      {
        suggestedType: 'CAP',
        claimText: 'Goods Order capability coordinates order goods behavior.',
        confidence: 'medium',
        evidenceRefs: ['evidence://entry/EP-001'],
        decisionPoints: ['matched_capability'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: { canonicalTerm: 'Goods Order capability' },
      },
    ]));

    expect(claims).toHaveLength(1);
    expect(claims[0]!.suggestedType).toBe('CAP');
  });

  it('parses JSON inside markdown fences when providers wrap output', () => {
    const claims = parseCapabilityClaimJson('```json\\n[]\\n```');
    expect(claims).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCapabilityClaimJson('not-json')).toThrow(/Invalid capability claim JSON/);
  });

  it('calls the injected generator with system and user prompt', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const provider = createCapabilityLlmClaimsProvider({
      model: 'test-model',
      generate: async (system, user) => {
        calls.push({ system, user });
        return JSON.stringify([
          {
            suggestedType: 'CAP',
            claimText: 'Goods Order capability coordinates order goods behavior.',
            confidence: 'medium',
            evidenceRefs: ['evidence://entry/EP-001'],
            decisionPoints: ['matched_capability'],
            sddStageUses: ['requirement_clarification'],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: 'Goods Order capability' },
          },
        ]);
      },
    });

    const result = await provider(makeBundle());

    expect(result.claims).toHaveLength(1);
    expect(result.model).toBe('test-model');
    expect(calls[0]!.system).toContain('You generate evidence-grounded capability knowledge claims');
    expect(calls[0]!.user).toContain('AVAILABLE EVIDENCE REFS');
  });
});
```

- [ ] **Step 2: Implement provider**

Create `src/generation/capability-llm-claims-provider.ts`:

```ts
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import {
  CandidateClaimSchema,
  buildCapabilityClaimPrompt,
  type CandidateClaim,
} from './capability-claim-generator.js';

export interface CapabilityLlmClaimsProviderResult {
  claims: CandidateClaim[];
  rawText: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface CreateCapabilityLlmClaimsProviderInput {
  model: string;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/i);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

export function parseCapabilityClaimJson(text: string): CandidateClaim[] {
  const jsonText = stripJsonFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Invalid capability claim JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Invalid capability claim JSON: expected array');
  }

  return parsed.map((item, index) => {
    const result = CandidateClaimSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`Invalid capability claim at index ${index}: ${result.error.message}`);
    }
    return result.data;
  });
}

export function createCapabilityLlmClaimsProvider(input: CreateCapabilityLlmClaimsProviderInput) {
  return async function provideCapabilityClaims(bundle: EvidenceBundle): Promise<CapabilityLlmClaimsProviderResult> {
    const systemPrompt = [
      'You generate evidence-grounded capability knowledge claims for AI agents.',
      'You must use only the provided evidence bundle.',
      'You must return strict JSON only.',
      'The program will decide object IDs, file paths, object type directories, and final package structure.',
    ].join('\\n');
    const userPrompt = buildCapabilityClaimPrompt(bundle);
    const rawText = await input.generate(systemPrompt, userPrompt);
    const claims = parseCapabilityClaimJson(rawText);

    return {
      claims,
      rawText,
      model: input.model,
      systemPrompt,
      userPrompt,
    };
  };
}
```

- [ ] **Step 3: Run provider tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-llm-claims-provider.test.ts
```

Expected: pass.

## Task 3: Extend Pipeline With LLM Metadata And Required Mode

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Add pipeline tests**

Add tests:

```ts
it('uses provider claims when LLM provider succeeds and records metadata', async () => {
  const result = await runCapabilityKnowledgePipeline({
    repoRoot,
    targetTerms: ['goods', 'order'],
    targetPaths: ['src'],
    claimsProvider: async () => [
      {
        suggestedType: 'CAP',
        claimText: 'LLM generated goods order capability.',
        confidence: 'medium',
        evidenceRefs: ['evidence://entry/EP-001'],
        decisionPoints: ['matched_capability'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: { canonicalTerm: 'Goods Order capability' },
      },
    ],
    llmMode: { requested: true, required: false, model: 'test-model' },
  });

  expect(result.metadata.llm.requested).toBe(true);
  expect(result.metadata.llm.called).toBe(true);
  expect(result.metadata.llm.succeeded).toBe(true);
});

it('falls back to skeleton when optional LLM provider fails', async () => {
  const result = await runCapabilityKnowledgePipeline({
    repoRoot,
    targetTerms: ['goods', 'order'],
    targetPaths: ['src'],
    claimsProvider: async () => {
      throw new Error('model failed');
    },
    llmMode: { requested: true, required: false, model: 'test-model' },
  });

  expect(result.objects.length).toBeGreaterThan(0);
  expect(result.metadata.llm.succeeded).toBe(false);
  expect(result.metadata.llm.fallbackUsed).toBe(true);
});

await expect(runCapabilityKnowledgePipeline({
  repoRoot,
  targetTerms: ['goods', 'order'],
  targetPaths: ['src'],
  claimsProvider: async () => {
    throw new Error('model failed');
  },
  llmMode: { requested: true, required: true, model: 'test-model' },
})).rejects.toThrow(/LLM generation required but failed/);
```

Adapt fixture setup to the existing test file. Use evidence refs that exist in the test fixture.

- [ ] **Step 2: Extend pipeline input/result types**

In `src/knowledge/capability-knowledge-pipeline.ts`, update types:

```ts
export interface CapabilityLlmMode {
  requested: boolean;
  required: boolean;
  model?: string;
}

export interface CapabilityLlmMetadata {
  requested: boolean;
  required: boolean;
  called: boolean;
  succeeded: boolean;
  fallbackUsed: boolean;
  model?: string;
  error?: string;
  rawClaimCount: number;
  acceptedClaimCount: number;
  skeletonClaimCount: number;
  finalClaimCount: number;
}

export interface CapabilityClaimsProviderResult {
  claims: CandidateClaim[];
  debug?: {
    request?: {
      model?: string;
      systemPrompt: string;
      userPrompt: string;
    };
    response?: {
      rawText?: string;
      error?: string;
    };
  };
}
```

Add to input:

```ts
llmMode?: CapabilityLlmMode;
claimsProvider?: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
```

Add to result metadata:

```ts
llm: CapabilityLlmMetadata;
warnings: string[];
```

- [ ] **Step 3: Catch provider failures according to required mode**

Replace direct provider call:

```ts
const providerClaims = claimsProvider ? await claimsProvider() : [];
```

with:

```ts
const llmMode = input.llmMode ?? { requested: Boolean(claimsProvider), required: false };
const warnings: string[] = [];
let providerClaims: CandidateClaim[] = [];
let providerDebug: CapabilityClaimsProviderResult['debug'] | undefined;
let llmCalled = false;
let llmSucceeded = false;
let llmError: string | undefined;

if (claimsProvider) {
  llmCalled = true;
  try {
    const providerResult = await claimsProvider(bundle);
    providerClaims = providerResult.claims;
    providerDebug = providerResult.debug;
    llmSucceeded = true;
  } catch (error) {
    llmError = error instanceof Error ? error.message : String(error);
    if (llmMode.required) {
      throw new Error(`LLM generation required but failed: ${llmError}`);
    }
    warnings.push(`LLM generation failed; using skeleton fallback: ${llmError}`);
  }
}
```

- [ ] **Step 4: Track claim counts**

After filtering and merging:

```ts
const rawClaimCount = providerClaims.length;
const acceptedClaimCount = filteredProviderClaims.length;
const skeletonClaimCount = skeletonClaims.length;
const finalClaimCount = claims.length;
const fallbackUsed = llmMode.requested && !llmSucceeded;
```

Return these in `metadata.llm`.

- [ ] **Step 5: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 4: Write Capability Generation Report And Debug Files

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Add writer tests**

Add:

```ts
it('writes capability generation report and debug files when provided', async () => {
  const files = buildCapabilityKnowledgeFiles({
    objects: [capObject],
    capabilityId: capObject.id,
    evidenceIndex: [],
    report: {
      mode: 'llm',
      llmRequested: true,
      llmRequired: true,
      llmCalled: true,
      llmSucceeded: true,
      model: 'test-model',
      claimCounts: { llmRaw: 1, llmAccepted: 1, skeletonAdded: 0, final: 1 },
      warnings: [],
    },
    debug: {
      request: { model: 'test-model', systemPrompt: 'system', userPrompt: 'user' },
      response: { rawText: '[]' },
    },
  });

  expect(files.map(file => file.path)).toContain('reports/capability-generation.json');
  expect(files.map(file => file.path)).toContain('debug/capability-llm-request.json');
  expect(files.map(file => file.path)).toContain('debug/capability-llm-response.json');
});
```

Use existing `capObject` fixture or create one in the test file.

- [ ] **Step 2: Add report/debug types**

In `src/packaging/capability-knowledge-writer.ts`, add:

```ts
export interface CapabilityGenerationReport {
  mode: 'skeleton' | 'llm';
  llmRequested: boolean;
  llmRequired: boolean;
  llmCalled: boolean;
  llmSucceeded: boolean;
  model?: string;
  claimCounts: {
    llmRaw: number;
    llmAccepted: number;
    skeletonAdded: number;
    final: number;
  };
  warnings: string[];
}

export interface CapabilityLlmDebug {
  request?: {
    model?: string;
    systemPrompt: string;
    userPrompt: string;
  };
  response?: {
    rawText?: string;
    error?: string;
  };
}
```

- [ ] **Step 3: Extend build/write inputs**

Add optional fields:

```ts
report?: CapabilityGenerationReport;
debug?: CapabilityLlmDebug;
```

When present, add files:

```ts
files.push({
  path: 'reports/capability-generation.json',
  content: JSON.stringify(report, null, 2) + '\n',
});

if (debug?.request) {
  files.push({
    path: 'debug/capability-llm-request.json',
    content: JSON.stringify(debug.request, null, 2) + '\n',
  });
}

if (debug?.response) {
  files.push({
    path: 'debug/capability-llm-response.json',
    content: JSON.stringify(debug.response, null, 2) + '\n',
  });
}
```

- [ ] **Step 4: Run packaging tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 5: Wire Report/Debug Through Pipeline Result

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Use provider debug captured during provider execution**

Use the `providerDebug` variable from Task 3. Do not pass mutable debug data from CLI after the pipeline call starts; the provider result must return debug data together with claims.

- [ ] **Step 2: Build report before file generation**

Before `buildCapabilityKnowledgeFiles()`:

```ts
const report = {
  mode: llmMode.requested ? 'llm' as const : 'skeleton' as const,
  llmRequested: llmMode.requested,
  llmRequired: llmMode.required,
  llmCalled,
  llmSucceeded,
  model: llmMode.model,
  claimCounts: {
    llmRaw: rawClaimCount,
    llmAccepted: acceptedClaimCount,
    skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
    final: finalClaimCount,
  },
  warnings,
};
```

Pass:

```ts
const files = buildCapabilityKnowledgeFiles({
  objects,
  capabilityId,
  evidenceIndex,
  report,
  debug: providerDebug,
});
```

- [ ] **Step 3: Include report/debug in result**

Add to result:

```ts
report,
debug: providerDebug,
```

- [ ] **Step 4: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 6: Change claimsProvider To Receive EvidenceBundle

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Change provider type**

In `RunCapabilityKnowledgePipelineInput`, replace the old provider shape:

```ts
claimsProvider?: () => Promise<CandidateClaim[]>;
```

with:

```ts
claimsProvider?: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
```

- [ ] **Step 2: Pass bundle to provider**

Replace:

```ts
providerClaims = await claimsProvider();
```

with:

```ts
const providerResult = await claimsProvider(bundle);
providerClaims = providerResult.claims;
providerDebug = providerResult.debug;
```

- [ ] **Step 3: Fix tests using provider**

Replace old test providers like:

```ts
claimsProvider: async (_bundle) => [claim]
```

with:

```ts
claimsProvider: async (_bundle) => ({ claims: [claim] })
```

- [ ] **Step 4: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 7: Add LLM Options To generate-capability CLI

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add CLI options**

In `src/cli/index.ts`, extend `generate-capability`.

These are not a new LLM configuration system. They mirror the existing `generate` command options and reuse `src/config/model-config.ts` and `src/generation/llm-client.ts`.

```ts
.option('--llm', 'Use LLM to generate capability claims')
.option('--require-llm', 'Fail if LLM generation is unavailable or invalid')
.option('--llm-config <path>', 'Path to JSON LLM config file')
.option('--model <name>', 'LLM model name')
.option('--base-url <url>', 'LLM API base URL')
.option('--api-key-env <name>', 'Environment variable for API key')
```

- [ ] **Step 2: Extend generate-capability options type**

In `src/cli/generate-capability.ts`, extend input type:

```ts
llm?: boolean;
requireLlm?: boolean;
llmConfig?: string;
model?: string;
baseUrl?: string;
apiKeyEnv?: string;
```

- [ ] **Step 3: Resolve model config only when LLM is requested**

Add imports:

```ts
import {
  createOpenAiClient,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
  resolveModelConfig,
} from '../config/model-config.js';
import { getEnvVar } from '../config/env.js';
import { generateWithClient } from '../generation/llm-client.js';
import { createCapabilityLlmClaimsProvider } from '../generation/capability-llm-claims-provider.js';
```

In `runGenerateCapability()`:

```ts
const llmRequested = Boolean(options.llm || options.requireLlm);
const llmRequired = Boolean(options.requireLlm);
let claimsProvider: RunCapabilityKnowledgePipelineInput['claimsProvider'] | undefined;
let modelName: string | undefined;
let llmSetupWarning: string | undefined;

if (llmRequested) {
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile();
  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });
  const apiKey = resolvedConfig.apiKey || getEnvVar(resolvedConfig.apiKeyEnv);
  const modelConfig = { ...resolvedConfig, apiKey };
  modelName = modelConfig.model;

  if (!modelConfig.apiKey) {
    llmSetupWarning = `LLM API key is missing. Set ${modelConfig.apiKeyEnv} or provide apiKey in llm config.`;
    if (llmRequired) {
      throw new Error(llmSetupWarning);
    }
  } else {
    const client = await createOpenAiClient(modelConfig);
    const provider = createCapabilityLlmClaimsProvider({
      model: modelConfig.model,
      generate: async (systemPrompt, userPrompt) => {
        const result = await generateWithClient(client, modelConfig.model, systemPrompt, userPrompt);
        return result.text;
      },
    });

    claimsProvider = async (bundle) => {
      const result = await provider(bundle);
      return {
        claims: result.claims,
        debug: {
          request: {
            model: result.model,
            systemPrompt: result.systemPrompt,
            userPrompt: result.userPrompt,
          },
          response: {
            rawText: result.rawText,
          },
        },
      };
    };
  }
}
```

- [ ] **Step 4: Pass LLM fields into pipeline**

When calling `runCapabilityKnowledgePipeline()`:

```ts
const result = await runCapabilityKnowledgePipeline({
  repoRoot: resolvedRepoPath,
  targetTerms,
  targetPaths,
  claimsProvider,
  llmMode: {
    requested: llmRequested,
    required: llmRequired,
    model: modelName,
  },
  llmSetupError: llmSetupWarning,
});
```

- [ ] **Step 5: Run impacted tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 8: Enforce Optional vs Required LLM CLI Behavior

**Files:**
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add integration test for required LLM without key**

Add:

```ts
it('fails in require-llm mode when API key is unavailable', async () => {
  const result = await execa(
    'node',
    ['dist/cli/index.js', 'generate-capability', repo, '--terms', 'goods,order', '--paths', 'src', '--require-llm', '--api-key-env', 'MISSING_TEST_API_KEY'],
    {
      reject: false,
      env: { ...process.env, MISSING_TEST_API_KEY: '' },
    },
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr + result.stdout).toMatch(/MISSING_TEST_API_KEY|LLM/);
});
```

- [ ] **Step 2: Add integration test for optional LLM without key fallback**

Add:

```ts
it('falls back to skeleton in optional llm mode when API key is unavailable', async () => {
  const result = await execa(
    'node',
    ['dist/cli/index.js', 'generate-capability', repo, '--terms', 'goods,order', '--paths', 'src', '--llm', '--api-key-env', 'MISSING_TEST_API_KEY'],
    {
      reject: false,
      env: { ...process.env, MISSING_TEST_API_KEY: '' },
    },
  );

  expect(result.exitCode).toBe(0);
  const report = JSON.parse(await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'capability-generation.json'), 'utf-8'));
  expect(report.llmRequested).toBe(true);
  expect(report.llmSucceeded).toBe(false);
});
```

- [ ] **Step 3: Implement explicit API key preflight**

In `src/cli/generate-capability.ts`, before creating the client:

```ts
if (!modelConfig.apiKey) {
  const message = `LLM API key is missing. Set ${modelConfig.apiKeyEnv} or provide apiKey in llm config.`;
  if (llmRequired) {
    throw new Error(message);
  }
  llmSetupWarning = message;
}
```

If optional setup warning exists, call pipeline without `claimsProvider` but with:

```ts
llmMode: {
  requested: true,
  required: false,
  model: modelName,
},
llmSetupError: llmSetupWarning,
```

Add `llmSetupError?: string` to pipeline input and include it in warnings/report.

- [ ] **Step 4: Run integration tests**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 9: Fix Technical TERM Leakage

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add regression test for `mybatis mapper`**

Add:

```ts
it('does not emit mybatis mapper as a business TERM', () => {
  const bundle = makeBundle({
    capabilityHints: {
      nameCandidates: ['Goods Order capability'],
      relatedTerms: ['goods', 'order', 'mybatis mapper'],
    },
    entryPoints: [
      {
        ref: 'evidence://entry/EP-001',
        kind: 'service',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
        description: 'Spring service entry',
        targetRelevance: 0.75,
        matchedTerms: ['goods', 'order'],
      },
    ],
  });

  const terms = buildSkeletonClaims(bundle)
    .filter(claim => claim.suggestedType === 'TERM')
    .map(claim => claim.objectHints?.canonicalTerm);

  expect(terms).toContain('goods');
  expect(terms).toContain('order');
  expect(terms).not.toContain('mybatis mapper');
});
```

- [ ] **Step 2: Normalize technical phrases**

In `src/generation/capability-claim-generator.ts`, replace `normalizeTerm()` with:

```ts
function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function isTechnicalTerm(term: string): boolean {
  const normalized = normalizeTerm(term);
  if (TECHNICAL_TERM_HINTS.has(normalized)) return true;
  return normalized.split(' ').some(part => TECHNICAL_TERM_HINTS.has(part));
}
```

Use `isTechnicalTerm()` in `addTermEvidence()` and relatedTerms loop.

- [ ] **Step 3: Run generation tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 10: Full Verification

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: pass.

## Task 11: Real Project LLM Validation

**Files:**
- No source changes unless validation fails.

- [ ] **Step 1: Run real project with required LLM**

Run one of these commands.

With config file:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --llm --require-llm --llm-config D:\workspace\ai-wiki\llm.config.json --verbose
```

With env:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --llm --require-llm --model gpt-4o --api-key-env OPENAI_API_KEY --verbose
```

Expected:

```text
Generated ... files for capability: CAP-...
Object types: CAP, TERM, FLOW, MOD, CON, VER, OPEN
LLM mode: required
```

- [ ] **Step 2: Inspect report**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\reports\capability-generation.json
```

Expected JSON contains:

```json
"llmRequested": true
"llmRequired": true
"llmCalled": true
"llmSucceeded": true
```

- [ ] **Step 3: Inspect generated objects**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\*.md
rg -n "MyBatis evidence processing|TERM-MYBATIS-MAPPER|is a discovered business capability supported by repository evidence|has a repository-derived execution flow|is a data or schema contract related" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects
```

Expected:

- no `MyBatis evidence processing`
- no `TERM-MYBATIS-MAPPER`
- at least CAP/FLOW/CON descriptions are not skeleton default sentences

- [ ] **Step 4: Verify evidence refs**

Run:

```powershell
$root = "D:\tmp\music-education-app-capability-validation\bootstrap-knowledge"
$indexRefs = Get-Content "$root\evidence\index.jsonl" | ForEach-Object { ($_ | ConvertFrom-Json).ref }
$objectRefs = rg --no-filename -o "evidence://[A-Za-z0-9/.-]+" "$root\objects"
$missing = $objectRefs | Where-Object { $_ -notin $indexRefs } | Sort-Object -Unique
if ($missing) { $missing; exit 1 } else { "all evidence refs resolved" }
```

Expected:

```text
all evidence refs resolved
```

## Task 12: Final Implementation Report

**Files:**
- Review only.

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected:

- source/test/docs changes are intentional
- generated `bootstrap-knowledge/` under `D:\workspace\ai-wiki` is not included unless explicitly required
- validation output under `D:\tmp` is not in git

- [ ] **Step 2: Final response format**

Report:

```text
LLM called: yes/no
LLM required: yes/no
Model:
Generated capability:
LLM accepted claims:
Skeleton fallback claims:
Objects generated:
Evidence refs verified: yes/no
Report path:
Real project command:
```
