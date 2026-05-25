# Runtime Recovery And SQL Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the embedded-runtime CLI to a runnable, type-safe state and prove that `music-education-admin` can produce real MyBatis-driven DB knowledge objects.

**Architecture:** Keep the embedded runtime and MyBatis direction intact, but recover the delivery path by standardizing the CLI build on ESM, isolating command startup, closing TypeScript errors, and adding deterministic plus end-to-end validation for DB knowledge generation.

**Tech Stack:** TypeScript, Node.js ESM, tsup, vitest, OpenAI-compatible API, embedded parser/index runtime, MyBatis XML parsing.

---

## File Structure

The stabilization work should primarily touch:

```text
src/
|-- cli/
|-- engine/
|-- query/
|-- evidence/
|-- generation/
|-- slicing/

tests/
|-- integration/
|-- unit/

scripts/
```

Main files expected to change:

- `package.json`
- `tsup.config.ts`
- `src/cli/index.ts`
- `src/cli/generate.ts`
- `src/cli/status.ts`
- `src/cli/clean.ts`
- `src/slicing/build-slice-plan.ts`
- `src/engine/tree-sitter/parser-loader.ts`
- selected files under `src/engine/embeddings/`
- selected files under `src/engine/ingestion/`
- selected files under `src/engine/lbug/`
- `tests/integration/*.test.ts`
- `tests/unit/cli/generate-orchestration.test.ts`
- optional `scripts/validate-music-admin-db.mts`

## Task 1: Switch The CLI Build To ESM

**Files:**
- Modify: `tsup.config.ts`
- Modify: `package.json`
- Modify: `tests/integration/generate-command.test.ts`
- Modify: `tests/integration/status-command.test.ts`
- Modify: `tests/integration/partial-failure.test.ts`
- Modify: `tests/integration/generate-nonempty-fixture.test.ts`

- [ ] **Step 1: Write the failing startup expectation**

Use the existing smoke/integration tests as the failing guard:

```ts
const result = await execa('node', ['dist/cli/index.js', '--help']);
expect(result.exitCode).toBe(0);
expect(result.stdout).toContain('generate');
```

- [ ] **Step 2: Run the smoke test and confirm it currently fails**

Run: `npx vitest run tests/integration/generate-command.test.ts`
Expected: FAIL because the built CLI currently starts from `index.cjs` and crashes before help output.

- [ ] **Step 3: Change tsup to emit ESM CLI output**

Update `tsup.config.ts` from CJS-only output to ESM output:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  external: ['openai', 'yaml', 'execa', 'zod', 'commander'],
});
```

- [ ] **Step 4: Align package metadata and test command paths**

Update `package.json` so:

```json
{
  "type": "module",
  "bin": {
    "repo-knowledge-generator": "dist/cli/index.js"
  }
}
```

Update all integration tests to call `dist/cli/index.js` instead of `dist/cli/index.cjs`.

- [ ] **Step 5: Rebuild and rerun the smoke test**

Run:
- `npm run build`
- `npx vitest run tests/integration/generate-command.test.ts`

Expected:
- build succeeds
- no `import.meta`/CJS build warning remains
- CLI help test passes

- [ ] **Step 6: Commit**

```bash
git add tsup.config.ts package.json tests/integration
git commit -m "build: switch cli output to esm"
```

## Task 2: Lazy-Load CLI Command Handlers

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/integration/generate-command.test.ts`

- [ ] **Step 1: Make the command dispatch test guard help-path startup**

Keep the test focused on:

```ts
const result = await execa('node', ['dist/cli/index.js', '--help']);
expect(result.exitCode).toBe(0);
```

- [ ] **Step 2: Rewrite `src/cli/index.ts` to use dynamic imports**

Replace eager top-level imports like:

```ts
import { runGenerate } from './generate.js';
```

with action-time imports:

```ts
.action(async (options) => {
  const { runGenerate } = await import('./generate.js');
  await runGenerate(options);
});
```

Apply the same pattern to `status` and `clean`.

- [ ] **Step 3: Rerun help and status tests**

Run:
- `npx vitest run tests/integration/generate-command.test.ts`
- `npx vitest run tests/integration/status-command.test.ts`

Expected:
- `--help` succeeds without loading the full engine path
- `status` no longer fails during unrelated parser boot

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts tests/integration/generate-command.test.ts tests/integration/status-command.test.ts
git commit -m "refactor: lazy load cli command handlers"
```

## Task 3: Fix Local Type Errors In Generator Code

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/slicing/build-slice-plan.ts`
- Modify: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Run typecheck and isolate local non-runtime errors**

