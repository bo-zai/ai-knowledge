# Partition Business Domain Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `partition` business-domain mode into an evidence-driven, multi-stage LLM adjudication pipeline where local code constructs facts and constraints, while business-domain semantics are decided by the model.

**Architecture:** The existing mixed pipeline will be decomposed into `evidence -> subject discovery -> relation inference -> LLM subject adjudication -> LLM relation adjudication -> domain assembly -> global reconciliation -> materialization -> cross-domain synthesis`. Existing capability-domain behavior remains intact, while the business-domain path is migrated behind the same CLI entry. Every stage writes reviewable artifacts under `.knowledge/domain-analysis/`.

**Tech Stack:** TypeScript, existing CLI/runtime/agent stack, current partitioning types, JSON artifact files, real-project regression on `mall-group`, `music`, `dynamic-tp`.

---

### Task 1: Freeze Current Entry Boundaries

**Files:**

- Modify: `src/partitioning/domain-partitioner.ts`
- Modify: `src/partitioning/index.ts`
- Modify: `src/domain-analysis/index.ts`

- [ ] Step 1: Introduce a single business-domain pipeline entry function
- [ ] Step 2: Reduce `domain-partitioner.ts` to orchestration only
- [ ] Step 3: Keep capability-domain flow untouched and isolated
- [ ] Step 4: Re-export only stable business-domain entry points from `index.ts`
- [ ] Step 5: Run load check for partition entry modules
- [ ] Step 6: Commit boundary-only refactor

### Task 2: Create New Business-Domain Module Skeleton

**Files:**

- Create: `src/partition/business-domain/index.ts`
- Create: `src/partition/business-domain/run-business-domain-partition.ts`
- Create: `src/partition/business-domain/types.ts`
- Create: `src/partition/business-domain/context.ts`

- [ ] Step 1: Add the top-level business-domain module directory
- [ ] Step 2: Define stage context types shared across the new pipeline
- [ ] Step 3: Add a single `runBusinessDomainPartition` orchestrator shell
- [ ] Step 4: Wire the old business-domain path to call the new orchestrator
- [ ] Step 5: Run module load verification
- [ ] Step 6: Commit the skeleton

### Task 3: Define Canonical Evidence Model

**Files:**

- Create: `src/partition/evidence/types.ts`
- Create: `src/partition/evidence/evidence-bundle.ts`
- Create: `src/partition/evidence/evidence-atom.ts`
- Modify: `src/domain-analysis/types.ts`

- [ ] Step 1: Define `EvidenceAtom`, `EvidenceBundle`, and source enums
- [ ] Step 2: Define stable evidence references for later LLM prompts
- [ ] Step 3: Add compatibility mapping from old domain-analysis types where required
- [ ] Step 4: Remove semantic meaning from evidence model names
- [ ] Step 5: Run type-level load verification
- [ ] Step 6: Commit canonical evidence model

### Task 4: Split Evidence Sources from Business Logic

**Files:**

- Create: `src/partition/evidence/sources/code-entry-source.ts`
- Create: `src/partition/evidence/sources/service-call-source.ts`
- Create: `src/partition/evidence/sources/mapper-sql-source.ts`
- Create: `src/partition/evidence/sources/schema-source.ts`
- Create: `src/partition/evidence/sources/commit-source.ts`
- Create: `src/partition/evidence/sources/project-doc-source.ts`
- Create: `src/partition/evidence/sources/database-ddl-source.ts`
- Create: `src/partition/evidence/sources/database-instance-source.ts`
- Create: `src/partition/evidence/sources/index.ts`

- [ ] Step 1: Move current code-entry extraction into a source module that emits facts only
- [ ] Step 2: Move mapper and SQL extraction into a source module that emits facts only
- [ ] Step 3: Move schema extraction into a source module that emits facts only
- [ ] Step 4: Move commit/doc extraction into source modules that emit facts only
- [ ] Step 5: Add empty but typed DDL and DB-instance source files for future extension
- [ ] Step 6: Ensure no source module returns `business-root`, `support`, or domain labels
- [ ] Step 7: Commit source extraction split

### Task 5: Build Evidence Collector and Normalizer

**Files:**

