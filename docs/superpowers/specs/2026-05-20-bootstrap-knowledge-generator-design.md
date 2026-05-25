# Bootstrap Knowledge Generator Design

**Date:** 2026-05-20

**Status:** Approved design

**Related standards:** `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-coding-standards.md`

## Goal

Build a standalone TypeScript/Node.js CLI that generates a `bootstrap-knowledge/` package inside any target repository. The package is produced from `GitNexus` index data plus targeted source evidence, with `LLM` used only for controlled content generation. The output is designed for external AI agent skills to consume through a stable file contract.

## Scope

### In scope

- A standalone CLI project
- Automatic reuse of existing `GitNexus` index when present
- Automatic `gitnexus analyze` when the target repo has no usable index
- Full rebuild of `bootstrap-knowledge/` on every run
- Whole-repo generation and `--slice` generation
- Generation of these object types:
  - `TERM`
  - `CON`
  - `FLOW`
  - `MOD`
  - `OPEN`
  - `OWN`
  - `VER`
  - `DB`
- Database schema extraction for all tables actually used by the codebase
- Chinese field descriptions for every `DB` field
- Stable output schema for external skill consumption

### Out of scope

- Final knowledge promotion workflow
- Requirements-driven knowledge validation
- Skill installation or skill runtime implementation
- Free-form wiki generation
- Business-level source-of-truth reasoning beyond code-evidence scope
- Incremental knowledge regeneration
- Multi-repo orchestration UI or service deployment

## Product Shape

The product is a CLI-only project. The CLI takes a repository path, ensures `GitNexus` indexing is available, extracts controlled evidence bundles, uses an OpenAI-compatible model to generate structured object drafts, validates them, and writes a full `bootstrap-knowledge/` package into the target repository.

## User Flow

1. User runs the CLI with a target repo path.
2. CLI checks whether the target repo already has a usable `GitNexus` index.
3. If no usable index exists, CLI runs `gitnexus analyze`.
4. CLI discovers generation scope:
   - whole-repo mode, or
   - `--slice` mode
5. CLI builds controlled evidence bundles.
6. CLI invokes the LLM with object-type-specific structured prompts.
7. CLI validates outputs and renders knowledge files.
8. CLI replaces the target repo's existing `bootstrap-knowledge/`.
9. CLI writes summary and coverage reports.

## Output Location

The generated package is always written to:

```text
<target-repo>/bootstrap-knowledge/
```

Each run fully rebuilds and overwrites the package.

## Knowledge Package Structure

```text
bootstrap-knowledge/
|-- manifest.yaml
|-- catalog.yaml
|-- objects/
|   |-- term/
|   |-- con/
|   |-- flow/
|   |-- mod/
|   |-- open/
|   |-- own/
|   |-- ver/
|   |-- db/
|-- reports/
|   |-- generation-summary.md
|   |-- coverage-report.yaml
```

### Contract exposed to external skills

The package exposes only these stable integration points:

- `manifest.yaml`
- `catalog.yaml`
- `objects/*`

The generator does not embed any `SKILL.md`, prompt instructions, or agent-specific runtime files into the package.

## Knowledge Object Set

### TERM

Purpose:

- Explain recurring code-level terms that affect agent understanding

### CON

Purpose:

- Represent route, tool, HTTP, and cross-boundary contract knowledge

### FLOW

Purpose:

- Represent process and execution-flow knowledge

### MOD

Purpose:

- Represent module responsibilities, entry points, and change surfaces

### OPEN

Purpose:

- Represent unresolved ambiguity, evidence gaps, conflicts, and partial coverage

### OWN

Purpose:

- Represent code-level ownership and write/read boundaries

### VER

Purpose:

- Represent available verification anchors and obvious testing gaps

### DB

Purpose:

- Represent each database table used by the codebase as a first-class object

Rules:

- One table per object file
- Every field must include:
  - Chinese description
  - description source marker

## Common Object Frontmatter

Every object file uses `Markdown + YAML frontmatter`.

Required frontmatter fields:

```yaml
id:
type:
title:
status:
maturity: bootstrap
scope:
repo:
slice_ids: []
evidence_primary: []
evidence_secondary: []
stale_if: []
generated_by:
generated_at:
```

Rules:

- `type` must be one of `TERM | CON | FLOW | MOD | OPEN | OWN | VER | DB`
- `status` must be one of `fact | derived | open-question`
- `maturity` is fixed to `bootstrap` in v1

## Object-Specific Minimum Schema

### TERM

Required structured fields:

```yaml
canonical_term:
aliases: []
code_level_meaning:
not_equal_to: []
related_symbols: []
```

