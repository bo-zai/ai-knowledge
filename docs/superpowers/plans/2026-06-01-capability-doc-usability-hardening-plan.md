# Capability Doc Usability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not add or modify unit test code. Every verification step must use real generated Markdown documents from `D:\workspace\other_project\music-education-app`.

**Goal:** Make the real generated `order` capability Markdown docs usable for AI demand clarification, change planning, and validation planning.

**Architecture:** Fix the capability pipeline through evidence scoping, LLM claim generation, object assembly, and Markdown rendering. Use compile checks for safety, but use real generated Markdown docs as the only acceptance signal.

**Tech Stack:** TypeScript, LangGraph LLM claims provider, existing capability discovery/evidence builder, Markdown object writer with YAML frontmatter.

---

## Hard Rules

- Do not add unit test code.
- Do not add integration test code.
- Do not use mock LLM output as proof.
- Do not report `npm test` as completion evidence.
- Do run `npm run typecheck` and `npm run build` after code edits.
- Do run the real `music-education-app` generation command after each meaningful fix.
- Do inspect generated Markdown with `Get-Content`.
- Fix code based on Markdown defects.

## Current Real Document Defects

Current generated docs root:

```text
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge
```

Observed defects:

- `views/capabilities/CAP-ORDER-CAPABILITY.md` has `## Validation` with `(none)`.
- No `objects/validation/VER-*.md` exists.
- `OPEN-N-DB.md` and `OPEN-N-API.md` use `status: fact`.
- `TERM-ORDER.md` is skeleton output with `Definition: order`.
- `MOD` docs contain some generic boundary statements.
- `debug/capability-llm-request.json` contains broad unrelated evidence, including many low-relevance entries and 1600+ contract refs.

## Files To Modify

- `src/evidence/capability-evidence-builder.ts`
  - Narrow evidence bundle to high-relevance target evidence.
  - Preserve validation anchors and test anchors when available.

- `src/generation/capability-claim-generator.ts`
  - Strengthen prompt requirements for `VER`, `OPEN`, `TERM`, and evidence-grounded `MOD`.
  - Remove examples that encourage generic module boundary text.

- `src/knowledge/capability-knowledge-pipeline.ts`
  - Require `VER` or validation-specific `OPEN`.
  - Stop counting unrelated DB/API `OPEN` as validation readiness.
  - Prevent skeleton `TERM` from entering stable output when it has no real definition.

- `src/knowledge/capability-object-assembler.ts`
  - Set `OPEN` status to `open-question`.
  - Preserve `notEqualTo`, `businessDefinition`, `minimalNextEvidence`, `ownerToAsk`, `escalationGate`.
  - Ensure validation OPEN objects can be distinguished from boundary OPEN objects.

- `src/packaging/capability-knowledge-writer.ts`
  - Render clearer Markdown sections for `TERM`, `VER`, and `OPEN`.
  - Ensure capability view `Validation` references `VER` or validation `OPEN`.

- `src/packaging/knowledge-package-writer.ts`
  - Keep `.md` paths in `catalog.yaml`.

Do not modify files under `tests/`.

## Task 1: Baseline Read Only Verification

**Files:**

- No source edits.

- [ ] **Step 1: List generated Markdown docs**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

Expected current observation:

```text
views/capabilities/CAP-ORDER-CAPABILITY.md
objects/capabilities/CAP-ORDER-CAPABILITY.md
objects/flows/FLOW-ORDER-CREATION-FLOW.md
objects/contracts/CON-ORDER-SUBMISSION-REQUEST-PAYLOAD.md
objects/modules/*.md
objects/terms/TERM-ORDER.md
objects/open/OPEN-N-DB.md
objects/open/OPEN-N-API.md
```

- [ ] **Step 2: Read capability view**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\CAP-ORDER-CAPABILITY.md
```

Expected current defect:

```text
## Validation
- (none)
```

- [ ] **Step 3: Read TERM and OPEN objects**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\terms\TERM-ORDER.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\open\*.md
```

Expected current defects:

```text
TERM has Source: skeleton and Definition: order
OPEN has status: fact
OPEN minimal next evidence repeats the missing evidence statement
```

