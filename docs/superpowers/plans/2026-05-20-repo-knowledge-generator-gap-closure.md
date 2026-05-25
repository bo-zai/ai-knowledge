# Repo Knowledge Generator Gap-Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current scaffold into a real `bootstrap-knowledge` generator that matches the approved v1 semantics while keeping the accepted root-level project layout.

**Architecture:** Keep the existing module families and replace the placeholder `generate` path with a real orchestration chain: GitNexus ensure/index -> slice discovery -> evidence extraction -> typed object generation -> validation -> package writing -> structured status/reporting. Fix the `CON` object meaning first so downstream work aligns with the original schema.

**Tech Stack:** TypeScript, Node.js, Commander, Zod, YAML, OpenAI-compatible API, Vitest

---

## File Structure Targets

### Core files to modify

- `src/cli/generate.ts`
  - Replace placeholder end-to-end flow with real orchestration.
- `src/cli/status.ts`
  - Parse package files as YAML and report structured status.
- `src/evidence/bundle-builder.ts`
  - Build real repository and slice evidence bundles.
- `src/evidence/db-evidence.ts`
  - Extract DB evidence from schema sources and code usage.
- `src/gitnexus/adapter.ts`
  - Expose the query methods needed by evidence builders.
- `src/packaging/build-catalog.ts`
  - Build catalog entries from real generated objects.
- `src/packaging/write-reports.ts`
  - Reflect partial failures and coverage numbers.

### Files to rename or replace

- `src/schemas/constraint.ts`
  - Replace with `src/schemas/con.ts`
- `src/generation/object-generators/constraint-generator.ts`
  - Replace with `src/generation/object-generators/con-generator.ts`

### Tests to modify or add

- `tests/integration/partial-failure.test.ts`
  - Change from “empty package is acceptable” into real partial-failure coverage.
- `tests/integration/status-command.test.ts`
  - Assert structured status output.
- `tests/unit/generation/db-generator.test.ts`
  - Expand to assert DB field description/source constraints.
- `tests/unit/evidence/db-evidence.test.ts`
  - Expand to assert table/field extraction behavior.
- `tests/unit/evidence/route-evidence.test.ts`
  - Expand to assert contract-oriented evidence.
- `tests/unit/packaging/build-catalog.test.ts`
  - Assert object-driven catalog generation.
- `tests/unit/schemas/object-schemas.test.ts`
  - Update for real `CON` schema semantics.
- Add: `tests/unit/generation/con-generator.test.ts`
- Add: `tests/unit/cli/generate-orchestration.test.ts`
- Add: `tests/integration/generate-db-package.test.ts`

## Task 1: Fix `CON` object semantics before further implementation

**Files:**
- Create: `src/schemas/con.ts`
- Create: `src/generation/object-generators/con-generator.ts`
- Modify: `src/schemas/common.ts`
- Modify: `src/packaging/render-object.ts`
- Modify: `tests/unit/schemas/object-schemas.test.ts`
- Add: `tests/unit/generation/con-generator.test.ts`

- [ ] Replace the current `constraint` schema with a real contract schema matching the approved design:
  - interface kind
  - producer
  - consumers
  - input shape
  - output shape
  - middleware
  - error shape
  - related routes/tools

- [ ] Update the renderer so `CON` markdown sections are contract-oriented:
  - `Interface Summary`
  - `Producer and Consumer`
  - `Inputs`
  - `Outputs`
  - `Runtime Semantics`
  - `Code Anchors`

- [ ] Add unit tests that fail if `CON` still behaves like a generic “constraint”.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/schemas/object-schemas.test.ts tests/unit/generation/con-generator.test.ts`

## Task 2: Replace placeholder `generate` orchestration

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/gitnexus/adapter.ts`
- Modify: `src/gitnexus/types.ts`
- Modify: `src/config/model-config.ts`
- Add: `tests/unit/cli/generate-orchestration.test.ts`

- [ ] Refactor `runGenerate` so it:
  - resolves API key and model config,
  - ensures GitNexus index,
  - discovers slices,
  - builds evidence,
  - invokes object generation,
  - validates drafts,
  - packages output,
  - writes reports.

- [ ] Remove dead imports and all hardcoded scaffold values such as:
  - `repoId: 'test-repo'`
  - empty retrieval order
  - empty object list as the only output path

- [ ] Make the orchestration dependency-friendly so tests can fake:
  - GitNexus adapter
  - LLM client
  - filesystem/package writer

