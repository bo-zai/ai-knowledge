# Generate Knowledge Selection Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `generate` so DB knowledge and business capability knowledge are written into one design-aligned knowledge package, with simple generation selection through `--knowledge` and `--target`.

**Architecture:** `src/cli/` parses arguments only. `src/knowledge/` resolves generation scope and runs DB/capability stages. `src/packaging/` writes one unified `bootstrap-knowledge/` package using the object directory layout from `notes/wiki-agent-knowledge/design`.

**Tech Stack:** TypeScript strict mode, Commander, Vitest, YAML, existing MyBatis DB evidence pipeline, existing LangGraph capability pipeline.

---

## Current Answer

当前 `generate` 已经能生成两类知识：

- 默认路径主要生成 DB 知识。
- 传 `--terms` 或 `--paths` 时生成业务功能知识。

但当前触发方式不清楚，而且 `--slice + --terms/--paths` 会让 DB 和 capability 两套 writer 先后写同一个 `bootstrap-knowledge/`，存在覆盖风险。

本轮改成：

```bash
node dist/cli/index.js generate <repo>
node dist/cli/index.js generate <repo> --knowledge db
node dist/cli/index.js generate <repo> --knowledge capability
node dist/cli/index.js generate <repo> --knowledge all
node dist/cli/index.js generate <repo> --knowledge db --target db:users
node dist/cli/index.js generate <repo> --knowledge capability --target order
```

不传 `--knowledge` 时默认 `all`，也就是生成所有当前支持的 DB 与业务功能知识。

## File Structure

Modify:

- `src/cli/index.ts`
  - Register `--knowledge <db|capability|all>`.
  - Register `--target <selector>`.

- `src/cli/generate.ts`
  - Keep repo/config parsing and console summary only.
  - Remove direct DB evidence building, capability evidence building, and direct package writing.

Create:

- `src/knowledge/generate-scope.ts`
  - Resolve `--knowledge` defaulting and `--target` parsing.
  - Validate ambiguous targets.

- `src/knowledge/generate-orchestrator.ts`
  - Run DB stage, capability stage, or both.
  - Ensure exactly one package write.

- `src/knowledge/db-knowledge-pipeline.ts`
  - Extract current DB/project generation from `src/cli/generate.ts`.
  - Return in-memory contribution.

- `src/packaging/knowledge-package-contribution.ts`
  - Shared contribution interfaces.

- `src/packaging/knowledge-package-writer.ts`
  - Unified writer for object directories, catalog, reports, debug files.

Modify tests:

- `tests/unit/knowledge/generate-scope.test.ts`
- `tests/unit/knowledge/generate-orchestrator.test.ts`
- `tests/unit/knowledge/db-knowledge-pipeline.test.ts`
- `tests/unit/packaging/knowledge-package-writer.test.ts`
- `tests/unit/cli/generate-orchestration.test.ts`
- `tests/integration/generate-capability.test.ts`

Do not use git worktree. Work directly in `D:\workspace\ai-wiki`.

## Required Knowledge Directory Layout

The unified package must follow the design documents:

```text
bootstrap-knowledge/
├── catalog.yaml
├── objects/
│   ├── terms/
│   ├── capabilities/
│   ├── systems/
│   ├── ownership/
│   ├── contracts/
│   ├── flows/
│   ├── modules/
│   ├── validation/
│   ├── decisions/
│   ├── invariants/
│   ├── states/
│   ├── db/
│   └── open/
├── views/
│   ├── capabilities/
│   ├── external-systems/
│   ├── entities/
│   ├── modules/
│   └── runbooks/
├── evidence/
├── reports/
└── debug/
```

Current round only needs to write supported object types:

- DB stage: `objects/db/DB-*.yaml` or existing DB markdown format adapted under `objects/db/`.
- Capability stage: `objects/capabilities/`, `objects/terms/`, `objects/flows/`, `objects/contracts/`, `objects/modules/`, `objects/validation/`, `objects/open/`.

Empty directories do not need to be created.

## Task 1: Add Generate Scope Resolver

**Files:**