### CON

Required structured fields:

```yaml
interface_kind: route | tool | http-contract | group-contract
producer:
consumers: []
input_shape: []
output_shape: []
middleware: []
error_shape: []
related_routes: []
related_tools: []
```

### FLOW

Required structured fields:

```yaml
flow_kind: process | request-path | tool-path
entry_points: []
ordered_steps: []
cross_module_handoffs: []
side_effects: []
terminal_points: []
```

### MOD

Required structured fields:

```yaml
module_kind: file | directory | cluster | service
entry_points: []
depends_on: []
reads: []
writes: []
test_anchors: []
touch_when: []
do_not_touch_when: []
```

### OPEN

Required structured fields:

```yaml
unknown_type: ambiguity | missing-evidence | conflict | partial-coverage
question:
why_unresolved:
blocks: []
next_evidence: []
```

### OWN

Required structured fields:

```yaml
subject:
ownership_kind: code-owner | write-owner | local-source-of-truth
writable_by: []
read_by: []
forbidden_writers: []
boundary_notes: []
```

### VER

Required structured fields:

```yaml
covers:
existing_tests: []
observable_signals: []
known_gaps: []
suggested_checks: []
```

### DB

Required structured fields:

```yaml
table_name:
table_name_zh:
schema_name:
source_kind: ddl | migration | orm | inferred
primary_key: []
indexes: []
foreign_keys: []
read_by: []
write_by: []
fields:
  - name:
    type:
    nullable:
    default:
    description_zh:
    description_source: comment | inferred
    constraints: []
```

DB rules:

- `description_zh` is mandatory for every field
- `description_source` is mandatory for every field
- Missing true schema evidence is allowed only when `source_kind: inferred`

## Generation Modes

### Whole-repo mode

Default mode. The CLI discovers and covers:

- all detected routes
- all detected tools
- major processes
- major communities
- all actually used database tables

### Slice mode

Selective generation via `--slice`.

Supported slice kinds:

- `route`
- `process`
- `tool`
- `community`
- `database`

## Internal Architecture

Recommended source layout:

```text
src/
|-- cli/
|-- config/
|-- gitnexus/
|-- slicing/
|-- evidence/
|-- generation/
|-- packaging/
|-- schemas/
|-- shared/
```

### `cli/`

Responsibilities:

- command parsing
- progress output
- orchestration entrypoints

Commands:

- `generate`
- `status`
- `clean`

### `config/`

Responsibilities:

- environment parsing
- OpenAI-compatible model config
- defaults

### `gitnexus/`

Responsibilities:

- ensure index presence
- invoke `gitnexus analyze`
- provide a stable adapter over GitNexus queries

### `slicing/`

Responsibilities:

- discover slices
- build whole-repo or targeted slice plans

### `evidence/`

Responsibilities:

- build repository evidence bundle
- build slice evidence bundles
- normalize and compress evidence for each object type

### `generation/`

Responsibilities:

- prompt construction
- LLM invocation
- structured draft generation
- retry and repair

### `packaging/`

Responsibilities:

- dedupe
- render markdown
- build manifest and catalog
- write reports

### `schemas/`

Responsibilities:

- runtime validation for evidence bundles
- runtime validation for object drafts
- manifest and catalog schemas

### `shared/`

Responsibilities:

- ids
- yaml/json io
- filesystem helpers
- logging
- error types

## Main Execution Pipeline

The `generate` command must run this sequence:

1. Parse CLI args
2. Resolve model config
3. Validate target repo path
4. Ensure `GitNexus` index exists
5. Discover generation scope
6. Build repository evidence bundle
7. Build slice evidence bundles
8. Build object draft inputs
9. Generate structured object drafts with the LLM
10. Validate structure and semantics
11. Dedupe and merge objects
12. Render markdown objects
13. Build `manifest.yaml`
14. Build `catalog.yaml`
15. Write reports
16. Replace `bootstrap-knowledge/`

## Evidence Bundle Architecture

Three evidence layers:

```text
RepositoryEvidenceBundle
  -> SliceEvidenceBundle
    -> ObjectDraftInput
```

### RepositoryEvidenceBundle

Contains only stable repository-wide context:

- repo id/path/commit
- GitNexus index state
- counts for routes/tools/processes/communities
- inventory of detected tables
- schema-source distribution

### SliceEvidenceBundle

Contains slice-scoped evidence:

- slice metadata
- normalized facts
- key symbols
- relations
- snippets
- tables
- tests
- gaps

### ObjectDraftInput

Contains only the minimal evidence needed for one object type.