- Create: `src/partition/evidence/collect-evidence.ts`
- Create: `src/partition/evidence/normalize-evidence.ts`
- Create: `src/partition/evidence/derive-evidence-signals.ts`
- Modify: `src/domain-analysis/artifacts/analysis-artifact-writer.ts`

- [ ] Step 1: Implement a collector that aggregates all source outputs into one bundle
- [ ] Step 2: Normalize duplicates, confidence ranges, and evidence references
- [ ] Step 3: Derive only structural helper signals, never business labels
- [ ] Step 4: Write `evidence-atoms.json` and `evidence-bundle.json`
- [ ] Step 5: Verify artifact output path and filenames
- [ ] Step 6: Commit evidence collector

### Task 6: Replace Candidate Builder with Subject Discovery

**Files:**

- Create: `src/partition/subject-discovery/types.ts`
- Create: `src/partition/subject-discovery/entry-surface-builder.ts`
- Create: `src/partition/subject-discovery/table-cohesion-builder.ts`
- Create: `src/partition/subject-discovery/behavior-cluster-builder.ts`
- Create: `src/partition/subject-discovery/subject-candidate-builder.ts`
- Create: `src/partition/subject-discovery/index.ts`
- Modify: `src/partitioning/candidate-builder.ts`

- [ ] Step 1: Define `SubjectCandidate` and supporting structures
- [ ] Step 2: Build entry-surface extraction from evidence atoms
- [ ] Step 3: Build table cohesion clusters from access and write patterns
- [ ] Step 4: Build behavior clusters from shared lifecycle actions
- [ ] Step 5: Compose final subject candidates with uncertainty flags
- [ ] Step 6: Convert old `candidate-builder.ts` into a compatibility wrapper or stop using it in business-domain flow
- [ ] Step 7: Write `subject-candidates.json`
- [ ] Step 8: Commit subject discovery

### Task 7: Rebuild Schema and Non-FK Relation Inference

**Files:**

- Create: `src/partition/relation-inference/types.ts`
- Create: `src/partition/relation-inference/explicit-fk-inference.ts`
- Create: `src/partition/relation-inference/implicit-fk-inference.ts`
- Create: `src/partition/relation-inference/sql-join-inference.ts`
- Create: `src/partition/relation-inference/transaction-cohesion-inference.ts`
- Create: `src/partition/relation-inference/naming-structure-inference.ts`
- Create: `src/partition/relation-inference/build-subject-relations.ts`
- Create: `src/partition/relation-inference/index.ts`
- Modify: `src/partitioning/schema-relation-builder.ts`

- [ ] Step 1: Define canonical relation graph types
- [ ] Step 2: Extract explicit FK inference into its own module
- [ ] Step 3: Add implicit FK inference from SQL and column usage
- [ ] Step 4: Add join-based and transaction-cohesion inference
- [ ] Step 5: Restrict naming structure to weak evidence only
- [ ] Step 6: Stop using schema relation builder as a semantic decider in business-domain mode
- [ ] Step 7: Write `subject-relations.json`
- [ ] Step 8: Commit relation inference layer

### Task 8: Rebuild Subject Role LLM Stage

**Files:**

- Create: `src/partition/llm-adjudication/subject-role/types.ts`
- Create: `src/partition/llm-adjudication/subject-role/build-subject-role-input.ts`
- Create: `src/partition/llm-adjudication/subject-role/subject-role-agent.ts`
- Create: `src/partition/llm-adjudication/subject-role/run-subject-role-adjudication.ts`
- Modify: `src/prompts/subject-candidate-analysis.md`

- [ ] Step 1: Define subject-role input and output types
- [ ] Step 2: Build per-candidate or small-batch LLM inputs
- [ ] Step 3: Implement agent invocation with artifact logging
- [ ] Step 4: Keep JSON repair support local to this stage
- [ ] Step 5: Ensure prompt examples are evidence-based, not keyword-based
- [ ] Step 6: Write `subject-role-input.json` and `subject-role-output.json`
- [ ] Step 7: Commit subject role adjudication

### Task 9: Rebuild Relation Adjudication LLM Stage

**Files:**

- Create: `src/partition/llm-adjudication/relation/types.ts`
- Create: `src/partition/llm-adjudication/relation/build-relation-adjudication-input.ts`
- Create: `src/partition/llm-adjudication/relation/relation-adjudication-agent.ts`
- Create: `src/partition/llm-adjudication/relation/run-relation-adjudication.ts`
- Create: `src/prompts/relation-adjudication.md`