- Create: `src/knowledge/generate-scope.ts`
- Test: `tests/unit/knowledge/generate-scope.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/knowledge/generate-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveGenerateScope } from '../../../src/knowledge/generate-scope';

describe('resolveGenerateScope', () => {
  it('defaults to all knowledge when no selector is provided', () => {
    expect(resolveGenerateScope({})).toEqual({
      knowledge: 'all',
      inferred: true,
      inferredFrom: 'default',
      target: undefined,
      legacyArgsUsed: [],
      warnings: [],
    });
  });

  it('accepts db knowledge without target', () => {
    expect(resolveGenerateScope({ knowledge: 'db' }).knowledge).toBe('db');
  });

  it('accepts capability knowledge without target', () => {
    expect(resolveGenerateScope({ knowledge: 'capability' }).knowledge).toBe('capability');
  });

  it('parses db target for db knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'db', target: 'users' }).target).toEqual({
      kind: 'db',
      value: 'users',
    });
  });

  it('parses capability target for capability knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'capability', target: 'order' }).target).toEqual({
      kind: 'capability',
      value: 'order',
    });
  });

  it('requires typed target for all knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'all', target: 'users' })).toThrow(
      '--target must use db:<name> or capability:<name> when --knowledge all is used',
    );
  });

  it('allows typed db target for all knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'all', target: 'db:users' }).target).toEqual({
      kind: 'db',
      value: 'users',
    });
  });

  it('allows typed capability target for all knowledge', () => {
    expect(resolveGenerateScope({ knowledge: 'all', target: 'capability:order' }).target).toEqual({
      kind: 'capability',
      value: 'order',
    });
  });

  it('rejects capability target for db knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'db', target: 'capability:order' })).toThrow(
      '--knowledge db cannot use capability target',
    );
  });

  it('rejects db target for capability knowledge', () => {
    expect(() => resolveGenerateScope({ knowledge: 'capability', target: 'db:users' })).toThrow(
      '--knowledge capability cannot use db target',
    );
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/unit/knowledge/generate-scope.test.ts
```

Expected: FAIL because `src/knowledge/generate-scope.ts` does not exist.

- [ ] **Step 3: Implement resolver**

Create `src/knowledge/generate-scope.ts`:

```ts
export type GenerateKnowledge = 'db' | 'capability' | 'all';

export interface GenerateTarget {
  kind: 'db' | 'capability';
  value: string;
}

export interface ResolveGenerateScopeInput {
  knowledge?: string;
  target?: string;
  terms?: string[];
  paths?: string[];
  slice?: string;
}

export interface ResolvedGenerateScope {
  knowledge: GenerateKnowledge;
  inferred: boolean;
  inferredFrom: 'default' | 'explicit' | 'legacy';
  target?: GenerateTarget;
  legacyArgsUsed: string[];
  warnings: string[];
}

const VALID_KNOWLEDGE = new Set(['db', 'capability', 'all']);

function assertKnowledge(value: string): asserts value is GenerateKnowledge {
  if (!VALID_KNOWLEDGE.has(value)) {
    throw new Error(`Invalid --knowledge value: ${value}. Expected db, capability, or all.`);
  }
}

function parseTypedTarget(raw: string): GenerateTarget | null {
  const separator = raw.indexOf(':');
  if (separator < 0) return null;
  const kind = raw.slice(0, separator);
  const value = raw.slice(separator + 1).trim();
  if ((kind !== 'db' && kind !== 'capability') || value.length === 0) {
    throw new Error('--target must use db:<name> or capability:<name>');
  }
  return { kind, value };
}

function resolveTarget(knowledge: GenerateKnowledge, rawTarget?: string): GenerateTarget | undefined {
  if (!rawTarget) return undefined;

  const typed = parseTypedTarget(rawTarget);
  if (typed) {
    if (knowledge === 'db' && typed.kind !== 'db') {
      throw new Error('--knowledge db cannot use capability target');
    }
    if (knowledge === 'capability' && typed.kind !== 'capability') {
      throw new Error('--knowledge capability cannot use db target');
    }
    return typed;
  }

  if (knowledge === 'all') {
    throw new Error('--target must use db:<name> or capability:<name> when --knowledge all is used');
  }

  return { kind: knowledge, value: rawTarget.trim() };
}

export function resolveGenerateScope(input: ResolveGenerateScopeInput): ResolvedGenerateScope {
  const warnings: string[] = [];
  const legacyArgsUsed: string[] = [];

  if (input.terms && input.terms.length > 0) legacyArgsUsed.push('terms');
  if (input.paths && input.paths.length > 0) legacyArgsUsed.push('paths');
  if (input.slice) legacyArgsUsed.push('slice');

  const rawKnowledge = input.knowledge ?? 'all';
  assertKnowledge(rawKnowledge);

  if (legacyArgsUsed.length > 0) {
    warnings.push('legacy generate filters were used; prefer --knowledge and --target');
  }

  return {
    knowledge: rawKnowledge,
    inferred: !input.knowledge,
    inferredFrom: input.knowledge ? 'explicit' : 'default',
    target: resolveTarget(rawKnowledge, input.target),
    legacyArgsUsed,
    warnings,
  };
}
```

