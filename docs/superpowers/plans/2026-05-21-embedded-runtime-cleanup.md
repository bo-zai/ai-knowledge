# Embedded Runtime Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale `gitnexus` adapter remnants and rename user-facing/runtime-facing interfaces so the codebase consistently reflects the embedded runtime architecture.

**Architecture:** Keep behavior unchanged. Replace imports, types, and naming that still point at `src/gitnexus/**` or external GitNexus CLI semantics with embedded-runtime equivalents. Delete the obsolete adapter layer once no production code or tests depend on it.

**Tech Stack:** TypeScript, Node.js, embedded analysis runtime under `src/engine/**`, local adapters under `src/knowledge/**`, Vitest.

---

## File Structure

Target files likely involved:

- `src/cli/generate.ts`
  - Remove stale imports and old comments.
- `src/cli/index.ts`
  - Update CLI descriptions/options wording.
- `src/cli/status.ts`
  - Remove old GitNexus-specific metadata labels.
- `src/slicing/build-slice-plan.ts`
  - Rename legacy extraction helper to embedded/discovery-neutral naming.
- `src/knowledge/embedded-adapter.ts`
  - Adjust comments and exported names only if needed.
- `src/gitnexus/**`
  - Delete once unused.
- `tests/unit/cli/generate-orchestration.test.ts`
  - Replace old `GitNexusExecutor` typing and test wording.
- `tests/unit/gitnexus/**`
  - Delete or migrate to embedded equivalents.
- `README.md`
  - Clean user-facing runtime wording.

### Task 1: Remove stale `src/gitnexus` imports from the main generation path

**Files:**
- Modify: `src/cli/generate.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Write/update the failing test expectation for import-free embedded orchestration**

Update `tests/unit/cli/generate-orchestration.test.ts` so it no longer references `GitNexusExecutor` or describes behavior as external GitNexus orchestration. Replace the old wording with embedded-runtime wording.

- [ ] **Step 2: Run the focused test to confirm current mismatch or stale assumptions**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: either current pass with stale wording or failures once wording/types are tightened.

- [ ] **Step 3: Remove stale imports and comments from `generate.ts`**

In `src/cli/generate.ts`:

- delete:
  - `import { ensureGitNexusIndex, checkGitNexusIndex } from '../gitnexus/ensure-index.js';`
  - `import { runGitNexus } from '../gitnexus/commands.js';`
- rewrite comments like:
  - `Ensure GitNexus index`
  - to embedded-runtime wording

- [ ] **Step 4: Re-run the focused test**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS with embedded-runtime wording/types.

- [ ] **Step 5: Commit**

```bash
git add src/cli/generate.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: remove stale gitnexus imports from generate flow"
```

### Task 2: Rename legacy slice discovery helper to neutral terminology

**Files:**
- Modify: `src/slicing/build-slice-plan.ts`
- Modify: `src/cli/generate.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] **Step 1: Introduce a neutral helper name**

In `src/slicing/build-slice-plan.ts`, rename:

```ts
extractSliceSeedsFromGitNexus
```

to a neutral name such as:

```ts
extractSliceSeedsFromDiscoveryOutput
```

Keep behavior identical.

- [ ] **Step 2: Update all production references**

Replace imports/calls in `src/cli/generate.ts` to use the new helper name.

- [ ] **Step 3: Update tests and wording**

Change test descriptions like:

- `extracts slices from GitNexus output`

to neutral discovery wording.

- [ ] **Step 4: Run the focused test suite**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/slicing/build-slice-plan.ts src/cli/generate.ts tests/unit/cli/generate-orchestration.test.ts
git commit -m "refactor: rename legacy slice discovery helper"
```

### Task 3: Remove obsolete `src/gitnexus/**` code and tests

**Files:**
- Delete: `src/gitnexus/adapter.ts`
- Delete: `src/gitnexus/commands.ts`
- Delete: `src/gitnexus/ensure-index.ts`
- Delete: `src/gitnexus/types.ts`
- Delete or modify: `tests/unit/gitnexus/**`

- [ ] **Step 1: Verify no production imports remain**

Run:

```powershell
rg -n "../gitnexus/|src/gitnexus|ensureGitNexusIndex|checkGitNexusIndex|runGitNexus" src tests
```

Expected: only test/doc references remain, or no production references.

- [ ] **Step 2: Delete obsolete runtime adapter files**

Delete the now-unused `src/gitnexus/**` files.

- [ ] **Step 3: Delete or migrate unit tests tied only to the old adapter**

Remove `tests/unit/gitnexus/**` if they only validate the deleted external-adapter behavior.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "refactor: remove obsolete gitnexus adapter layer"
```

### Task 4: Clean user-facing CLI and status wording

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/status.ts`
- Modify: `README.md`

- [ ] **Step 1: Update CLI descriptions**

Replace wording such as:

- `Generate bootstrap-knowledge packages from GitNexus + LLM`
- `Force GitNexus re-analysis`

with embedded-runtime wording.

- [ ] **Step 2: Update status labels**

In `src/cli/status.ts`, replace `GitNexus Version` and similar labels with project-neutral wording or remove them if no longer meaningful.

- [ ] **Step 3: Update README wording**

Clean current runtime descriptions so they no longer imply a required external GitNexus CLI dependency.

- [ ] **Step 4: Run a grep verification**

Run:

```powershell
rg -n "GitNexus \\+ LLM|Force GitNexus re-analysis|GitNexus Version" src README.md
```

Expected: no hits in active user-facing files.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/status.ts README.md
git commit -m "docs: align cli wording with embedded runtime"
```

### Task 5: Final verification

**Files:**
- Verify whole repo state

- [ ] **Step 1: Check stale references are gone from active code**

Run:

```powershell
rg -n "../gitnexus/|src/gitnexus|ensureGitNexusIndex|checkGitNexusIndex|runGitNexus" src tests
```

Expected: no active production references; only historical docs may remain if intentionally preserved.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests README.md
git commit -m "refactor: finish embedded runtime cleanup"
```