- [ ] Step 1: Define relation adjudication input and output types
- [ ] Step 2: Group relation candidates into small evidence-driven batches
- [ ] Step 3: Implement agent invocation and JSON normalization
- [ ] Step 4: Distinguish `ownership`, `reference`, `shared-master-data`, and `noise-correlation`
- [ ] Step 5: Write `relation-adjudication-input.json` and `relation-adjudication-output.json`
- [ ] Step 6: Commit relation adjudication stage

### Task 10: Rebuild Final Domain Assembly LLM Stage

**Files:**

- Create: `src/partition/llm-adjudication/domain-assembly/types.ts`
- Create: `src/partition/llm-adjudication/domain-assembly/build-domain-assembly-input.ts`
- Create: `src/partition/llm-adjudication/domain-assembly/domain-assembly-agent.ts`
- Create: `src/partition/llm-adjudication/domain-assembly/run-domain-assembly.ts`
- Modify: `src/prompts/domain-main-analysis.md`

- [ ] Step 1: Define final domain assembly input from adjudicated subjects and relations
- [ ] Step 2: Ensure final input is summary-first and evidence-backed
- [ ] Step 3: Implement domain assembly agent
- [ ] Step 4: Remove direct dependence on raw candidate dumps in this stage
- [ ] Step 5: Write `domain-assembly-input.json` and `domain-assembly-output.json`
- [ ] Step 6: Commit final domain assembly

### Task 11: Shrink Global Reconciliation to Consistency Only

**Files:**

- Modify: `src/domain-analysis/domain-analysis/structural-validator.ts`
- Create: `src/partition/global-reconciliation/types.ts`
- Create: `src/partition/global-reconciliation/reconcile-domain-decisions.ts`
- Create: `src/partition/global-reconciliation/domain-conflict-resolver.ts`
- Create: `src/partition/global-reconciliation/index.ts`

- [ ] Step 1: Move reconciliation responsibilities out of `structural-validator.ts`
- [ ] Step 2: Limit reconciliation to conflict resolution, de-duplication, and invalid-domain removal
- [ ] Step 3: Remove automatic domain invention from validator logic
- [ ] Step 4: Keep only minimal fallback behavior for malformed LLM output
- [ ] Step 5: Write `global-reconciliation-output.json`
- [ ] Step 6: Commit reconciliation shrink

### Task 12: Rebuild Materialization Layer

**Files:**

- Create: `src/partition/materialization/materialize-domain-partitions.ts`
- Create: `src/partition/materialization/build-partition-index.ts`
- Create: `src/partition/materialization/index.ts`
- Modify: `src/partitioning/partition-aggregator.ts`
- Modify: `src/partitioning/partition-writer.ts`

- [ ] Step 1: Convert final domain decisions into stable partition payloads
- [ ] Step 2: Preserve existing output contract where possible
- [ ] Step 3: Keep materialization free of semantic domain inference
- [ ] Step 4: Update index writing and hash generation integration
- [ ] Step 5: Commit materialization layer

### Task 13: Rebuild Cross-Domain Dependency Synthesis

**Files:**

- Create: `src/partition/cross-domain/synthesize-cross-domain-refs.ts`
- Create: `src/partition/cross-domain/build-cross-domain-input.ts`
- Create: `src/partition/cross-domain/types.ts`
- Modify: `src/domain-analysis/cross-domain-analysis/cross-domain-analysis-agent.ts`
- Modify: `src/domain-analysis/cross-domain-analysis/cross-domain-signal-builder.ts`

- [ ] Step 1: Make cross-domain synthesis consume stabilized domain boundaries only
- [ ] Step 2: Keep this stage from modifying domain ownership
- [ ] Step 3: Distinguish dependency synthesis from domain adjudication in code and artifacts
- [ ] Step 4: Ensure final refs are written back into partition files
- [ ] Step 5: Commit cross-domain synthesis refactor

### Task 14: Rewire End-to-End Business-Domain Pipeline

**Files:**