- [ ] **Step 4: Verify scope tests**

Run:

```bash
npx vitest run tests/unit/knowledge/generate-scope.test.ts
```

Expected: PASS.

## Task 2: Register Simplified CLI Parameters

**Files:**

- Modify: `src/cli/index.ts`
- Modify: `src/cli/generate.ts`
- Test: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add CLI help test**

In `tests/integration/generate-capability.test.ts`, add:

```ts
it('documents simplified generate knowledge selection options', async () => {
  const result = await execa('node', ['dist/cli/index.js', 'generate', '--help'], {
    reject: false,
  });

  expect(result.stdout).toContain('--knowledge <db|capability|all>');
  expect(result.stdout).toContain('--target <selector>');
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run build
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: FAIL because help does not include the new options.

- [ ] **Step 3: Register options**

Modify `src/cli/index.ts` command registration:

```ts
.option('--knowledge <db|capability|all>', 'Knowledge type to generate: db, capability, or all. Defaults to all.')
.option('--target <selector>', 'Generate one target, for example db:users or capability:order')
```

Modify `GenerateOptions` in `src/cli/generate.ts`:

```ts
knowledge?: string;
target?: string;
```

- [ ] **Step 4: Verify help test**

Run:

```bash
npm run build
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: PASS for the new help assertion.

## Task 3: Introduce Package Contribution Types

**Files:**

- Create: `src/packaging/knowledge-package-contribution.ts`

- [ ] **Step 1: Create shared types**

Create `src/packaging/knowledge-package-contribution.ts`:

```ts
export interface KnowledgePackageFile {
  path: string;
  content: string;
}

export interface KnowledgePackageObjectRef {
  id: string;
  type: string;
  path: string;
  sliceIds?: string[];
}

export interface KnowledgePackageStageReport {
  stage: 'db' | 'capability';
  ran: boolean;
  succeeded: number;
  failed: number;
  details: Record<string, unknown>;
}

export interface KnowledgePackageContribution {
  stage: 'db' | 'capability';
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: KnowledgePackageStageReport;
  warnings: string[];
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

## Task 4: Implement Unified Package Writer

**Files:**

- Create: `src/packaging/knowledge-package-writer.ts`
- Test: `tests/unit/packaging/knowledge-package-writer.test.ts`

- [ ] **Step 1: Write writer test**

Create `tests/unit/packaging/knowledge-package-writer.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeKnowledgePackage } from '../../../src/packaging/knowledge-package-writer';

