# Remove Embedded Adapter Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the bridge-style embedded adapter from the main runtime path so generation orchestrates directly against typed analysis and query services.

**Architecture:** Replace internal “command executor + stdout” orchestration with direct calls into index/discovery/query services. Preserve current behavior while deleting the adapter-shaped indirection from the production path.

**Tech Stack:** TypeScript, Node.js, embedded analysis runtime under `src/engine/**`, query/index services under `src/query/**`, Vitest.

---

## File Structure

Likely files involved:

- `src/cli/generate.ts`
  - remove executor-style orchestration
- `src/cli/status.ts`
  - consume typed index/status metadata directly
- `src/knowledge/embedded-adapter.ts`
  - delete or reduce to migrated helpers
- `src/query/index-service.ts`
  - absorb index existence/ensure behavior
- `src/query/query-service.ts`
  - expose typed query entrypoints used by generation
- `src/slicing/build-slice-plan.ts`
  - consume typed discovery results
- tests touching embedded adapter or generate orchestration

Additional same-category cleanup targets:

- `src/query/index.ts`
  - comments still say “embedded GitNexus runtime”
- `src/query/query-service.ts`
  - provenance string still uses `embedded-gitnexus`
- `tests/integration/generate-nonempty-fixture.test.ts`
  - wording still describes mock GitNexus output
- `tests/integration/status-command.test.ts`
  - fixtures still use `gitnexus_version`

### Task 1: Extract a typed index/discovery boundary

**Files:**
- Modify: `src/query/index-service.ts`
- Modify: `src/slicing/build-slice-plan.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Define the typed entrypoints used by generation**

Create or extend typed helpers so `generate.ts` can ask for:

- index exists
- ensure index
- discovery result

without going through a command executor abstraction.

- [ ] **Step 2: Update or add focused unit coverage**

Adjust `tests/unit/cli/generate-orchestration.test.ts` so orchestration assumptions are phrased in terms of typed services, not executor calls.

- [ ] **Step 3: Run the focused unit test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: FAIL or reveal stale assumptions before implementation is complete.

- [ ] **Step 4: Implement the typed index/discovery helpers**

Modify `src/query/index-service.ts` and related modules so `generate.ts` can later call them directly.

- [ ] **Step 5: Re-run the focused unit test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS or closer to final green state.

- [ ] **Step 6: Commit**

```bash
git add src/query/index-service.ts src/slicing/build-slice-plan.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: add typed index and discovery boundary"
```

### Task 2: Remove executor-style orchestration from `generate.ts`

**Files:**
- Modify: `src/cli/generate.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Replace `createEmbeddedGitNexusExecutor()` usage**

Remove:

- `createEmbeddedGitNexusExecutor`
- internal `['analyze']`
- internal `['list']`
- internal `['query']`

and replace them with direct service calls.

- [ ] **Step 2: Remove stdout-based discovery handoff**

`generate.ts` should no longer expect “list output text” and parse it through a compatibility helper. It should consume structured discovery results directly.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/generate.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: remove executor bridge from generate flow"
```

### Task 3: Remove or collapse `embedded-adapter.ts`

**Files:**
- Modify/Delete: `src/knowledge/embedded-adapter.ts`
- Modify: `src/cli/status.ts`
- Modify: any callers still importing the adapter

- [ ] **Step 1: Identify what remains genuinely useful**

Keep only helpers that still belong somewhere, such as:

- `checkEmbeddedIndex`
- `ensureEmbeddedIndex`

but migrate them into a neutral module if possible.

- [ ] **Step 2: Delete adapter-only concepts**

Remove:

- `EmbeddedGitNexusExecutor`
- `EmbeddedGitNexusResult`
- `runEmbeddedList`
- `createEmbeddedGitNexusExecutor`

unless a concrete production caller still truly needs them. If so, migrate that caller first.

- [ ] **Step 3: Update status path**

`src/cli/status.ts` should read typed manifest/index state directly and stop depending on old adapter-era semantics.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/embedded-adapter.ts src/cli/status.ts src/query
git commit -m "refactor: collapse embedded adapter bridge"
```

### Task 4: Clean naming and comments

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/cli/status.ts`
- Modify: `src/query/index.ts`
- Modify: `README.md`
- Modify: any remaining tests/docs touched by this refactor

- [ ] **Step 1: Remove bridge-era wording**

Replace wording that still suggests:

- pseudo GitNexus commands
- GitNexus-style executor compatibility
- stdout protocol as a first-class boundary

- [ ] **Step 2: Make names architecture-accurate**

Use names that reflect:

- embedded runtime
- typed query service
- structured discovery

instead of bridge names.

- [ ] **Step 2.1: Clean project-owned metadata fields where practical**

Where the field is project-owned rather than vendored-runtime-owned:

- rename or neutralize `gitnexusVersion`-style names in generation/status paths
- replace `embedded-gitnexus` provenance strings with project-neutral wording
- stop requiring project-owned tests to mention GitNexus unless they are explicitly testing vendored provenance behavior

- [ ] **Step 3: Run grep verification**

Run:

```powershell
rg -n "EmbeddedGitNexusExecutor|EmbeddedGitNexusResult|createEmbeddedGitNexusExecutor|runEmbeddedList|stdout" src README.md tests
```

Expected: no hits in active production-path code except where `stdout` is still genuinely required by unrelated IO code.

- [ ] **Step 3.1: Run a second grep for project-owned GitNexus wording**

Run:

```powershell
rg -n "GitNexus|gitnexus_version|embedded-gitnexus|extractSliceSeedsFromGitNexus" src/cli src/query src/knowledge src/slicing tests README.md
```

Expected:

- no stale project-boundary naming remains
- any remaining hits are either vendored-runtime provenance or intentionally preserved compatibility metadata

- [ ] **Step 4: Commit**

```bash
git add src README.md tests
git commit -m "docs: align runtime naming after bridge removal"
```

### Task 5: End-to-end verification

**Files:**
- Verify runtime behavior without bridge regression

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Re-run real single-table validation**

Run:

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

Expected: all three complete successfully with no bridge-related regressions.

- [ ] **Step 5: Commit**

```bash
git add src tests README.md
git commit -m "refactor: remove embedded runtime bridge from production path"
```
