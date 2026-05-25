# Runtime Recovery And SQL Validation Design

## Goal

Recover the current `repo-knowledge-generator` codebase to a state where the CLI is runnable, type-safe, and testable again, then validate real MyBatis-driven DB knowledge generation against `D:\workspace\other_project\music-education-admin`.

This is a stabilization spec, not a new architecture spec. The embedded runtime and MyBatis direction stay the same. The work here is to make the current implementation actually executable.

## Current Blocking Findings

Real validation failed before repository-specific logic ran. The blockers are now clear:

1. The built CLI crashes on startup.
   - `src/engine/tree-sitter/parser-loader.ts` and several vendored runtime files call `createRequire(import.meta.url)`.
   - `tsup.config.ts` still emits only CommonJS.
   - In the built `dist/cli/index.cjs`, `import.meta` is empty, so `node dist/cli/index.cjs --help` crashes before command parsing finishes.

2. TypeScript compilation is not closed.
   - `npm run typecheck` currently fails in both project code and vendored runtime code.
   - The main project still has incorrect local types in `src/cli/generate.ts`, `src/slicing/build-slice-plan.ts`, and stale test imports referencing removed `src/gitnexus/*`.

3. The current test suite is not green.
   - `npm test` fails across CLI smoke, status, and generate integration tests.
   - Most failures are secondary effects of the startup crash, but some tests also still target `dist/cli/index.cjs` and old GitNexus-facing types.

4. Real DB knowledge validation has not actually happened yet.
   - We have not successfully run `generate` on `music-education-admin`.
   - Therefore we do not yet know whether the embedded runtime + MyBatis path can produce non-empty `DB` knowledge objects for a real repository.

## Problem Statement

The codebase is in a half-migrated state:

- the architecture moved from external GitNexus CLI orchestration to an embedded runtime,
- but the build format, tests, and type closure still reflect the old state,
- so the CLI cannot even start, and no real SQL knowledge validation is possible.

The next work item must be narrowly scoped to:

- restore executable CLI behavior,
- restore `typecheck` and `test` health,
- prove that real MyBatis table knowledge can be generated from `music-education-admin`.

## Non-Goals

This stabilization pass does **not** include:

- redesigning the embedded runtime architecture
- adding new knowledge object types beyond what already exists
- broad refactors of embeddings/search unrelated to current compiler errors
- introducing a new graph model for DB concepts
- replacing the LLM approach for DB descriptions
- adding web/server/MCP features

## Design Decisions

### 1. Standardize the CLI build on ESM

The project already declares `"type": "module"`. The vendored runtime also now relies on `import.meta.url` in multiple places. The simplest consistent build target is ESM.

Required direction:

- `tsup` must emit `dist/cli/index.js`
- `package.json` `bin` must point to that ESM entry
- integration tests must invoke `node dist/cli/index.js ...`
- the project must stop producing a CJS-only CLI artifact

This is the primary recovery decision. Do **not** try to paper over `import.meta` by rewriting every vendored runtime file back to CJS semantics.

### 2. Make CLI startup independent from heavy runtime imports where possible

The CLI should not need to eagerly load the full embedded runtime merely to print help or dispatch subcommands.

Required direction:

- `src/cli/index.ts` should lazy-load command handlers inside `.action(...)`
- `--help` must succeed even if the user never runs analysis
- `status` and `clean` should only import what they actually need

This reduces startup fragility and makes command-level failures easier to diagnose.

### 3. Preserve strict typing; fix errors instead of weakening the compiler

The project coding rules already require strict TypeScript. This pass must keep that contract.

Required direction:

- no `skipLibCheck`-style escape hatches for project code
- no blanket `any`
- no broad `// @ts-ignore` to silence vendored runtime issues
- local code errors should be fixed first, then vendored runtime errors addressed file-by-file

### 4. Separate “DB evidence extraction works” from “LLM generation works”

Real validation should be split into two layers:

1. deterministic DB evidence validation
   - can we find MyBatis mapper files?
   - can we discover tables?
   - can we expand related SQL/Java/XML context?
   - can we build a non-empty DB evidence bundle?

2. end-to-end DB knowledge generation
   - given valid LLM config, can we produce `bootstrap-knowledge/objects/db/*.md`?

This avoids conflating parser/runtime failures with LLM configuration failures.

### 5. Validate against the real target repo, not only fixtures

The primary validation target for this pass is:

- `D:\workspace\other_project\music-education-admin`

Fixture tests remain useful, but they are no longer enough. The project must prove that the real repository produces table-centric DB knowledge from MyBatis.

## Required Functional Outcomes

After this pass:

1. `node dist/cli/index.js --help` works.
2. `npm run typecheck` passes.
3. `npm test` passes.
4. `generate --repo D:\workspace\other_project\music-education-admin ...` can run without startup/build-format crashes.
5. The system can discover real mapper-driven tables from `music-education-admin`.
6. The DB evidence path returns related SQL/Java/XML context for at least one real table.
7. With valid LLM config, the generator writes at least one non-empty `DB-*.md` object into `bootstrap-knowledge/`.

## Required Code Changes

### Build and packaging

- `tsup.config.ts`
- `package.json`
- any docs/tests/scripts that still assume `dist/cli/index.cjs`

### CLI loading path

- `src/cli/index.ts`
- `src/cli/generate.ts`
- `src/cli/status.ts`
- `src/cli/clean.ts`

### Local type-closure fixes

- `src/cli/generate.ts`
- `src/slicing/build-slice-plan.ts`
- stale unit tests under `tests/unit/cli/`

### Vendored runtime type/build compatibility

At minimum, current failures indicate work in:

- `src/engine/tree-sitter/parser-loader.ts`
- `src/engine/platform/capabilities.ts`
- `src/engine/embeddings/*`
- `src/engine/ingestion/*`
- `src/engine/lbug/*`

The goal is not to refactor those subsystems; the goal is to make the embedded runtime compile and boot under the chosen ESM build.

### Real DB validation path

- `src/query/*`
- `src/evidence/db-bundle-builder.ts`
- `src/evidence/db-evidence.ts`
- `src/generation/object-generators/db-generator.ts`
- optional validation script(s) under `scripts/`

## Validation Strategy

### Deterministic validation

The codebase must provide at least one deterministic way to verify DB extraction on `music-education-admin` without relying on LLM output quality.

Acceptable options:

- a focused integration test guarded by a local repo-path env var
- a validation script under `scripts/`
- a CLI/debug command that outputs discovered tables and evidence counts

The chosen path must prove:

- mapper files were found
- at least one table was discovered
- at least one table has related statement/method/file context

### End-to-end validation

With a valid `llm.config.yaml` or explicit model options, the generator must be run on `music-education-admin` and produce:

- `bootstrap-knowledge/manifest.yaml`
- `bootstrap-knowledge/catalog.yaml`
- at least one `bootstrap-knowledge/objects/db/DB-*.md`

The DB object must be derived from actual MyBatis evidence, not fallback placeholder content.

## Acceptance Criteria

This pass is complete only when all of the following are true:

- `npm run build` passes without `import.meta`/CJS mismatch warnings
- `npm run typecheck` passes
- `npm test` passes
- `node dist/cli/index.js --help` exits `0`
- `node dist/cli/index.js status --repo <temp-repo>` exits `0`
- `music-education-admin` validation proves mapper-based table discovery
- real generation against `music-education-admin` produces at least one non-empty DB knowledge object when valid LLM config is supplied

## Explicitly Unacceptable Outcomes

The following do **not** count as success:

- leaving the CLI on CJS while tolerating `import.meta` warnings
- making tests green by skipping the broken CLI startup path
- silencing type errors with broad ignores
- validating only fixtures and not the real target repository
- generating DB objects whose table/field identity is not backed by MyBatis evidence
- treating a startup crash as an environment issue rather than a code issue