Run: `npm run typecheck`
Expected: FAIL. Confirm at minimum these project-local errors remain:
- `src/cli/generate.ts`
- `src/slicing/build-slice-plan.ts`
- `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 2: Fix stale GitNexus type imports in unit tests**

Replace the deleted import:

```ts
import type { GitNexusExecutor } from '../../../src/gitnexus/types';
```

with a local test double type, for example:

```ts
type EmbeddedExecutor = (args: string[], repoPath: string) => Promise<{ stdout: string }>;
```

- [ ] **Step 3: Fix `generate.ts` slice typing and DB field source typing**

Correct the local type mismatches instead of casting them away.

For slice kinds, ensure the builder returns the actual `SliceKind` union rather than plain `string`.

For DB fields, ensure generated field metadata respects:

```ts
source: 'comment' | 'inferred'
```

Do not emit `'code'` as a DB field description source.

- [ ] **Step 4: Fix `build-slice-plan.ts` gap typing**

The current error shows `string[]` is being returned where `DiscoveryGap[]` is required. Convert gap creation into structured objects, e.g.:

```ts
{
  kind: 'missing-evidence',
  message: '...'
}
```

- [ ] **Step 5: Rerun targeted checks**

Run:
- `npx vitest run tests/unit/cli/generate-orchestration.test.ts`
- `npm run typecheck`

Expected:
- the stale deleted-module error is gone
- local generator typing errors are resolved

- [ ] **Step 6: Commit**

```bash
git add src/cli/generate.ts src/slicing/build-slice-plan.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "fix: close local generator type errors"
```

## Task 4: Close Vendored Runtime Type Errors Needed For CLI Boot

**Files:**
- Modify: `src/engine/embeddings/chunker.ts`
- Modify: `src/engine/embeddings/embedder.ts`
- Modify: `src/engine/embeddings/server-mapping.ts`
- Modify: `src/engine/embeddings/text-generator.ts`
- Modify: `src/engine/ingestion/call-processor.ts`
- Modify: `src/engine/ingestion/cobol/cobol-preprocessor.ts`
- Modify: `src/engine/ingestion/field-extractors/generic.ts`
- Modify: `src/engine/ingestion/import-processor.ts`
- Modify: `src/engine/ingestion/import-resolvers/utils.ts`
- Modify: `src/engine/ingestion/languages/php.ts`
- Modify: `src/engine/ingestion/method-extractors/configs/c-cpp.ts`
- Modify: `src/engine/ingestion/type-env.ts`
- Modify: `src/engine/ingestion/type-extractors/php.ts`
- Modify: `src/engine/ingestion/workers/parse-worker.ts`
- Modify: `src/engine/lbug/lbug-adapter.ts`
- Modify: `src/engine/lbug/pool-adapter.ts`

- [ ] **Step 1: Freeze the failing typecheck list**

Run: `npm run typecheck > typecheck-runtime-errors.txt`
Expected: current runtime error list is captured before editing.

- [ ] **Step 2: Fix index-signature and nullability issues conservatively**

Use narrow helper functions and explicit guards instead of `as any`.

Examples:

```ts
const rule = rules[nodeLabel as keyof typeof rules];
if (!rule) return fallback;
```

```ts
if (!node) {
  return;
}
```

```ts
const cacheDir = env.cacheDir ?? '';
```

```ts
if (typeof candidate !== 'function') {
  throw new Error('Expected callable adapter hook');
}
```

- [ ] **Step 3: Fix `import type` vs runtime import mistakes**

For `pool-adapter.ts`, convert any runtime-used `import type` to a normal import.

- [ ] **Step 4: Rerun typecheck after each small cluster**

Run after each cluster:
- `npm run typecheck`

Expected: error count decreases monotonically; do not batch-fix the whole runtime blindly.

- [ ] **Step 5: Reach full green typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine
git commit -m "fix: restore embedded runtime type safety"
```

## Task 5: Restore CLI Integration Tests

**Files:**
- Modify: `tests/integration/status-command.test.ts`
- Modify: `tests/integration/partial-failure.test.ts`
- Modify: `tests/integration/generate-nonempty-fixture.test.ts`

- [ ] **Step 1: Run the integration suite only**