The LLM must never receive unrestricted full-repo context.

## Database Schema Discovery Strategy

Schema discovery precedence is fixed:

1. DDL / schema files
2. migration files
3. ORM models / entities
4. SQL statements
5. GitNexus `QUERIES / ACCESSES`
6. inferred fallback

Rules:

- Table structure should prefer definition sources
- Read/write relationships should prefer code execution sources
- LLM may only explain or fill Chinese descriptions
- LLM must not invent structural fields

### Table inclusion rule

A table becomes a `DB` object when at least one of these is true:

- appears in DDL or schema definitions
- appears in migration files
- appears in ORM models
- appears in SQL statements
- is referenced by code-level data access evidence

### Conflict handling

When schema definitions conflict, precedence is:

`DDL > migration > ORM > SQL > inferred`

Unresolved conflicts must produce `OPEN` information and be surfaced in reports.

## LLM Usage Model

The LLM is used for controlled content generation only.

### The LLM may do

- summarize evidence into readable knowledge statements
- generate Chinese descriptions
- generate concise explanations
- explicitly preserve uncertainty

### The LLM may not do

- inspect the repository directly
- call GitNexus directly
- create new object types
- invent routes, tables, fields, symbols, or tools
- overwrite structural evidence

### Prompt contract

Every generation call must use:

- system instructions enforcing source-grounded output
- a structured `ObjectDraftInput`
- a fixed output schema
- JSON-only output

### Retry strategy

Allowed recovery behaviors:

- API retry on transient failure
- strict JSON repair retry
- schema repair retry
- object-level partial failure with full-package continuation

## Validation Rules

Two validation layers are required.

### Structural validation

- parseable JSON
- required fields present
- valid enums
- valid array shapes
- valid object type schema

### Semantic validation

- valid id naming
- evidence references must exist
- no invented `DB` fields
- no invented `CON` shapes
- `FLOW` must preserve ordered steps
- `OPEN` must correspond to real evidence gaps
- weak `OWN` claims must be downgraded when unsupported

## Reports

### `reports/generation-summary.md`

Human-readable run summary including:

- target repo
- commit
- generation timestamp
- object counts
- failures
- warnings
- `OPEN` summary
- DB source summary

### `reports/coverage-report.yaml`

Machine-readable coverage and quality summary including:

- inventory totals
- coverage totals
- object counts
- DB field description source counts
- failures
- warnings

## Coverage Strategy

Whole-repo mode should cover:

- all routes
- all tools
- major processes
- major communities
- all actually used tables

This does not require knowledge objects for every source file.

## CLI Surface

### `generate`

Required args:

- `--repo <path>`

Supported args:

- `--slice <value>`
- `--model <name>`
- `--base-url <url>`
- `--api-key-env <ENV_NAME>`
- `--force-analyze`
- `--verbose`

### `status`

Shows:

- whether `bootstrap-knowledge/` exists
- last generation time
- source commit
- object counts
- coverage summary

### `clean`

Deletes:

- `<target-repo>/bootstrap-knowledge/`

## Non-goals for v1

- no final-knowledge maturity workflow
- no promotion or demotion states
- no requirements-document dependency
- no human-authored skill bundle
- no free-form wiki output
- no service deployment

## Allowed v1 Limitations

- `OWN` is code-level only
- `VER` is verification-anchor-level only
- some DB schema may be inferred
- some field descriptions may be inferred
- some slices may partially fail

## Unacceptable Behaviors

- invented tables, fields, routes, tools, or symbols
- unstable output structure across runs
- missing `description_source` for DB fields
- silent swallowing of unresolved uncertainty
- hard coupling between knowledge package and skill implementation
- hard failure when GitNexus is missing but can be analyzed

## Acceptance Criteria

The v1 MVP is accepted when:

- `generate --repo <path>` completes successfully on a valid target repo
- the CLI reuses existing GitNexus index when available
- the CLI can automatically run `gitnexus analyze` when needed
- the target repo receives a full `bootstrap-knowledge/` package
- `manifest.yaml` and `catalog.yaml` are always present
- object files are generated for the supported object types when evidence exists
- used database tables become `DB-*` objects
- every DB field has Chinese description and description source
- `coverage-report.yaml` is always written
- object-level failure does not force whole-package failure

## Architecture Summary

This design is a graph-first bootstrap knowledge generator:

- `GitNexus` provides structural and execution evidence
- controlled evidence bundles narrow the LLM input
- the LLM generates content but not structure
- program code enforces schema, validation, and packaging
- the final output is a stable knowledge package for external skills