describe('writeKnowledgePackage', () => {
  it('writes db and capability objects into design-aligned directories', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'knowledge-package-writer-'));

    await writeKnowledgePackage({
      outputRoot,
      knowledge: 'all',
      target: undefined,
      contributions: [
        {
          stage: 'db',
          files: [{ path: 'objects/db/DB-users.yaml', content: 'id: DB-users\n' }],
          objects: [{ id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.yaml' }],
          report: { stage: 'db', ran: true, succeeded: 1, failed: 0, details: {} },
          warnings: [],
        },
        {
          stage: 'capability',
          files: [{ path: 'objects/capabilities/CAP-ORDER.yaml', content: 'id: CAP-ORDER\n' }],
          objects: [{ id: 'CAP-ORDER', type: 'CAP', path: 'objects/capabilities/CAP-ORDER.yaml' }],
          report: { stage: 'capability', ran: true, succeeded: 1, failed: 0, details: {} },
          warnings: [],
        },
      ],
    });

    const catalog = await readFile(join(outputRoot, 'bootstrap-knowledge', 'catalog.yaml'), 'utf-8');
    expect(catalog).toContain('knowledge: all');
    expect(catalog).toContain('DB-users');
    expect(catalog).toContain('CAP-ORDER');

    const report = await readFile(join(outputRoot, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf-8');
    expect(report).toContain('"knowledge": "all"');
    expect(report).toContain('"db"');
    expect(report).toContain('"capability"');
  });
});
```

- [ ] **Step 2: Implement writer**

Create `src/packaging/knowledge-package-writer.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { GenerateKnowledge, GenerateTarget } from '../knowledge/generate-scope.js';
import type { KnowledgePackageContribution } from './knowledge-package-contribution.js';

export async function writeKnowledgePackage(input: {
  outputRoot: string;
  knowledge: GenerateKnowledge;
  target?: GenerateTarget;
  contributions: KnowledgePackageContribution[];
}): Promise<void> {
  const packageRoot = path.resolve(input.outputRoot, 'bootstrap-knowledge');
  if (path.basename(packageRoot) !== 'bootstrap-knowledge') {
    throw new Error(`Refusing to clean invalid package root: ${packageRoot}`);
  }

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });

  const objects = input.contributions.flatMap(contribution => contribution.objects);
  const catalog = {
    version: 1,
    generation: {
      knowledge: input.knowledge,
      target: input.target ?? null,
    },
    retrieval_order: {
      db_context: ['DB'],
      capability_context: ['CAP', 'TERM', 'FLOW', 'CON', 'MOD', 'VER', 'OPEN'],
    },
    objects: Object.fromEntries(objects.map(object => [
      object.id,
      { type: object.type, path: object.path, slice_ids: object.sliceIds ?? [] },
    ])),
    unknown_escalation_rules: [
      { if_no_term_match_for_core_noun: true },
      { if_external_system_has_no_contract: true },
      { if_no_verification_object_for_capability: true },
      { if_ownership_conflict_detected: true },
    ],
  };

  await fs.writeFile(path.join(packageRoot, 'catalog.yaml'), YAML.stringify(catalog), 'utf-8');

  const report = {
    knowledge: input.knowledge,
    target: input.target ?? null,
    stages: Object.fromEntries(input.contributions.map(contribution => [contribution.stage, contribution.report])),
    warnings: input.contributions.flatMap(contribution => contribution.warnings),
  };

  await fs.mkdir(path.join(packageRoot, 'reports'), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'reports', 'generation.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8',
  );

  for (const contribution of input.contributions) {
    for (const file of contribution.files) {
      if (file.path === 'catalog.yaml' || file.path === 'reports/generation.json') {
        continue;
      }
      const fullPath = path.join(packageRoot, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
    }
  }
}
```

- [ ] **Step 3: Verify writer test**

Run:

```bash
npx vitest run tests/unit/packaging/knowledge-package-writer.test.ts
```

Expected: PASS.

## Task 5: Extract DB Knowledge Pipeline

**Files:**

- Create: `src/knowledge/db-knowledge-pipeline.ts`
- Modify: `src/cli/generate.ts`
- Test: `tests/unit/knowledge/db-knowledge-pipeline.test.ts`

- [ ] **Step 1: Write DB stage report test**

Create `tests/unit/knowledge/db-knowledge-pipeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDbStageReport } from '../../../src/knowledge/db-knowledge-pipeline';