- Modify: `src/partition/business-domain/run-business-domain-partition.ts`
- Modify: `src/partitioning/domain-partitioner.ts`
- Modify: `src/domain-analysis/partition-analysis/run-partition-analysis.ts`

- [ ] Step 1: Replace the old business-domain execution path with the new stage sequence
- [ ] Step 2: Keep artifact writing at every stage
- [ ] Step 3: Keep concurrency support only for batch LLM stages
- [ ] Step 4: Preserve CLI behavior and output directory contract
- [ ] Step 5: Commit end-to-end wiring

### Task 15: Remove Legacy Mixed Responsibilities

**Files:**

- Modify: `src/partitioning/candidate-builder.ts`
- Modify: `src/partitioning/schema-relation-builder.ts`
- Modify: `src/domain-analysis/partition-analysis/run-partition-analysis.ts`
- Modify: `src/domain-analysis/index.ts`

- [ ] Step 1: Remove legacy business-domain path calls that are no longer used
- [ ] Step 2: Keep only compatibility shims where capability-domain or other modules still depend on them
- [ ] Step 3: Delete or isolate dead mixed-responsibility logic
- [ ] Step 4: Run repo-wide search for obsolete stage names and artifacts
- [ ] Step 5: Commit cleanup

### Task 16: Documentation and Governance Update

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `docs/partition-business-domain-architecture.md`

- [ ] Step 1: Document the new business-domain pipeline architecture
- [ ] Step 2: Document the rule that local logic may not decide business semantics
- [ ] Step 3: Document future evidence source extension points for DDL and DB instance
- [ ] Step 4: Commit docs update

### Task 17: Real-Project Regression Validation

**Files:**

- No code changes required unless regressions are found

- [ ] Step 1: Run `music` full partition regression and inspect all domain-analysis artifacts
- [ ] Step 2: Run `mall-group` full partition regression and inspect all domain-analysis artifacts
- [ ] Step 3: Run `dynamic-tp` full partition regression and confirm capability-domain remains stable
- [ ] Step 4: Record observed gaps as architecture issues, not project-specific patches
- [ ] Step 5: If needed, iterate only on generic evidence or adjudication logic
- [ ] Step 6: Commit final regression pass

---

## File Responsibility Map

- `src/partition/business-domain/`
  - New top-level business-domain orchestration only.
- `src/partition/evidence/`
  - Fact collection, normalization, and artifact generation.
- `src/partition/subject-discovery/`
  - Candidate subject discovery from evidence, no business semantics.
- `src/partition/relation-inference/`
  - Ownership/reference graph construction, including non-FK inference.
- `src/partition/llm-adjudication/subject-role/`
  - Candidate role adjudication.
- `src/partition/llm-adjudication/relation/`
  - Candidate relation adjudication.
- `src/partition/llm-adjudication/domain-assembly/`
  - Final business domain assembly.
- `src/partition/global-reconciliation/`
  - Consistency-only result repair.
- `src/partition/materialization/`
  - Final partition payload and index generation.
- `src/partition/cross-domain/`
  - Cross-domain dependency synthesis after boundaries are fixed.

---

## Validation Commands

- Load check:
  - `@'`
  - `import './src/partition/business-domain/index.ts';`
  - `import './src/partition/evidence/types.ts';`
  - `import './src/partition/subject-discovery/index.ts';`
  - `import './src/partition/relation-inference/index.ts';`
  - `console.log('partition-refactor-load-ok');`
  - `'@ | npx tsx -`

- Real regressions:
  - `npx tsx src/cli/index.ts partition D:\workspace\music --force --concurrency 1`
  - `npx tsx src/cli/index.ts partition D:\workspace\mall-group --force --concurrency 1`
  - `npx tsx src/cli/index.ts partition D:\workspace\dynamic-tp --force --concurrency 1`

---

## Self-Review

- Spec coverage:
  - Covers full redesign of business-domain path, decoupled evidence sources, subject and relation pipelines, split LLM adjudication, reconciliation shrink, artifact layering, and future DDL/DB extension points.
- Placeholder scan:
  - No `TODO`/`TBD` placeholders left in task definitions.
- Consistency:
  - The plan uses one consistent stage model: `evidence -> subject -> relation -> subject-role -> relation-adjudication -> domain-assembly -> reconciliation -> materialization -> cross-domain`.
