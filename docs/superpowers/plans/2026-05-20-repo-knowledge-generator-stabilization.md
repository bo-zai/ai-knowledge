# Repo Knowledge Generator Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the current root-level implementation so generated knowledge packages are slice-aligned, platform-safe, and fully validated.

**Architecture:** Preserve the existing module layout, but replace repository-wide synthetic evidence usage with slice-specific evidence construction, isolate GitNexus text normalization, validate every object type before packaging, and tighten tests so successful generation requires real objects when evidence exists.

**Tech Stack:** TypeScript, Node.js, Commander, Zod, YAML, OpenAI-compatible API, Vitest

---

## File Structure Targets

### Core files to modify

- `src/cli/generate.ts`
  - Stop reusing a single repository bundle for every slice.
- `src/evidence/bundle-builder.ts`
  - Build dedicated repository and slice evidence bundles.
- `src/evidence/types.ts`
  - Clarify repository vs slice vs object-draft input types.
- `src/gitnexus/adapter.ts`
  - Normalize GitNexus outputs behind a structured adapter boundary.
- `src/slicing/build-slice-plan.ts`
  - Consume normalized GitNexus data instead of raw string assumptions.
- `src/shared/ids.ts` or a new path utility module
  - Normalize repo basename extraction cross-platform.
- `src/cli/status.ts`
  - Keep structured reporting aligned with any report schema changes.

### Validation files to modify

- `src/schemas/term.ts`
- `src/schemas/flow.ts`
- `src/schemas/mod.ts`
- `src/schemas/open.ts`
- `src/schemas/own.ts`
- `src/schemas/ver.ts`
- `src/cli/generate.ts`

### Tests to modify or add

- `tests/unit/cli/generate-orchestration.test.ts`
- `tests/unit/evidence/route-evidence.test.ts`
- `tests/unit/evidence/db-evidence.test.ts`
- `tests/unit/gitnexus/ensure-index.test.ts`
- `tests/unit/slicing/discover-slices.test.ts`
- `tests/integration/partial-failure.test.ts`
- Add: `tests/unit/shared/path-utils.test.ts`
- Add: `tests/unit/gitnexus/adapter-normalization.test.ts`
- Add: `tests/integration/generate-nonempty-fixture.test.ts`

## Task 1: Fix repository identity and path handling

**Files:**
- Modify: `src/cli/generate.ts`
- Add or modify: `src/shared/path-utils.ts`
- Add: `tests/unit/shared/path-utils.test.ts`

- [ ] Replace every `repoPath.split('/')`-style basename derivation with path-aware logic.

- [ ] Ensure the same normalization is used for:
  - manifest `repo_id`
  - evidence `repoName`
  - object frontmatter `repo`

- [ ] Add tests for:
  - Windows-style paths
  - POSIX-style paths
  - trailing separator cases

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/shared/path-utils.test.ts tests/unit/cli/generate-orchestration.test.ts`

## Task 2: Introduce structured GitNexus normalization

**Files:**
- Modify: `src/gitnexus/adapter.ts`
- Modify: `src/gitnexus/types.ts`
- Modify: `src/slicing/build-slice-plan.ts`
- Add: `tests/unit/gitnexus/adapter-normalization.test.ts`

- [ ] Move raw CLI text parsing behind the GitNexus adapter boundary.

- [ ] Define a normalized intermediate shape for discovered:
  - routes
  - processes
  - tools
  - communities
  - tables

- [ ] Ensure higher layers no longer depend on direct `Route:` / `Process:` string prefixes as their working contract.

- [ ] Add tests that prove:
  - normalization works on expected output,
  - malformed or partial output degrades into explicit gaps rather than silent empty success.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/gitnexus/adapter-normalization.test.ts tests/unit/slicing/discover-slices.test.ts`

## Task 3: Replace shared evidence with slice-specific evidence

**Files:**
- Modify: `src/evidence/bundle-builder.ts`
- Modify: `src/evidence/route-evidence.ts`
- Modify: `src/evidence/process-evidence.ts`
- Modify: `src/evidence/module-evidence.ts`
- Modify: `src/evidence/db-evidence.ts`
- Modify: `src/evidence/own-evidence.ts`
- Modify: `src/evidence/open-evidence.ts`
- Modify: `src/evidence/ver-evidence.ts`
- Modify: `src/evidence/types.ts`
- Modify: `src/cli/generate.ts`

- [ ] Keep repository evidence as shared context, but add dedicated slice evidence builders for each slice kind.

- [ ] Ensure `generateObjectForSlice` receives a slice-aligned evidence payload instead of the same repository bundle for every object.

- [ ] Record gaps when slice evidence cannot be resolved.

- [ ] Add or expand tests to prove:
  - route slice evidence differs from process slice evidence,
  - database slice evidence is table-specific,
  - sparse slices produce explicit `gaps` instead of misleading facts.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/evidence/route-evidence.test.ts tests/unit/evidence/db-evidence.test.ts tests/unit/cli/generate-orchestration.test.ts`

## Task 4: Enforce validation across all emitted object types

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/schemas/term.ts`
- Modify: `src/schemas/flow.ts`
- Modify: `src/schemas/mod.ts`
- Modify: `src/schemas/open.ts`
- Modify: `src/schemas/own.ts`
- Modify: `src/schemas/ver.ts`
- Modify tests under `tests/unit/schemas/`

- [ ] Add runtime validation for every object type emitted by the generator, not just `CON` and `DB`.

- [ ] Route invalid drafts into partial-failure reporting instead of silently accepting raw drafts.

- [ ] Add tests that fail when:
  - required sections are missing,
  - frontmatter shape is incomplete,
  - object content does not match its declared type.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/schemas/object-schemas.test.ts tests/unit/cli/generate-orchestration.test.ts`

## Task 5: Tighten integration success criteria

**Files:**
- Modify: `tests/integration/partial-failure.test.ts`
- Modify: `tests/integration/status-command.test.ts`
- Add: `tests/integration/generate-nonempty-fixture.test.ts`
- Modify fixtures under `tests/integration/fixtures/` as needed

- [ ] Split “empty is acceptable” coverage from “happy path generation” coverage.

- [ ] Require at least one generated object for fixture repositories that contain evidence-rich schema or route inputs.

- [ ] Keep one explicit sparse-fixture test for empty generation behavior, but stop using that as the default success proof.

- [ ] Assert:
  - object count > 0 where appropriate,
  - repo metadata correctness,
  - non-empty catalog entries,
  - report flags for partial vs complete vs sparse output.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/integration/partial-failure.test.ts tests/integration/status-command.test.ts tests/integration/generate-nonempty-fixture.test.ts`

## Task 6: Full regression pass

**Files:**
- Modify only as needed from previous tasks

- [ ] Run:
  - `npm run build`
  - `npm run typecheck`
  - `npm test`

- [ ] Verify:
  - no remaining `repoPath.split('/')` metadata derivation,
  - no object generation path relies solely on repository-level evidence,
  - no primary success-path integration test passes only because zero objects were emitted.

- [ ] Stop only when the full suite is green and the code review findings in the stabilization design are closed.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-repo-knowledge-generator-stabilization.md`.