describe('buildDbStageReport', () => {
  it('reports db stage counts and target', () => {
    expect(buildDbStageReport({ succeeded: 1, failed: 0, targetTable: 'users' })).toEqual({
      stage: 'db',
      ran: true,
      succeeded: 1,
      failed: 0,
      details: { targetTable: 'users' },
    });
  });
});
```

- [ ] **Step 2: Implement report helper**

Create `src/knowledge/db-knowledge-pipeline.ts` with this helper first:

```ts
import type { KnowledgePackageStageReport } from '../packaging/knowledge-package-contribution.js';

export function buildDbStageReport(input: {
  succeeded: number;
  failed: number;
  targetTable?: string;
}): KnowledgePackageStageReport {
  return {
    stage: 'db',
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: input.targetTable ? { targetTable: input.targetTable } : {},
  };
}
```

- [ ] **Step 3: Move DB generation out of CLI**

Move the existing project/DB branch from `src/cli/generate.ts` into `runDbKnowledgePipeline`.

The function signature should be:

```ts
import type { GenerateTarget } from './generate-scope.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';

export interface RunDbKnowledgePipelineInput {
  repoPath: string;
  target?: GenerateTarget;
  forceAnalyze?: boolean;
  verbose?: boolean;
  modelConfig: {
    baseUrl: string;
    apiKey: string;
    apiKeyEnv: string;
    model: string;
  };
}

export async function runDbKnowledgePipeline(
  input: RunDbKnowledgePipelineInput,
): Promise<KnowledgePackageContribution> {
  // Extract the current DB generation path from src/cli/generate.ts.
  // It must return files/objects/report and must not write to disk.
}
```

When `input.target?.kind === 'db'`, filter DB bundles to the named table before generating objects.

- [ ] **Step 4: Preserve current DB object schema validation**

Keep using the existing DB schema validation path:

```ts
dbObjectSchema.parse(candidateObject)
```

Do not let the LLM decide DB object ID, object path, or object type.

- [ ] **Step 5: Verify DB tests**

Run:

```bash
npx vitest run tests/unit/knowledge/db-knowledge-pipeline.test.ts tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

## Task 6: Adapt Capability Pipeline To Contribution

**Files:**

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Test: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Add target support to capability pipeline input**

Extend capability pipeline input:

```ts
targetCapability?: string;
generateAllCandidates?: boolean;
```

Behavior:

- `targetCapability` present: choose the best matching candidate and make one LLM call.
- `generateAllCandidates=true`: iterate all selected candidates, one evidence bundle and one LLM call per candidate.

- [ ] **Step 2: Keep one capability per LLM call**

Ensure multi-capability generation loops like this:

```ts
for (const candidate of selectedCandidates) {
  const bundle = await buildEvidenceBundleForCandidate(candidate);
  const claims = await claimsProvider(bundle);
  const packageForCandidate = assembleCapabilityKnowledgeObjects(bundle, claims);
  contributions.push(packageForCandidate);
}
```

Do not batch multiple unrelated capabilities into one prompt.

- [ ] **Step 3: Build contribution from capability files**

Use existing `buildCapabilityKnowledgeFiles` to get files, then adapt them:

```ts
export function capabilityFilesToContribution(input: {
  objects: Array<{ id: string; type: string }>;
  files: Array<{ path: string; content: string }>;
  report: Record<string, unknown>;
}): KnowledgePackageContribution {
  return {
    stage: 'capability',
    files: input.files.filter(file => file.path !== 'catalog.yaml'),
    objects: input.objects.map(object => ({
      id: object.id,
      type: object.type,
      path: input.files.find(file => file.path.includes(`${object.id}.`))?.path ?? `objects/open/${object.id}.yaml`,
    })),
    report: {
      stage: 'capability',
      ran: true,
      succeeded: input.objects.length,
      failed: 0,
      details: input.report,
    },
    warnings: [],
  };
}
```

- [ ] **Step 4: Verify capability tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: PASS.

## Task 7: Create Generate Orchestrator

**Files:**

- Create: `src/knowledge/generate-orchestrator.ts`
- Test: `tests/unit/knowledge/generate-orchestrator.test.ts`

