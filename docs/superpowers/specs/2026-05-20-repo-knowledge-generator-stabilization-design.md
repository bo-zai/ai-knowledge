# Repo Knowledge Generator Stabilization Design

**Context:** The repository-root layout is accepted, the project now builds and passes a broader test suite, and core contract semantics have partially improved. However, the generator is still not reliable enough for real repositories because several critical paths remain synthetic, platform-fragile, or under-validated.

**Related docs:**
- `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-design.md`
- `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-coding-standards.md`
- `docs/superpowers/specs/2026-05-20-repo-knowledge-generator-gap-closure-design.md`
- `docs/superpowers/plans/2026-05-20-repo-knowledge-generator-gap-closure.md`

## Goal

Stabilize the current implementation so the CLI can generate trustworthy `bootstrap-knowledge/` packages for real repositories, not just pass scaffold-oriented tests.

This round is not a rewrite. It is a targeted hardening pass focused on:

- slice-specific evidence quality,
- platform-safe metadata generation,
- real validation breadth,
- GitNexus integration robustness,
- and test realism.

## What Improved Since The Last Review

The current code is no longer a pure placeholder:

- `generate` now ensures or triggers GitNexus indexing.
- `CON` semantics have moved closer to actual contracts.
- `status` parses structured YAML.
- reports include more structured fields.
- unit and integration coverage are broader than before.

That progress is real, but it is not enough to call the implementation ready.

## Remaining High-Risk Gaps

### 1. All slices still share repository-level evidence

`generate` builds one repository evidence bundle and reuses it for every slice. That means:

- route objects are not driven by route-specific evidence,
- DB objects are not driven by table-specific evidence,
- process objects are not driven by process-specific evidence.

This is the largest remaining correctness problem. It means the system can produce structurally valid objects while still being semantically detached from the slice it claims to describe.

### 2. Windows path handling is incorrect

The implementation derives `repoName`, `repoId`, and `repo` metadata by splitting on `'/'`. In the accepted environment, repository paths are Windows-style paths using backslashes. That means metadata can silently degrade to full-path strings instead of actual repo basenames.

This will pollute:

- manifest identity,
- object frontmatter,
- and potentially future catalog-based lookups.

### 3. GitNexus slice discovery is tied to a fragile text format

Current slice extraction depends on parsing plain text lines like:

- `Route:`
- `Process:`
- `Tool:`
- `Community:`
- `Table:`

This is brittle because:

- it assumes a specific CLI output format,
- it is not schema-backed,
- and current tests mostly mock that same synthetic output.

If real GitNexus output changes or differs across versions, generation can silently collapse into empty or partial slice plans.

### 4. Validation breadth is still too narrow

The current pipeline only applies strict schema validation to some object types, while others effectively pass through as unvalidated draft payloads.

This creates a mismatch:

- package structure looks complete,
- tests pass,
- but non-DB / non-CON objects can still drift away from the published object contract.

### 5. Test suite still permits “empty success” as a valid happy path

The suite is broader than before, but it still treats “no generated objects” as an acceptable success case in core integration scenarios.

That is useful for partial-failure resilience, but it must no longer be used as a primary success signal for the generator as a whole. Otherwise the CLI can regress into low-yield generation while remaining green.

## Design Direction

Keep the current structure and modules, but move from “feature-complete enough to demo” to “behaviorally reliable”.

This stabilization round should prioritize:

1. slice-specific evidence inputs,
2. platform-safe metadata and path handling,
3. schema validation for all emitted object types,
4. more realistic GitNexus query adapters,
5. test cases that require non-empty, slice-aligned output where evidence exists.

## Required Changes

### A. Introduce true slice-level evidence

For each slice kind:

- `route`
- `process`
- `tool`
- `community`
- `database`

the generator must build a dedicated `SliceEvidenceBundle` and pass that to the relevant object generator.

Repository-level evidence can remain as shared context, but it must not be the sole evidence input.

### B. Normalize path handling

Replace manual string splitting with path-aware basename resolution everywhere project identity is derived. This includes:

- manifest repo id,
- slice evidence repo name,
- object frontmatter repo field.

### C. Harden GitNexus integration

The adapter layer should return structured data or normalized intermediate results rather than leaking raw CLI text into higher-level parsing logic.

Even if the first implementation still uses CLI calls internally, text parsing should be isolated inside `gitnexus/` or a dedicated normalization layer, not embedded as an assumed contract for the rest of the pipeline.

### D. Validate all object types

Every emitted object type in `v1` must have:

- a schema,
- runtime validation before packaging,
- and a failure path that records partial failure instead of silently passing invalid drafts through.

### E. Tighten success criteria in tests

Where the fixture repository contains sufficient evidence, tests must assert:

- at least one object is generated,
- the object type matches the slice kind,
- package metadata is repository-correct,
- and object content comes from slice-aligned evidence.

The “empty package is acceptable” scenario should remain only for intentionally evidence-poor fixtures, not for the default generation path.

## Non-Goals

This stabilization round still does not add:

- maturity promotion,
- requirement-driven evaluation,
- multi-provider LLM abstraction,
- human-oriented combined wiki pages,
- or skill-side integration.

## Acceptance Criteria

This round is complete when all of the following are true:

- slice generation uses slice-specific evidence instead of one shared repository bundle,
- repository identity is correct on Windows paths,
- GitNexus output normalization is isolated and tested,
- all emitted object types are schema-validated before packaging,
- integration tests require non-empty output when fixture evidence exists,
- empty-package success is limited to explicitly sparse fixtures,
- and `npm run build`, `npm run typecheck`, and `npm test` all pass.