- [ ] **Step 4: Read MOD objects**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
```

Expected current observation:

```text
MOD paths are useful.
Some doNotTouchWhen entries are generic and not clearly evidence-grounded.
```

## Task 2: Fix Validation Readiness Semantics

**Files:**

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Require VER or validation-specific OPEN**

In `src/knowledge/capability-knowledge-pipeline.ts`, change final readiness logic so `verOrValidationOpenPresent` only passes when:

```ts
const verHasOracle = objects.some(o =>
  o.type === 'VER' &&
  hasNonEmptyArrayMetadata(o, 'acceptanceOracle') &&
  typeof o.metadata.verificationGoal === 'string' &&
  o.metadata.verificationGoal.length > 0,
);

const validationOpenPresent = objects.some(o =>
  o.type === 'OPEN' &&
  String(o.metadata.openKind ?? '').includes('validation') &&
  o.blockedDecisions.length > 0 &&
  hasNonEmptyArrayMetadata(o, 'minimalNextEvidence'),
);

const verOrValidationOpenPresent = verHasOracle || validationOpenPresent;
```

Do not count DB ownership OPEN or API boundary OPEN as validation readiness.

- [ ] **Step 2: Ensure missing validation creates validation OPEN**

When no accepted LLM `VER` exists and no validation anchor exists, create an `OPEN` claim/object with:

```text
id prefix: OPEN-ORDER-VALIDATION
unknown: No executable validation anchor was found for order creation.
blocked decision: Cannot claim implementation is ready without validation path.
minimal next evidence:
- Inspect src/test for OrderController or OrderService tests.
- Manually exercise order submit path against a test database if tests are absent.
metadata.openKind = validation
```

This must be generated from pipeline evidence as an explicit `OPEN`, not silently pass validation.

- [ ] **Step 3: Render validation section with object refs**

In `src/packaging/capability-knowledge-writer.ts`, ensure `buildCapabilityView` renders:

```md
## Validation
- VER-...: ...
```

or:

```md
## Validation
- OPEN-ORDER-VALIDATION: No executable validation anchor was found for order creation.
```

It must never render `(none)` for a generated capability.

- [ ] **Step 4: Compile**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Generate real docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 6: Read validation docs**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\*.md
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\validation -Filter *.md
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\open -Filter *.md
```

Pass condition:

```text
Validation section is not (none).
Either VER exists or validation OPEN exists.
```

## Task 3: Fix OPEN Object Semantics

**Files:**

- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Set OPEN status correctly**

In OPEN object assembly, set:

```ts
status: 'open-question'
```

If the current `KnowledgeObject` type does not expose `status`, add it without changing other object types.

- [ ] **Step 2: Preserve actionable OPEN metadata**

Ensure OPEN metadata includes:

```ts
minimalNextEvidence: string[];
ownerToAsk?: string;
escalationGate?: string;
openKind?: 'validation' | 'boundary' | 'ownership' | 'contract' | 'evidence';
```

- [ ] **Step 3: Render OPEN Markdown sections**

Render OPEN docs as:

```md
## Unknown

## Blocked Decisions

## Minimal Next Evidence

## Escalation
```

Do not render OPEN as if it were a fact.

- [ ] **Step 4: Compile**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Generate and read OPEN docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\open\*.md
```

Pass condition:

```text
Every OPEN has status: open-question.
Every OPEN has blocked decisions.
Every OPEN has specific minimal next evidence.
```

## Task 4: Fix TERM Quality

**Files:**

- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Strengthen TERM prompt**

In `buildCapabilityClaimPrompt`, require TERM claims to include:

```text
canonicalTerm
businessDefinition
notEqualTo
aliases when evidence supports them
counterexample or ambiguity note when relevant
```

Reject this pattern in prompt:

```text
"order is a business term evidenced within Order capability"
```

- [ ] **Step 2: Reject skeleton-only weak TERM**

In final claim merge or object assembly, do not include skeleton `TERM` when:

```ts
source === 'skeleton' &&
(!businessDefinition || businessDefinition === canonicalTerm)
```

If no good TERM exists, prefer no TERM over misleading skeleton TERM.

- [ ] **Step 3: Render TERM details**

In Markdown writer, TERM must render:

```md
## Definition
## Aliases
## Not Equal To
## Decision Use
```

- [ ] **Step 4: Compile**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Generate and read TERM**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\terms\*.md
```

Pass condition:

```text
No TERM doc says Definition: order.
No TERM doc has Source: skeleton unless it contains a real business definition and not-equal-to guidance.
```

## Task 5: Narrow Capability Evidence Scope

**Files:**

- Modify: `src/evidence/capability-evidence-builder.ts`
- Modify: `src/generation/capability-claim-generator.ts`

- [ ] **Step 1: Limit low-relevance entries**

In evidence bundle construction, include only:

```text
targetRelevance >= 0.5
```

for entry points, behavior slices, contracts, modules, and validations unless needed as negative evidence.

For `order`, expected high-relevance files include:

```text
OrderController.java
OrderService.java
OrderGoodsService.java
GoodsCheckContext.java
CouponVerifyService.java
payment-related OrderController methods
order DTO/entity contracts
order mapper contracts
```

Do not include broad unrelated controllers like `BannerController`, `PetController`, `TeachController` in the prompt.

- [ ] **Step 2: Cap contract evidence count**

Sort contracts by:

```text
targetRelevance desc
matchedTerms count desc
path/name proximity to target desc
```

Keep a bounded number, for example:

```text
max 80 contracts for one capability prompt
```

If more evidence exists, summarize overflow into debug but do not put it in the LLM prompt.

- [ ] **Step 3: Keep validation anchors**

Do not filter out `src/test` evidence if it is related to order, controller, service, submit, pay, status, coupon, address, or goods.

- [ ] **Step 4: Compile**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Generate and inspect LLM request**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\debug\capability-llm-request.json
```

Pass condition:

```text
Prompt no longer contains broad unrelated low-relevance controllers.
Prompt evidence is focused enough for a human to see order-related context.
```

## Task 6: Fix MOD Boundary Quality

**Files:**

- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Add prompt rule for evidence-grounded boundaries**

Require:

```text
touchWhen and doNotTouchWhen must be specific to cited module evidence.
Generic architecture advice is rejected.
If module boundary cannot be proven, create OPEN with openKind=boundary.
```

- [ ] **Step 2: Reject known generic boundary statements**

During claim filtering, reject or downgrade MOD hints containing unsupported generic phrases:

```text
Database schema changes (handled by mapper layer)
Authentication logic changes (handled by security module)
Authentication/authorization logic
Cross-cutting infrastructure changes
```

If all MOD guidance is rejected, produce `OPEN-MODULE-BOUNDARY-*`.

- [ ] **Step 3: Compile**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 4: Generate and read MOD docs**

Run:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
```

Pass condition:

```text
MOD touchWhen/doNotTouchWhen are specific to OrderController or OrderService evidence.
Unsupported generic boundary statements are absent or represented as OPEN.
```

## Task 7: Final Real Markdown Review

**Files:**

- No source edits unless the review fails.

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

- [ ] **Step 3: List final Markdown docs**

Run:

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

Required:

```text
views/capabilities/*.md
objects/capabilities/*.md
objects/flows/*.md or objects/contracts/*.md
objects/modules/*.md
objects/validation/*.md or validation OPEN under objects/open/*.md
```

- [ ] **Step 4: Read final docs**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\flows\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\contracts\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\validation\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\open\*.md
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\terms\*.md
```

If a glob has no files, record that as a review finding unless a valid substitute exists.

- [ ] **Step 5: Read final report**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\reports\generation.json
```

Required:

```text
knowledge: capability
target.kind: capability
target.value: order
llmRuntime: langgraph
llmCalled: true
llmSucceeded: true
```

- [ ] **Step 6: Produce final review summary**

Report:

```text
Real command:
Generated docs root:
Capability view:
Object files by type:
Validation section:
VER or validation OPEN:
TERM quality:
MOD boundary quality:
OPEN status and next evidence:
Evidence scope quality:
Can AI plan a change from these docs:
Remaining gaps:
```

Pass condition:

```text
Validation section is not empty.
VER exists or validation OPEN exists.
No OPEN has status: fact.
TERM is not skeleton-only.
MOD boundaries are not generic unsupported templates.
Evidence prompt is focused on order.
AI can form a credible change plan and validation plan.
```

## Notes For Implementer

This plan intentionally does not ask for tests. If a code change feels risky, use real generated docs to validate behavior, not a new test file. Existing tests may be run for safety if desired, but they are not acceptance evidence for this task.