- [ ] **Step 1: Write orchestrator tests**

Create `tests/unit/knowledge/generate-orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runGenerateOrchestration } from '../../../src/knowledge/generate-orchestrator';
import type { KnowledgePackageContribution } from '../../../src/packaging/knowledge-package-contribution';

function contribution(stage: 'db' | 'capability'): KnowledgePackageContribution {
  return {
    stage,
    files: [{ path: `objects/${stage}/${stage}.yaml`, content: stage }],
    objects: [{ id: `${stage.toUpperCase()}-1`, type: stage === 'db' ? 'DB' : 'CAP', path: `objects/${stage}/${stage}.yaml` }],
    report: { stage, ran: true, succeeded: 1, failed: 0, details: {} },
    warnings: [],
  };
}

describe('runGenerateOrchestration', () => {
  it('defaults to all and writes once', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: { knowledge: 'all', inferred: true, inferredFrom: 'default', legacyArgsUsed: [], warnings: [] },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).toHaveBeenCalledTimes(1);
    expect(deps.runCapability).toHaveBeenCalledTimes(1);
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });

  it('runs only db stage for db target', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: {
          knowledge: 'db',
          inferred: false,
          inferredFrom: 'explicit',
          target: { kind: 'db', value: 'users' },
          legacyArgsUsed: [],
          warnings: [],
        },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).toHaveBeenCalledTimes(1);
    expect(deps.runCapability).not.toHaveBeenCalled();
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });

  it('runs only capability stage for capability target in all knowledge', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: {
          knowledge: 'all',
          inferred: false,
          inferredFrom: 'explicit',
          target: { kind: 'capability', value: 'order' },
          legacyArgsUsed: [],
          warnings: [],
        },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).not.toHaveBeenCalled();
    expect(deps.runCapability).toHaveBeenCalledTimes(1);
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement orchestrator**

Create `src/knowledge/generate-orchestrator.ts`:

```ts
import type { ResolvedGenerateScope } from './generate-scope.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';

export interface GenerateOrchestrationInput {
  repoPath: string;
  outputRoot: string;
  scope: ResolvedGenerateScope;
  forceAnalyze?: boolean;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
}

export interface GenerateOrchestrationDeps {
  runDb: (input: GenerateOrchestrationInput) => Promise<KnowledgePackageContribution>;
  runCapability: (input: GenerateOrchestrationInput) => Promise<KnowledgePackageContribution>;
  writePackage: (input: {
    outputRoot: string;
    knowledge: ResolvedGenerateScope['knowledge'];
    target: ResolvedGenerateScope['target'];
    contributions: KnowledgePackageContribution[];
  }) => Promise<void>;
}

function shouldRunDb(scope: ResolvedGenerateScope): boolean {
  if (scope.knowledge === 'db') return true;
  if (scope.knowledge === 'capability') return false;
  return !scope.target || scope.target.kind === 'db';
}

function shouldRunCapability(scope: ResolvedGenerateScope): boolean {
  if (scope.knowledge === 'capability') return true;
  if (scope.knowledge === 'db') return false;
  return !scope.target || scope.target.kind === 'capability';
}

export async function runGenerateOrchestration(input: {
  input: GenerateOrchestrationInput;
  deps: GenerateOrchestrationDeps;
}): Promise<{ contributions: KnowledgePackageContribution[] }> {
  const contributions: KnowledgePackageContribution[] = [];

  if (shouldRunDb(input.input.scope)) {
    contributions.push(await input.deps.runDb(input.input));
  }

  if (shouldRunCapability(input.input.scope)) {
    contributions.push(await input.deps.runCapability(input.input));
  }

  await input.deps.writePackage({
    outputRoot: input.input.outputRoot,
    knowledge: input.input.scope.knowledge,
    target: input.input.scope.target,
    contributions,
  });

  return { contributions };
}
```

- [ ] **Step 3: Verify orchestrator tests**

Run:

```bash
npx vitest run tests/unit/knowledge/generate-orchestrator.test.ts
```

Expected: PASS.

## Task 8: Wire CLI To Scope Resolver And Orchestrator

**Files:**

- Modify: `src/cli/generate.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Resolve scope in CLI**

