# Repo Knowledge Generator Gap-Closure Design

**Context:** The project has already been moved to the repository root and this layout is accepted. The current codebase builds, type-checks, and passes tests, but the implementation is still a scaffold and does not satisfy the approved `bootstrap-knowledge` generator design.

**Related docs:**
- `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-design.md`
- `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-coding-standards.md`
- `docs/superpowers/plans/2026-05-20-bootstrap-knowledge-generator.md`

## Goal

Close the gap between the current runnable scaffold and the approved `v1` design without changing the accepted root-level project layout.

The next implementation round must produce a real end-to-end `generate` pipeline that:

- ensures or reuses GitNexus index data,
- extracts controlled evidence from real repository inputs,
- invokes the LLM with typed object-draft inputs,
- validates object drafts,
- writes non-empty, spec-shaped `bootstrap-knowledge/` packages,
- and reports partial failures explicitly.

## Current Gaps

### 1. `generate` is still a placeholder pipeline

The current `src/cli/generate.ts` writes a manifest, an empty catalog, zero objects, and a summary report without:

- calling GitNexus,
- discovering slices,
- building evidence bundles,
- invoking the LLM,
- validating any generated object,
- or producing real object files.

This means the CLI is operational as a shell, but not as a knowledge generator.

### 2. `CON` semantics were implemented incorrectly

The approved design defines `CON` as an interface-contract object:

- route / tool / API summary,
- producer and consumers,
- inputs and outputs,
- runtime semantics,
- code anchors.

The current code models `CON` as a generic “constraint” object. That is not a naming issue; it changes the object meaning and breaks downstream skill expectations.

### 3. Evidence extraction is not implemented

The current `bundle-builder` only emits a synthetic repository-exists fact. The approved design requires:

- repository-level inventory,
- slice-level evidence,
- object-level draft inputs,
- DB schema extraction from DDL / migration / ORM / SQL / inferred fallbacks,
- and explicit gaps for unresolved evidence.

Without this layer, any future LLM generation will either hallucinate or remain empty.

### 4. `status` and report semantics are too shallow

The current `status` command only performs string scanning on `manifest.yaml`. It does not parse the package as structured data and does not report:

- object counts,
- coverage,
- DB coverage quality,
- warnings,
- partial-failure state.

### 5. Tests mostly validate the scaffold, not the approved behavior

The test suite passing is currently not meaningful enough because it proves:

- the CLI starts,
- the generator writes placeholder files,
- and a package can exist with zero objects.

It does not prove:

- GitNexus index reuse / auto-analyze,
- evidence extraction,
- DB table discovery,
- object draft validation,
- partial object failure handling,
- or spec-shaped `CON / DB / OWN / VER` output.

## Design Direction

Keep the current module layout and continue from the existing scaffold, but change the implementation from “placeholder package writer” to “real orchestrated pipeline”.

### Keep

- repository-root project layout,
- TypeScript / Node.js stack,
- root CLI entry,
- current module families:
  - `gitnexus/`
  - `slicing/`
  - `evidence/`
  - `generation/`
  - `packaging/`
  - `schemas/`

### Change

- replace placeholder orchestration in `src/cli/generate.ts`,
- rename `constraint` schema/generator terminology to actual `con` contract terminology,
- implement real evidence extraction and object generation,
- tighten tests around real package semantics.

## Required Functional Changes

### A. Real `generate` orchestration

`generate` must do the following in order:

1. resolve repo and model config,
2. ensure GitNexus index or trigger analyze,
3. discover generation slices,
4. build evidence bundles per slice,
5. derive object draft inputs,
6. invoke object generators by type,
7. validate drafts structurally and semantically,
8. render and write objects,
9. write manifest/catalog/reports,
10. keep package generation alive under partial object failure.

### B. Restore correct `CON` meaning

The `CON` object must match the approved schema. It should represent contracts, not abstract constraints.

This requires:

- schema redesign,
- prompt redesign,
- renderer alignment,
- test updates,
- and likely file renaming from `constraint.*` to `con.*`.

### C. Implement DB extraction as a first-class path

`DB` remains a first-class object type. The implementation must:

- detect real tables used by code,
- merge schema evidence from multiple sources,
- emit one object per table,
- emit one field entry per discovered field,
- ensure every field has `description_zh`,
- ensure every field has `description_source: comment | inferred`.

### D. Improve structured package introspection

`status` should parse YAML and summarize:

- manifest identity,
- object counts,
- coverage metrics when present,
- and whether the package is partial or complete.

### E. Upgrade tests to behavior-level checks

The next test round must use:

- fake GitNexus adapters,
- fake LLM outputs,
- real temp repositories,
- and assertions on object files and package structure.

## Non-Goals

This recovery round still does not include:

- maturity promotion,
- requirement-driven evaluation workflows,
- human-oriented composed wiki pages beyond current package needs,
- multiple model providers beyond OpenAI-compatible API,
- skill installation or runtime integration.

## Acceptance Criteria

The recovery round is complete when all of the following are true:

- `generate` no longer emits an always-empty package,
- `CON` objects use contract semantics, not constraint semantics,
- DB extraction produces at least one real `DB-*` object when schema evidence exists,
- every generated DB field contains both `description_zh` and `description_source`,
- `status` parses package files as structured YAML,
- partial object generation failure is reflected in reports instead of silently disappearing,
- integration tests cover GitNexus reuse/analyze branching, package generation, DB object generation, and partial failure behavior,
- `npm run build`, `npm run typecheck`, and `npm test` all pass.
