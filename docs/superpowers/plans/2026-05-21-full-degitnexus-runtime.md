# Full De-GitNexus Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all remaining GitNexus-branded runtime, naming, and storage semantics from the project’s active code paths while preserving current DB knowledge generation behavior.

**Architecture:** First clean the product boundary (`cli/query/evidence/schema/tests/docs`), then rename active storage and ignore conventions, then delete vendored subsystems that are not part of the current product. Preserve the embedded parser/index/search core, but stop exposing GitNexus semantics from the project boundary.

**Tech Stack:** TypeScript, Node.js, embedded analysis runtime, MyBatis evidence pipeline, Vitest.

---

## File Structure

Expected touch points:

- `src/cli/**`
- `src/query/**`
- `src/evidence/**`
- `src/schemas/**`
- `src/packaging/**`
- `src/config/ignore-service.ts`
- `src/engine/storage/repo-manager.ts`
- `src/engine/analyze/run-analyze.ts`
- `src/engine/cli/**` (likely delete)
- `src/engine/group/**` (likely delete if unused)
- `tests/**`
- `README.md`

### Task 1: Remove GitNexus naming from product boundary

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/evidence/**`
- Modify: `src/schemas/manifest.ts`
- Modify: `src/packaging/build-manifest.ts`
- Modify: `src/cli/status.ts`
- Modify: relevant tests

- [ ] **Step 1: Write/update focused tests for product metadata and wording**

Tighten tests so they no longer accept:

- `gitnexus_version`
- `source_kind: 'gitnexus'`
- GitNexus-based CLI wording

- [ ] **Step 2: Rename metadata and source kinds**

Replace:

- `gitnexus_version`
- `embedded-gitnexus`
- `source_kind: 'gitnexus'`
- `OrchestrationDeps.gitnexus`

with project-neutral names.

- [ ] **Step 3: Update fixtures and status output**

Make `status` and tests read the renamed manifest fields.

- [ ] **Step 4: Run verification**

Run:

```powershell
npm run typecheck
npx vitest run tests/integration/status-command.test.ts tests/integration/generate-nonempty-fixture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "refactor: remove gitnexus naming from product boundary"
```

### Task 2: Replace active runtime storage and ignore conventions

**Files:**
- Modify: `src/config/ignore-service.ts`
- Modify: `src/engine/storage/repo-manager.ts`
- Modify: any code reading/writing index/meta/registry paths
- Modify: relevant tests

- [ ] **Step 1: Introduce project-native runtime paths**

Replace active conventions:

- `.gitnexus/`
- `.gitnexusignore`
- `~/.gitnexus/`

with project-native equivalents such as:

- `.knowledge-index/`
- `.knowledge-ignore`
- `~/.knowledge/...`

- [ ] **Step 2: Migrate helpers and checks**

Update:

- meta discovery
- registry access
- index existence checks
- ignore loading

so active runtime no longer depends on old names.

- [ ] **Step 3: Run verification**

Run:

```powershell
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "refactor: replace gitnexus runtime storage conventions"
```

### Task 3: Remove GitNexus context-generation code from analysis flow

**Files:**
- Modify: `src/engine/analyze/run-analyze.ts`
- Delete/Modify: `src/engine/cli/ai-context.ts`
- Delete/Modify: `src/engine/cli/skill-gen.ts`
- Modify: any imports/tests affected

- [ ] **Step 1: Identify current active imports**

Remove analysis-path dependencies on GitNexus AGENTS/CLAUDE context generation.

- [ ] **Step 2: Delete or isolate unused engine CLI modules**

If `engine/cli/**` is not required for current product features, delete it. If a subset is needed, keep only the neutral subset.

- [ ] **Step 3: Run verification**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "refactor: remove gitnexus context generation from analysis runtime"
```

### Task 4: Delete unused GitNexus-specific vendored subsystems

**Files:**
- Delete/Modify: `src/engine/group/**`
- Delete/Modify: any references from active runtime

- [ ] **Step 1: Verify whether group/cross-impact is used by current product**

If not used by:

- `generate`
- `status`
- `clean`
- DB evidence generation

then remove it.

- [ ] **Step 2: Delete the unused subsystem**

Delete `src/engine/group/**` and any dead references that only exist for GitNexus-specific features.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "refactor: remove unused gitnexus-specific vendored subsystems"
```

### Task 5: Real DB generation verification

**Files:**
- Verify end-to-end behavior on real repos

- [ ] **Step 1: Re-run three real single-table generations**

Run:

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

Expected: all complete successfully.

- [ ] **Step 2: Run grep verification**

Run:

```powershell
rg -n "gitnexus|GitNexus|gitnexus_version|embedded-gitnexus" src/cli src/query src/evidence src/schemas src/packaging tests README.md
rg -n "\\.gitnexus|\\.gitnexusignore|~/.gitnexus|GITNEXUS_" src
```

Expected:

- no product-boundary hits
- no active runtime hits

- [ ] **Step 3: Commit**

```bash
git add src tests README.md
git commit -m "refactor: complete full degitnexus runtime cleanup"
```