Run:
- `npx vitest run tests/integration/status-command.test.ts`
- `npx vitest run tests/integration/partial-failure.test.ts`
- `npx vitest run tests/integration/generate-nonempty-fixture.test.ts`

Expected: FAIL initially, but no longer because of CLI boot-format crashes after Tasks 1-4.

- [ ] **Step 2: Update expectations from startup failure to actual behavior**

These tests should now assert:

- package presence/absence semantics for `status`
- package writing for `generate`
- non-empty DB object generation for mapper-rich fixtures

Do not leave tests green merely because the process crashes earlier.

- [ ] **Step 3: Re-run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration
git commit -m "test: restore cli integration coverage"
```

## Task 6: Add Deterministic Real-Repo DB Validation

**Files:**
- Create: `scripts/validate-music-admin-db.mts`
- Modify: `src/query/query-service.ts`
- Modify: `src/evidence/db-bundle-builder.ts`
- Modify: `README.md`

- [ ] **Step 1: Create a small validation script for real-repo DB evidence**

The script should accept a repo path or default to:

```text
D:\workspace\other_project\music-education-admin
```

It must:
- ensure the repo can be indexed/opened
- find MyBatis tables
- print or write a short summary including:
  - mapper count
  - discovered table count
  - one sample table with related statements/methods/files

- [ ] **Step 2: Make the script fail loudly on empty table discovery**

Use checks like:

```ts
if (tables.length === 0) {
  throw new Error('No MyBatis tables discovered from music-education-admin');
}
```

- [ ] **Step 3: Run the validation script**

Run:

```bash
node scripts/validate-music-admin-db.mts
```

Expected:
- process exits `0`
- at least one table is discovered
- related SQL/Java/XML context is shown for at least one table

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-music-admin-db.mts src/query/query-service.ts src/evidence/db-bundle-builder.ts README.md
git commit -m "feat: add real repo db evidence validation"
```

## Task 7: Validate End-To-End DB Knowledge Generation On music-education-admin

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/generation/object-generators/db-generator.ts`
- Modify: `src/evidence/db-evidence.ts`
- Optional output: `D:\workspace\other_project\music-education-admin\bootstrap-knowledge/**`

- [ ] **Step 1: Ensure DB generation uses real DB evidence bundles**

Audit the DB path so that generated DB objects are built from:

- mapper-discovered tables
- related SQL statements
- related Java methods
- related XML files

not from fallback placeholder paths.

- [ ] **Step 2: Run generation on the real repo with valid model config**

Run something equivalent to:

```bash
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --llm-config llm.config.yaml
```

If local config is not in `llm.config.yaml`, use explicit `--model`, `--base-url`, and `--api-key-env`.

- [ ] **Step 3: Verify generated DB knowledge artifacts**

Check:

- `D:\workspace\other_project\music-education-admin\bootstrap-knowledge\manifest.yaml`
- `D:\workspace\other_project\music-education-admin\bootstrap-knowledge\catalog.yaml`
- `D:\workspace\other_project\music-education-admin\bootstrap-knowledge\objects\db\`

Success requires at least one non-empty `DB-*.md`.

- [ ] **Step 4: Inspect one generated DB object for evidence integrity**

Verify the sample object:

- names a real table found in `mapper.xml`
- includes fields sourced from actual evidence
- marks inferred descriptions as `description_source: inferred`
- does not use placeholder repo-local fake paths

- [ ] **Step 5: Run final verification**

Run:
- `npm run build`
- `npm run typecheck`
- `npm test`
- `node dist/cli/index.js --help`
- `node scripts/validate-music-admin-db.mts`

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/generate.ts src/generation/object-generators/db-generator.ts src/evidence/db-evidence.ts
git commit -m "feat: validate real repo db knowledge generation"
```

## Self-Review Checklist

- Spec coverage:
  - startup recovery: Tasks 1-2
  - type closure: Tasks 3-4
  - test recovery: Task 5
  - deterministic real-repo DB validation: Task 6
  - end-to-end SQL knowledge generation validation: Task 7

- Placeholder scan:
  - no TODO/TBD markers remain
  - commands and files are concrete

- Type consistency:
  - final runtime path is `dist/cli/index.js`
  - DB validation always refers to `music-education-admin`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-runtime-recovery-and-sql-validation.md`.

Recommended execution mode for Claude Code:

1. Fix build/runtime alignment first
2. Get `typecheck` green
3. Get test suite green
4. Run deterministic real-repo DB validation
5. Run end-to-end DB knowledge generation on `music-education-admin`
