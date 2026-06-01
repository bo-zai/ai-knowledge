# Real Document Driven Capability Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not add unit test code. Verification is performed only by generating and reviewing real Markdown knowledge documents from `D:\workspace\other_project\music-education-app`.

**Goal:** Make `generate --knowledge capability --target order` produce usable AI-facing Markdown knowledge documents from the real `music-education-app` repository.

**Architecture:** Keep `src/cli/` as command dispatch. Fix the capability pipeline by improving real evidence, LLM prompting/repair, object assembly, and Markdown packaging. Every implementation step ends by generating real docs and reading them.

**Tech Stack:** TypeScript, Commander, LangGraph, OpenAI-compatible LLM config, existing embedded analysis/indexing, Markdown with YAML frontmatter.

---

## Hard Rules For This Plan

- Do not add unit test files.
- Do not add integration test files.
- Do not use mock LLM output as acceptance evidence.
- Do not claim completion from `npm test`.
- Use `npm run typecheck` and `npm run build` only as compile safety checks.
- Acceptance comes from real generated Markdown docs under `D:\tmp\...`.
- If generated docs are weak, modify code and rerun real generation.

## Known Starting Failure

The current real command fails:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Observed failure:

```text
LLM generation failed: LLM MOD touch guidance is required for business capability knowledge
```

The immediate implementation goal is not to weaken this gate. The goal is to make the real generated LLM knowledge satisfy it, or produce useful `OPEN` docs and debug artifacts explaining what evidence is missing.

## File Structure

Modify:

- `src/cli/generate.ts`
  - Keep only command orchestration glue.
  - Ensure capability failure reports debug output path when possible.

- `src/knowledge/capability-knowledge-pipeline.ts`
  - Remove programmatic business fact backfill.
  - Add real LLM repair loop for failed quality gates.
  - Persist failure debug artifacts before throwing.
  - Prepare for Markdown object output.

- `src/generation/capability-claim-generator.ts`
  - Improve prompt for `MOD`, `VER`, `OPEN`, `FLOW/CON`.
  - Require evidence-grounded touch guidance.
  - Ask for `OPEN` when touch guidance cannot be proven.

- `src/generation/capability-llm-claims-provider.ts`
  - Preserve normalization notes.
  - Return rejected/repair metadata needed by debug docs.

- `src/knowledge/capability-object-assembler.ts`
  - Ensure object metadata supports Markdown rendering.
  - Ensure `OPEN` carries minimal next evidence.

- `src/packaging/capability-knowledge-writer.ts`
  - Render capability objects as `.md` with YAML frontmatter.
  - Keep capability view as Markdown.

- `src/packaging/knowledge-package-writer.ts`
  - Preserve `.md` object paths in `catalog.yaml`.
  - Write debug files even on partial capability failure when available.

Do not create or modify test files for this work.

## Required Real Output Layout

After successful single capability generation:

```text
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\
├── catalog.yaml
├── objects\
│   ├── capabilities\CAP-*.md
│   ├── flows\FLOW-*.md
│   ├── contracts\CON-*.md
│   ├── modules\MOD-*.md
│   ├── validation\VER-*.md
│   └── open\OPEN-*.md
├── views\
│   └── capabilities\CAP-*.md
├── reports\
│   └── generation.json
└── debug\
```

`FLOW` or `CON` is required; both are better.

## Task 1: Establish Real Markdown Baseline

**Files:**

- No source edits in this task.

- [ ] **Step 1: Build current code**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 2: Run real single capability command**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected at current baseline: likely FAIL with the MOD touch guidance error.

- [ ] **Step 3: Record whether debug output exists**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review -Recurse -Force
```

Expected at current baseline: output path may be missing. Record this as a defect if missing.

- [ ] **Step 4: Identify first code change from baseline**

Use the result to classify failure:

```text
Case A: command fails and no debug files exist
Action: implement failure debug persistence first.

Case B: command succeeds but docs are YAML-only
Action: implement Markdown object writer first.

Case C: command succeeds and Markdown exists but knowledge is generic
Action: inspect generated docs and fix prompt/evidence/assembler.
```

For the currently observed failure, proceed with Task 2.

## Task 2: Persist Debug Artifacts On Capability Failure

**Files:**

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/cli/generate.ts`
- Modify: `src/packaging/knowledge-package-writer.ts`

- [ ] **Step 1: Add failure result shape without changing success shape**

In `src/knowledge/capability-knowledge-pipeline.ts`, add an exported error class:

```ts
export class CapabilityKnowledgeGenerationError extends Error {
  constructor(
    message: string,
    public readonly debugFiles: Array<{ path: string; content: string }>,
  ) {
    super(message);
    this.name = 'CapabilityKnowledgeGenerationError';
  }
}
```

- [ ] **Step 2: Build debug files before throwing quality gate failures**

Before each final quality gate throw, build debug files containing:

```ts
function buildCapabilityFailureDebugFiles(input: {
  selectedCandidateId: string;
  candidateCount: number;
  bundle: EvidenceBundle;
  providerClaims: CandidateClaim[];
  filteredProviderClaims: CandidateClaim[];
  skeletonClaims: CandidateClaim[];
  providerDebug?: CapabilityClaimsProviderResult['debug'];
  providerGraphTrace?: CapabilityClaimsProviderResult['graphTrace'];
  failedGate: string;
  failedReason: string;
}): Array<{ path: string; content: string }> {
  return [
    {
      path: 'debug/capability-failure.json',
      content: JSON.stringify(input, null, 2) + '\n',
    },
  ];
}
```

When `modHasTouchGuidance` fails, throw:

```ts
throw new CapabilityKnowledgeGenerationError(
  'LLM generation failed: LLM MOD touch guidance is required for business capability knowledge',
  buildCapabilityFailureDebugFiles({
    selectedCandidateId: topCandidate.candidateId,
    candidateCount: candidates.length,
    bundle,
    providerClaims,
    filteredProviderClaims,
    skeletonClaims,
    providerDebug,
    providerGraphTrace,
    failedGate: 'modHasTouchGuidance',
    failedReason: 'No LLM MOD object contained non-empty touchWhen and doNotTouchWhen',
  }),
);
```

- [ ] **Step 3: Write debug package on caught capability error**

In `src/cli/generate.ts`, when catching `CapabilityKnowledgeGenerationError`, call `writeKnowledgePackage` with:

```ts
{
  stage: 'capability',
  files: error.debugFiles,
  objects: [],
  report: {
    stage: 'capability',
    ran: true,
    succeeded: 0,
    failed: 1,
    details: { error: error.message },
  },
  warnings: [error.message],
}
```

Then rethrow for explicit `--knowledge capability` runs.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 5: Run real command and inspect debug**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

If it fails, run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\debug -Recurse
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\debug\capability-failure.json
```

Expected: debug file exists and reveals whether LLM omitted MOD, produced MOD without hints, or hints were filtered/rejected.

## Task 3: Remove Programmatic Business Fact Backfill

**Files:**

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`

- [ ] **Step 1: Remove generic MOD backfill block**

Delete the block that inserts generic `touchWhen` and `doNotTouchWhen` values after claim merge.

The deleted behavior includes generic sentences like:

```text
Adding new functionality that aligns with this module responsibility
Modifying existing behavior within this module scope
Database schema changes (handled by data access layer)
```

- [ ] **Step 2: Replace backfill with repair requirement**

Keep the quality gate. If LLM MOD is missing touch guidance, the pipeline must either:

- invoke a repair prompt that asks LLM to regenerate evidence-grounded MOD claims, or
- produce `OPEN` stating that module touch boundaries are unknown.

Do not programmatically invent the touch boundaries.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 4: Run real command**

Run the same real command:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: either success with real LLM MOD guidance, or failure with debug explaining why repair did not produce it.

## Task 4: Add LLM Quality Repair For MOD, VER, FLOW/CON

**Files:**

- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/generation/capability-llm-claims-provider.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`

- [ ] **Step 1: Add repair prompt builder**

In `src/generation/capability-claim-generator.ts`, add a function:

```ts
export function buildCapabilityClaimRepairPrompt(input: {
  bundle: EvidenceBundle;
  failedGate: string;
  failedReason: string;
  previousClaims: CandidateClaim[];
}): string {
  return [
    buildCapabilityClaimPrompt(input.bundle),
    '',
    'REPAIR REQUIRED:',
    `Failed gate: ${input.failedGate}`,
    `Reason: ${input.failedReason}`,
    '',
    'Return a full replacement JSON array. Do not patch partially.',
    'If evidence is insufficient, create OPEN claims with blockedDecisions and minimalNextEvidence.',
    'Do not invent module touch guidance. touchWhen/doNotTouchWhen must cite evidence refs or be represented as OPEN.',
    '',
    'Previous accepted claims:',
    JSON.stringify(input.previousClaims, null, 2),
  ].join('\n');
}
```

- [ ] **Step 2: Add provider support for one repair attempt**

Expose a provider method or wrapper that can call the same LLM with a repair prompt. Keep the existing LangGraph runtime; do not create a second unrelated LLM stack.

The repair attempt must preserve:

- raw response
- parsed claims
- normalization notes
- validation errors

- [ ] **Step 3: Invoke repair before final failure**

In `runCapabilityKnowledgePipeline`, when any of these gates fail:

- `capFromLlm`
- `flowOrConFromLlm`
- `modHasTouchGuidance`
- `verOrValidationOpenPresent`

perform one repair attempt using the full evidence bundle and failed gate reason.

Then rerun:

- parse
- filter
- assemble
- quality gates

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 5: Generate and inspect real docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

If successful, list Markdown docs:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

Expected: generated `.md` docs exist. If no `.md` docs exist, proceed to Task 5.

## Task 5: Render Capability Objects As Markdown

**Files:**

- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`

- [ ] **Step 1: Change capability object paths from `.yaml` to `.md`**

Update type-to-path logic so objects are written as:

```text
objects/capabilities/CAP-*.md
objects/terms/TERM-*.md
objects/flows/FLOW-*.md
objects/contracts/CON-*.md
objects/modules/MOD-*.md
objects/validation/VER-*.md
objects/open/OPEN-*.md
```

- [ ] **Step 2: Render YAML frontmatter plus Markdown body**

Each object file must look like:

```md
---
id: MOD-ORDER
type: MOD
status: fact
evidence_primary:
  - evidence://module/MS-001
decision_points:
  - modification_scope
---

# MOD-ORDER

## Claim
...

## Evidence
...

## Decision Use
...
```

- [ ] **Step 3: Add object-type specific sections**

Render sections:

```text
CAP: Goal, Success Criteria, Non Goals
FLOW: Ordered Steps, Failure Branches, Compensation
CON: Contract Subject, Field Semantics, Validation Rules
MOD: Responsibility, Touch When, Do Not Touch When, Test Anchors
VER: Verification Goal, Acceptance Oracle, Test Anchors
OPEN: Unknown, Blocked Decisions, Minimal Next Evidence
TERM: Definition, Aliases, Not Equal To
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 5: Generate real docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 6: Read generated Markdown**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

Then read:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\validation\*.md
```

Expected: docs are Markdown, not YAML-only content.

## Task 6: Evaluate Generated Docs Against AI Usefulness

**Files:**

- Modify code only after reading docs and identifying a concrete defect.

- [ ] **Step 1: Check capability page**

Read:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\*.md
```

The page passes only if it contains:

```text
Requirement Intent: references CAP object
Current Behavior: references FLOW or CON object
Contracts: references CON when available, or OPEN if missing
Code Anchors: references MOD object
Validation: references VER object or validation OPEN
Unknowns and Escalation: references OPEN objects when evidence is missing
```

- [ ] **Step 2: Check MOD object**

Read:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
```

Reject the output if it contains generic template guidance:

```text
Adding new functionality that aligns with
Modifying existing behavior within
Fixing bugs in
Cross-cutting infrastructure changes
Authentication/authorization logic changes
```

If rejected, modify evidence/prompt/repair so LLM emits concrete guidance or an `OPEN`.

- [ ] **Step 3: Check VER object**

Read:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\validation\*.md
```

Reject the output if acceptance oracle only says to run tests without business observable outcomes.

- [ ] **Step 4: Check FLOW or CON object**

Read existing generated files:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\flows\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\contracts\*.md
```

Reject the output if it only summarizes method names, DTO names, mapper names, or SQL without business meaning.

- [ ] **Step 5: Modify code based on the first rejected document**

Use this mapping:

```text
Generic MOD guidance -> improve module evidence extraction and MOD repair prompt.
Weak VER oracle -> improve validation anchor extraction and VER prompt.
Technical FLOW -> improve behavior slice evidence and FLOW prompt.
Technical CON -> improve data contract field semantics prompt.
Missing OPEN -> lower unsupported evidence into OPEN object generation.
Capability page lacks object refs -> fix capability view renderer.
```

After modification, rerun build and real generation.

## Task 7: Final Real Documentation Acceptance

**Files:**

- No source edits in this task unless final document review fails.

- [ ] **Step 1: Compile safety**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 2: Generate final real docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 3: Confirm required Markdown files**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

Expected:

```text
views/capabilities/*.md
objects/capabilities/*.md
objects/modules/*.md
objects/validation/*.md
objects/flows/*.md or objects/contracts/*.md
```

- [ ] **Step 4: Confirm report metadata**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\reports\generation.json
```

Expected:

```text
knowledge = capability
target.kind = capability
target.value = order
llmRuntime = langgraph
llmCalled = true
llmSucceeded = true
```

- [ ] **Step 5: Read final docs and write review summary**

Read generated Markdown docs and produce this summary for the user:

```text
Generated capability view:
Generated object counts by type:
CAP quality:
FLOW/CON quality:
MOD touch guidance quality:
VER oracle quality:
OPEN escalation quality:
Generic/template leakage:
Technical-summary leakage:
Can an AI use this to plan a change:
Remaining gaps:
```

Acceptance requires:

```text
Generic/template leakage: none
Technical-summary leakage: none or explicitly isolated as evidence
Can an AI use this to plan a change: yes
```

## Task 8: Optional Second Real Capability Check

**Files:**

- No source edits unless this second capability exposes a document defect.

- [ ] **Step 1: Generate another real capability**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target course --out D:\tmp\music-education-app-capability-course-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

- [ ] **Step 2: Read generated Markdown**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-course-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
Get-Content D:\tmp\music-education-app-capability-course-doc-review\bootstrap-knowledge\views\capabilities\*.md
```

Expected: the same quality bar holds for a second target.

## Delivery Notes For Claude Code

When reporting completion, include only evidence from real generated docs:

```text
Real command:
Generated docs path:
Capability view file:
Object files:
Report file:
Doc review result:
Remaining gaps:
```

Do not report newly added unit tests. Do not use mock output as proof.