In `runGenerate`, after parsing legacy lists:

```ts
const scope = resolveGenerateScope({
  knowledge: options.knowledge,
  target: options.target,
  terms: targetTerms,
  paths: targetPaths,
  slice: options.slice,
});
```

Print `scope.warnings` as warnings.

- [ ] **Step 2: Call orchestrator**

Replace the current project/capability branches with:

```ts
await runGenerateOrchestration({
  input: {
    repoPath,
    outputRoot: options.out ? path.resolve(options.out) : repoPath,
    scope,
    forceAnalyze: options.forceAnalyze,
    verbose: options.verbose,
    llm: {
      model: options.model,
      baseUrl: options.baseUrl,
      apiKeyEnv: options.apiKeyEnv,
      llmConfig: options.llmConfig,
    },
  },
  deps: defaultGenerateOrchestrationDeps,
});
```

- [ ] **Step 3: Verify CLI boundary**

Run:

```bash
rg -n "buildDbTableBundle|buildAllDbTableBundles|buildEvidenceBundle|discoverCapabilitiesFromGraph|runCapabilityKnowledgePipeline|writePackage|writeCapabilityKnowledgePackage" src/cli/generate.ts
```

Expected: no output.

- [ ] **Step 4: Verify CLI tests**

Run:

```bash
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

## Task 9: Real Project Validation

**Files:**

- No source changes in this task.

- [ ] **Step 1: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Validate default all generation**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --out D:\tmp\music-education-app-generate-default-all --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- `D:\tmp\music-education-app-generate-default-all\bootstrap-knowledge\catalog.yaml` exists.
- `reports/generation.json` contains `"knowledge": "all"`.
- `catalog.yaml` contains at least one `DB` object.
- `catalog.yaml` contains at least one `CAP` object.

- [ ] **Step 3: Validate one DB table generation**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge db --target db:course --out D:\tmp\music-education-app-generate-db-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- `reports/generation.json` contains `"knowledge": "db"`.
- `reports/generation.json` contains target kind `db`.
- Only the requested DB target is generated.
- No capability stage report is present.

- [ ] **Step 4: Validate one business capability generation**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-generate-capability-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- `reports/generation.json` contains `"knowledge": "capability"`.
- Capability report records `llmRuntime` as `langgraph`.
- Capability report records `llmCalled` as `true`.
- Capability report records `llmSucceeded` as `true`.
- Generated objects include `CAP`, `MOD`, and `VER` or validation `OPEN`.

- [ ] **Step 5: Validate typed target with all knowledge**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge all --target capability:order --out D:\tmp\music-education-app-generate-all-capability-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- Only capability stage runs.
- `reports/generation.json` contains `"knowledge": "all"`.
- `reports/generation.json` contains target kind `capability`.
- No DB objects are generated for this targeted run.

## Task 10: Full Verification

**Files:**

- No source changes in this task.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Test**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect CLI boundary**

Run:

```bash
rg -n "buildDbTableBundle|buildAllDbTableBundles|buildEvidenceBundle|discoverCapabilitiesFromGraph|runCapabilityKnowledgePipeline|writePackage|writeCapabilityKnowledgePackage" src/cli/generate.ts
```

Expected: no output.

- [ ] **Step 5: Inspect generation boundary**

Run:

```bash
rg -n "writeFile|mkdir|rm\\(" src/generation
```

Expected: no output.

## Self Review Checklist

- [ ] DB and business knowledge share one design-aligned `bootstrap-knowledge/` layout.
- [ ] `--knowledge` selects `db`, `capability`, or `all`.
- [ ] Missing `--knowledge` defaults to `all`.
- [ ] `--target db:<table>` supports single-table generation.
- [ ] `--target capability:<name>` or `--knowledge capability --target <name>` supports single-capability generation.
- [ ] Unified writer cleans `bootstrap-knowledge/` once.
- [ ] CLI contains no business generation logic.
- [ ] Real validation uses `D:\workspace\other_project\music-education-app`.