- [ ] Add orchestration tests for:
  - reusing existing index
  - triggering analyze when missing
  - continuing under partial object failure

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/cli/generate-orchestration.test.ts tests/unit/gitnexus/ensure-index.test.ts`

## Task 3: Implement real evidence bundle construction

**Files:**
- Modify: `src/evidence/bundle-builder.ts`
- Modify: `src/evidence/route-evidence.ts`
- Modify: `src/evidence/process-evidence.ts`
- Modify: `src/evidence/module-evidence.ts`
- Modify: `src/evidence/open-evidence.ts`
- Modify: `src/evidence/own-evidence.ts`
- Modify: `src/evidence/ver-evidence.ts`
- Modify: `src/evidence/types.ts`
- Modify: `tests/unit/evidence/route-evidence.test.ts`

- [ ] Replace the synthetic repository-exists fact with real repository and slice evidence assembly.

- [ ] Ensure the builder can emit:
  - facts
  - symbols
  - relations
  - snippets
  - tests
  - gaps
  - related tables

- [ ] Add route/process/community evidence tests that assert:
  - route handler extraction
  - middleware propagation
  - process step ordering
  - gap emission when required evidence is missing

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/evidence/route-evidence.test.ts tests/unit/slicing/discover-slices.test.ts`

## Task 4: Implement first-class DB extraction

**Files:**
- Modify: `src/evidence/db-evidence.ts`
- Modify: `src/schemas/db.ts`
- Modify: `src/generation/object-generators/db-generator.ts`
- Modify: `tests/unit/evidence/db-evidence.test.ts`
- Modify: `tests/unit/generation/db-generator.test.ts`
- Add: `tests/integration/generate-db-package.test.ts`

- [ ] Implement source-priority DB extraction:
  - DDL/schema
  - migration
  - ORM
  - SQL
  - inferred fallback

- [ ] Ensure one table produces one `DB-*` object and every field includes:
  - `description_zh`
  - `description_source`

- [ ] Explicitly emit gaps for:
  - schema conflicts
  - unresolved field types
  - inferred-only descriptions

- [ ] Add integration coverage using a fixture repo with schema evidence so `generate` must emit at least one real DB object.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/evidence/db-evidence.test.ts tests/unit/generation/db-generator.test.ts tests/integration/generate-db-package.test.ts`

## Task 5: Hook LLM generation to typed object inputs

**Files:**
- Modify: `src/generation/prompt-builder.ts`
- Modify: `src/generation/parse-output.ts`
- Modify: `src/generation/retry.ts`
- Modify: `src/generation/llm-client.ts`
- Modify: `src/generation/object-generators/term-generator.ts`
- Modify: `src/generation/object-generators/flow-generator.ts`
- Modify: `src/generation/object-generators/mod-generator.ts`
- Modify: `src/generation/object-generators/open-generator.ts`
- Modify: `src/generation/object-generators/own-generator.ts`
- Modify: `src/generation/object-generators/ver-generator.ts`

- [ ] Ensure every generator accepts a narrow `ObjectDraftInput` and returns JSON-shaped draft data only.

- [ ] Add or tighten parsing/repair behavior so malformed model output is retried structurally, not regenerated from scratch blindly.

- [ ] Keep the “model writes content, program owns structure” rule explicit in code and tests.

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/generation/parse-output.test.ts tests/unit/generation/con-generator.test.ts tests/unit/generation/db-generator.test.ts`

## Task 6: Improve packaging, reports, and status behavior

**Files:**
- Modify: `src/packaging/build-catalog.ts`
- Modify: `src/packaging/build-manifest.ts`
- Modify: `src/packaging/write-package.ts`
- Modify: `src/packaging/write-reports.ts`
- Modify: `src/cli/status.ts`
- Modify: `tests/unit/packaging/build-catalog.test.ts`
- Modify: `tests/integration/status-command.test.ts`
- Modify: `tests/integration/partial-failure.test.ts`

- [ ] Build catalog from actual generated objects and real retrieval order.

- [ ] Write reports that surface:
  - success/failure counts
  - warning counts
  - DB coverage stats
  - partial-failure details

- [ ] Parse manifest/catalog/report YAML inside `status` and print structured information instead of raw line scanning.

- [ ] Update integration tests so a passing suite proves:
  - package exists
  - package is non-empty when evidence exists
  - partial failure is surfaced, not silently discarded
  - status reflects actual package metadata

- [ ] Run:
  - `npm run typecheck`
  - `npm test -- --run tests/unit/packaging/build-catalog.test.ts tests/integration/status-command.test.ts tests/integration/partial-failure.test.ts`

## Task 7: Full regression pass

**Files:**
- Modify only as needed from previous tasks

- [ ] Run the full local gate:
  - `npm run build`
  - `npm run typecheck`
  - `npm test`

- [ ] Verify that the generated package shape still matches:
  - `bootstrap-knowledge/manifest.yaml`
  - `bootstrap-knowledge/catalog.yaml`
  - `bootstrap-knowledge/objects/*`
  - `bootstrap-knowledge/reports/*`

- [ ] Verify there are no remaining references to the old fake behavior:
  - hardcoded `test-repo`
  - always-empty object arrays
  - constraint-style `CON`
  - status string scanning as primary parsing logic

- [ ] Stop only when all three commands pass and the review findings addressed above are closed in code.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-repo-knowledge-generator-gap-closure.md`.
