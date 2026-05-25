# Database Slice Startup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make database-only table generation start and run without loading the full analysis pipeline or failing on the vendored Leiden dependency.

**Architecture:** Narrow the startup path for `generate --slice database:<table>` by lazy-loading full analysis only when needed, and by preventing community detection dependencies from becoming unconditional module-load requirements. Keep DB evidence generation unchanged except for startup/runtime isolation.

**Tech Stack:** TypeScript, Node.js, tsup ESM build, embedded analysis runtime, Vitest.

---

## File Structure

Likely files involved:

- `src/query/index-service.ts`
  - split eager imports, lazy-load analysis
- `src/cli/generate.ts`
  - preserve true database-only narrow path
- `src/engine/analyze/run-analyze.ts`
  - maybe restructure imports if needed
- `src/engine/ingestion/community-processor.ts`
  - lazy-load Leiden or guard it
- `src/engine/ingestion/pipeline-phases/communities.ts`
  - ensure community phase only loads when needed
- `tests/integration/generate-command.test.ts`
- `tests/integration/status-command.test.ts`
- `tests/integration/partial-failure.test.ts`
- `tests/integration/generate-nonempty-fixture.test.ts`

### Task 1: Stop eager-loading full analysis from `index-service`

**Files:**
- Modify: `src/query/index-service.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Write/update a focused orchestration test for database-only mode**

Adjust or extend tests so database-only generation is expected to avoid unnecessary full analysis startup dependencies.

- [ ] **Step 2: Run the focused test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: FAIL or expose stale eager-loading assumptions.

- [ ] **Step 3: Refactor `index-service.ts` to lazy-load analysis**

Move `runFullAnalysis` out of top-level imports. Use dynamic import or a narrower helper so `hasIndex()` and other lightweight operations do not drag in the full runtime.

- [ ] **Step 4: Re-run the focused test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/query/index-service.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: lazy-load analysis from index service"
```

### Task 2: Remove Leiden as a startup-time hard dependency

**Files:**
- Modify: `src/engine/ingestion/community-processor.ts`
- Modify: `src/engine/ingestion/pipeline-phases/communities.ts`
- Modify: any related runtime helpers

- [ ] **Step 1: Identify the current load site**

Confirm where `vendor/leiden/index.cjs` is required and why it is happening at module load time.

- [ ] **Step 2: Move Leiden loading behind runtime execution**

Refactor so Leiden is loaded only when community detection actually runs.

Preferred outcome:

- `processCommunities()` or the phase entrypoint loads Leiden lazily
- non-community flows do not require the vendor file at startup

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/engine/ingestion/community-processor.ts src/engine/ingestion/pipeline-phases/communities.ts
git commit -m "refactor: lazy-load leiden community dependency"
```

### Task 3: Ensure `generate.ts` preserves a truly narrow database-only path

**Files:**
- Modify: `src/cli/generate.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Verify database-only path does not touch discovery/analyze unnecessarily**

Review and tighten `isDatabaseOnly` handling so database-only generation does not call helper paths that implicitly need full analyze/discovery startup.

- [ ] **Step 2: Update code if any broad-path helper is still touched**

Make the narrow path explicit:

- parse slice filter
- build DB bundles
- generate DB object

without broad route/process/tool/community startup work.

- [ ] **Step 3: Run focused unit test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/generate.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: keep database-only generation path narrow"
```

### Task 4: Stabilize CLI integration tests around the built entrypoint

**Files:**
- Modify: `tests/integration/generate-command.test.ts`
- Modify: `tests/integration/status-command.test.ts`
- Modify: `tests/integration/partial-failure.test.ts`
- Modify: `tests/integration/generate-nonempty-fixture.test.ts`
- Possibly modify test helpers or scripts

- [ ] **Step 1: Normalize the expected built CLI entry**

Ensure tests invoke the correct built artifact path and do not fail because of stale assumptions about `dist/cli/index.js`.

- [ ] **Step 2: Decide build strategy for integration tests**

Either:

- ensure tests run against a freshly built dist entry

or:

- switch the integration tests to a source-based runtime if that is the established pattern

Pick one and make it consistent.

- [ ] **Step 3: Run the affected integration tests**

Run:

```powershell
npx vitest run tests/integration/generate-command.test.ts tests/integration/status-command.test.ts tests/integration/partial-failure.test.ts tests/integration/generate-nonempty-fixture.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test: stabilize cli integration entrypoint behavior"
```

### Task 5: Real validation on three tables

**Files:**
- Verify end-to-end runtime behavior only

- [ ] **Step 1: Build the project**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 2: Generate `auth_menu`**

Run:

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
```

Expected: command succeeds and writes a `DB-*` object.

- [ ] **Step 3: Generate `mall_category`**

Run:

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
```

Expected: command succeeds and writes a `DB-*` object.

- [ ] **Step 4: Generate `music_user`**

Run:

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

Expected: command succeeds and writes a `DB-*` object.

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "fix: restore database-only startup and validation flow"
```
