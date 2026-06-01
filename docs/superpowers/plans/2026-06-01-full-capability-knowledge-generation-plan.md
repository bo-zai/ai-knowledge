# Full Capability Knowledge Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full business capability knowledge generation for real repositories, starting with `D:\workspace\other_project\music-education-app`.

**Architecture:** Add a full capability mode that builds a capability inventory before LLM generation. The inventory groups code entries into Domain -> Capability -> Scenario -> Entry -> Code Anchor, applies scoring/merge/budget rules, then runs the existing single-capability evidence and LLM pipeline per retained capability, followed by global object/catalog assembly.

**Tech Stack:** TypeScript, Node.js CLI, existing LadybugDB graph/index, Java/Spring/MyBatis source scanning, existing OpenAI-compatible LLM provider, Markdown/YAML packaging.

---

## Mandatory Verification Policy

Do not write unit test code for this work.

Every verification checkpoint must run against:

```text
D:\workspace\other_project\music-education-app
```

The primary validation is real generated Markdown usability:

```powershell
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-full-capability-knowledge --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

After each implementation slice, inspect real output under:

```text
D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge
```

The implementation is not accepted because code compiles. It is accepted only when the generated Markdown lets an Agent understand real business capabilities, route to relevant objects, identify change surfaces, and plan validation.

## File Structure

Modify:

- `src/cli/generate.ts`
  - Route capability generation based on whether `scope.target` exists.
- `src/knowledge/generate-orchestrator.ts`
  - Keep current stage routing; full vs single is decided inside capability generation from target presence.
- `src/knowledge/generate-scope.ts`
  - Keep existing target semantics stable.
- `src/knowledge/capability-knowledge-pipeline.ts`
  - Keep existing single pipeline.
  - Export reusable `runSingleCapabilityGeneration` helper if needed.
- `src/knowledge/full-capability-knowledge-pipeline.ts`
  - New multi-capability orchestration.
- `src/slicing/capability-inventory-schema.ts`
  - New inventory, candidate, scenario, entry, score, budget types.
- `src/slicing/capability-inventory.ts`
  - New inventory discovery, grouping, scoring, merging, budgeting.
- `src/evidence/capability-evidence-builder.ts`
  - Accept inventory candidate as evidence source or add adapter.
- `src/packaging/full-capability-package-writer.ts`
  - New full catalog, maps, reports, global dedupe packaging.
- `src/packaging/knowledge-package-writer.ts`
  - Preserve full capability catalog data instead of flattening it away.
- `src/generation/capability-claim-generator.ts`
  - Extend prompt/schema with scenarios, validation assertions, confidence/risk usage policy if required.
- `README.md`
  - Document full capability command.

Create:

- `src/knowledge/full-capability-knowledge-pipeline.ts`
- `src/slicing/capability-inventory-schema.ts`
- `src/slicing/capability-inventory.ts`
- `src/packaging/full-capability-package-writer.ts`

Do not create unit test files.

## Task 1: Clarify Capability Scope Routing

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/knowledge/generate-orchestrator.ts`

- [ ] **Step 1: Keep command surface unchanged**

Do not add a new CLI option.

Use existing semantics:

```text
--knowledge capability                         => full capability generation
--knowledge capability --target capability:x   => single capability generation
--terms / --paths                              => legacy single capability filters
```

- [ ] **Step 2: Add explicit scope decision in generate.ts**

In `src/cli/generate.ts`, inside `runCapability`, derive:

```ts
const capabilityScope =
  input.scope.target?.kind === 'capability' || targetTerms.length > 0 || targetPaths.length > 0
    ? 'single'
    : 'full';
```

Use `capabilityScope` to branch between existing single pipeline and the new full pipeline.

- [ ] **Step 3: Keep orchestration unchanged**

Do not add `capabilityMode` to `GenerateOrchestrationInput`.

`runGenerateOrchestration` should continue to decide only whether the capability stage runs. The capability stage itself decides full vs single from `scope.target` and legacy filters.

- [ ] **Step 4: Build and smoke command**

Run:

```powershell
npm run build
```

Expected:

```text
success
```

No unit tests.

## Task 2: Define Capability Inventory Types

**Files:**
- Create: `src/slicing/capability-inventory-schema.ts`

- [ ] **Step 1: Create schema file**

Create `src/slicing/capability-inventory-schema.ts` with these exported types:

```ts
export interface CapabilityGenerationBudget {
  maxCapabilities: number;
  maxObjectsPerCapability: number;
  maxTotalObjects: number;
  minCapabilityScore: number;
  mergeIfSharedModulesAbove: number;
  mergeIfSharedTermsAbove: number;
}

export interface BusinessDomain {
  id: string;
  name: string;
  rootPaths: string[];
  terms: string[];
}

export interface CapabilityScenario {
  id: string;
  name: string;
  summary: string;
  entryIds: string[];
}

export interface CapabilityEntry {
  id: string;
  kind: 'http' | 'service' | 'job' | 'handler' | 'callback';
  route?: string;
  method?: string;
  symbol: string;
  path: string;
  startLine?: number;
}

export interface CapabilityCodeAnchor {
  kind: 'controller' | 'service' | 'mapper' | 'entity' | 'config' | 'external_doc';
  symbol: string;
  path: string;
  startLine?: number;
}

export interface CapabilityScore {
  requirementLikelihood: number;
  businessSemantics: number;
  changeSurfaceSize: number;
  riskLevel: number;
  validationValue: number;
  ambiguityRisk: number;
  total: number;
}

export interface CapabilityInventoryCandidate {
  candidateId: string;
  domain: string;
  capabilityName: string;
  capabilitySlug: string;
  summaryHint: string;
  scenarios: CapabilityScenario[];
  entries: CapabilityEntry[];
  codeAnchors: CapabilityCodeAnchor[];
  relatedTerms: string[];
  relatedTables: string[];
  relatedExternalSystems: string[];
  score: CapabilityScore;
  mergeKeys: string[];
  risks: string[];
  missingSignals: string[];
}

export interface RejectedCapabilityCandidate {
  candidateId: string;
  reason: string;
  mergedInto?: string;
  score?: CapabilityScore;
}

export interface CapabilityInventory {
  repoRoot: string;
  generatedAt: string;
  domains: BusinessDomain[];
  candidates: CapabilityInventoryCandidate[];
  rejectedCandidates: RejectedCapabilityCandidate[];
  budget: CapabilityGenerationBudget;
}

export const DEFAULT_CAPABILITY_BUDGET: CapabilityGenerationBudget = {
  maxCapabilities: 30,
  maxObjectsPerCapability: 8,
  maxTotalObjects: 180,
  minCapabilityScore: 0.65,
  mergeIfSharedModulesAbove: 0.60,
  mergeIfSharedTermsAbove: 0.70,
};
```

- [ ] **Step 2: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 3: Implement Inventory Discovery

**Files:**
- Create: `src/slicing/capability-inventory.ts`

- [ ] **Step 1: Implement route and domain scan**

Create `discoverCapabilityInventory(input)` that scans Java controllers under:

```text
src/main/java/com/education/music/app/controller
```

For each controller:

- detect class name
- detect class-level `@RequestMapping`
- detect method mappings
- create `CapabilityEntry`

Domain mapping rules for first version:

```ts
const DOMAIN_RULES = [
  { id: 'mall', name: '商城', prefixes: ['/goods', '/cart', '/order', '/coupon', '/address', '/member', '/region'] },
  { id: 'teach', name: '教学', prefixes: ['/teach', '/noLogin/teach', '/teacher', '/student', '/class', '/courseTemplate', '/record'] },
  { id: 'user', name: '用户', prefixes: ['/user', '/getUserSign', '/getUserRelate'] },
  { id: 'pet', name: '宠物', prefixes: ['/pet'] },
  { id: 'external', name: '外部系统', prefixes: ['/alipay', '/wxPay', '/payUnk', '/ali/oss'] },
  { id: 'common', name: '通用', prefixes: ['/upload', '/banner', '/news', '/health'] },
];
```

- [ ] **Step 2: Group entries into candidate capabilities**

Use route prefix and controller class to group:

```text
/goods/list, /goods/getDetail, /goods/getRecommendGoods -> goods-browse-search
/goods/exchange -> goods-exchange
/cart/* -> cart-management
/order/submit, /order/getOrderSn -> order-create
/aipay/*, /wxPay/*, /pcPay, /payUnk/* -> order-payment
/order/refund* -> order-refund
/teach/* and /noLogin/teach/* -> teach-content-browse
/record/add, /record/update, /record/getMine -> record-submission
/record/grade*, /teacher/score* -> record-grading
```

Fallback:

```ts
<domain>-<controller-base-name>
```

but reject thin health/index/ffmpeg test endpoints unless high risk or external.

- [ ] **Step 3: Score and reject low-value candidates**

Compute `CapabilityScore.total` as weighted sum:

```text
requirementLikelihood 20%
businessSemantics     25%
changeSurfaceSize     20%
riskLevel             15%
validationValue       10%
ambiguityRisk         10%
```

Hard boosts:

- order/payment/refund/pay/callback: high risk.
- cart/order/goods/teach/record/user: high requirement likelihood.
- routes with more than one entry and service anchor: higher change surface.

Reject:

- total < budget.minCapabilityScore
- health/index/test route
- single thin CRUD endpoint with no business risk

- [ ] **Step 4: Build real inventory report**

Run build:

```powershell
npm run build
```

Then run full command after Task 4 wires it. Until then, inspect compile only.

## Task 4: Add Full Capability Pipeline

**Files:**
- Create: `src/knowledge/full-capability-knowledge-pipeline.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/cli/generate.ts`

- [ ] **Step 1: Expose single-candidate generation helper**

Refactor `runCapabilityKnowledgePipeline` so the inner logic after candidate selection can be reused:

```ts
export async function runCapabilityKnowledgeForCandidate(input: {
  repoRoot: string;
  candidate: CapabilityCandidate;
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  llmMode?: CapabilityLlmMode;
}): Promise<RunCapabilityKnowledgePipelineResult>
```

Keep `runCapabilityKnowledgePipeline` behavior unchanged for single mode.

- [ ] **Step 2: Adapt inventory candidate to CapabilityCandidate**

In `full-capability-knowledge-pipeline.ts`, create:

```ts
function inventoryCandidateToCapabilityCandidate(candidate: CapabilityInventoryCandidate): CapabilityCandidate
```

Mapping:

- `candidateId` remains stable.
- `nameCandidates` uses capabilityName.
- `summaryHint` uses summaryHint.
- `primaryEntryPoints` from entries.
- `moduleClusters` from codeAnchors grouped by path role.
- `relatedTerms`, `risks`, `missingSignals` copied.
- confidence from score.total.

- [ ] **Step 3: Run multiple candidates with failure isolation**

Implement:

```ts
export async function runFullCapabilityKnowledgePipeline(input: {
  repoRoot: string;
  targetPaths?: string[];
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  llmMode?: CapabilityLlmMode;
}): Promise<FullCapabilityKnowledgeResult>
```

Behavior:

- discover inventory
- iterate retained candidates
- run single-candidate helper
- collect successes and failures
- continue when one candidate fails
- enforce `maxCapabilities`

- [ ] **Step 4: Wire mode in generate.ts**

In `runCapability`, branch:

```ts
if (capabilityScope === 'full') {
  return runFullCapabilityKnowledgePipeline(...);
}
return runCapabilityKnowledgePipeline(...);
```

Return a `KnowledgePackageContribution` with full mode details.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 5: Package Full Knowledge Output

**Files:**
- Create: `src/packaging/full-capability-package-writer.ts`
- Modify: `src/packaging/knowledge-package-writer.ts`

- [ ] **Step 1: Build maps**

Generate:

```text
maps/repo-map.md
maps/module-map.yaml
maps/entrypoints.yaml
```

Minimum contents:

- domains
- retained capabilities
- route -> capability mapping
- route -> handler path
- capability -> objects

- [ ] **Step 2: Build full catalog**

Full catalog must include:

```yaml
version: 1
generation:
  knowledge: capability
  capability_scope: full
budget:
domains:
capabilities:
activation:
objects:
maps:
unknown_escalation_rules:
reports:
```

Activation requirements:

- `term_match` from related terms
- `path_match` from code anchors and object paths
- `route_match` from entries

- [ ] **Step 3: Global object dedupe**

Deduplicate by stable object ID.

Rules:

- if duplicate object ID has identical description, keep one.
- if duplicate ID differs, keep highest evidence count and add warning.
- capability views should reference reused objects.

- [ ] **Step 4: Preserve full catalog**

Update `writeKnowledgePackage` so full capability contributions can provide a complete catalog without being flattened into the current minimal catalog.

Implement contribution metadata:

```ts
catalogOverride?: Record<string, unknown>
```

or a file path convention:

```text
catalog.yaml
```

that is not skipped for full mode.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 6: Improve Claim Prompt For Real Markdown Usability

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Extend object hints**

Add optional fields:

```ts
scenarios
entries
dbAssertions
apiAssertions
commands
cannotVerifyWithout
riskIfWrong
usagePolicy
machineStaleIf
```

- [ ] **Step 2: Prompt LLM to avoid per-interface capability**

Add hard rule:

```text
CAP is a business demand attribution unit, not a Controller method, Service method, Mapper SQL, or API endpoint.
If a route is only a scenario under the current capability, describe it as FLOW/CON/MOD evidence, not a new CAP.
```

- [ ] **Step 3: Render Markdown with usability sections**

Capability view sections:

```text
Purpose
Requirement Intent
Scenarios And Entries
Current Behavior
Contracts And Data
Code Anchors
Validation
Unknowns And Escalation
Knowledge Refs
```

VER object sections:

```text
Verification Goal
Required Checks
Commands
DB Assertions
API Assertions
Acceptance Oracle
Cannot Verify Without
```

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 7: Real Project Validation Round 1

**Files:**
- No source edits in this task unless generated Markdown fails usability review.

- [ ] **Step 1: Run real full generation**

Run:

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-full-capability-knowledge --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- command completes
- output exists at `D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge`
- more than 5 capability views generated
- no more than 30 capability views generated

- [ ] **Step 2: Inspect generated capability count**

Run:

```powershell
Get-ChildItem D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\views\capabilities -Filter *.md | Select-Object Name
```

Expected:

- includes goods/cart/order/teach/record/user or similar business capabilities
- does not list one Markdown per Controller method

- [ ] **Step 3: Inspect catalog**

Run:

```powershell
Get-Content D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\catalog.yaml
```

Expected catalog includes:

- `capability_scope: full`
- `domains`
- `capabilities`
- `activation`
- `maps`
- `objects`

- [ ] **Step 4: Inspect inventory report**

Run:

```powershell
Get-Content D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\reports\capability-inventory.json
```

Expected report explains:

- retained candidates
- rejected candidates
- merged candidates
- budget

## Task 8: Real Markdown Usability Review And Fix Loop

**Files:**
- Modify source files based on Markdown failures found in this task.

- [ ] **Step 1: Review 商品浏览与搜索**

Open the generated goods capability Markdown.

It must answer:

- What does the capability do?
- Which routes trigger it?
- Is search history a scenario/flow or independent capability?
- Which files are code anchors?
- How to validate search history write behavior?
- What is unknown and must be asked?

If it cannot answer these, update discovery/evidence/rendering and rerun generation.

- [ ] **Step 2: Review 购物车管理**

Open generated cart capability Markdown.

It must answer:

- cart add/update/delete/check/checkout scenarios
- relevant Controller/Service/Mapper anchors
- data side effects
- validation oracle

If it is only a method list, update grouping and prompt.

- [ ] **Step 3: Review 订单支付**

Open generated order payment Markdown.

It must answer:

- payment routes and callback routes
- external systems involved
- source of truth gaps
- failure and callback unknowns
- verification requirements

If external system semantics are missing, update evidence collection for docs/config/callback routes.

- [ ] **Step 4: Review 教学内容浏览**

Open generated teach capability Markdown.

It must answer:

- no-login and logged-in teach routes
- course/category/content relationship
- code anchors
- validation oracle or cannot_verify_without

- [ ] **Step 5: Review 录音提交或评分**

Open generated record capability Markdown.

It must answer:

- record add/update/grade scenarios
- media/FFmpeg/storage dependencies if evidenced
- side effects and validation
- unknowns

- [ ] **Step 6: Record failures and modify code**

For each Markdown failure, identify exact layer:

```text
inventory grouping
candidate scoring
evidence bundle
LLM prompt/schema
object assembler
renderer/catalog
```

Modify the corresponding source file, rebuild, and rerun the real generation command.

No unit tests.

## Task 9: Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `notes/wiki-agent-knowledge/design/business-capability-knowledge-standard-template.md` if implementation reveals better final contract.

- [ ] **Step 1: Document command**

Add:

```bash
rkg generate <repo> --knowledge capability
```

Explain that `--knowledge capability` without `--target` discovers business capabilities and applies budget/merge rules. `--target capability:<name>` keeps single capability generation.

- [ ] **Step 2: Document validation policy**

Add:

```text
Capability knowledge quality is validated by running generation against a real target repository and inspecting generated Markdown usability.
```

- [ ] **Step 3: Final real validation**

Run:

```powershell
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-full-capability-knowledge --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- build succeeds
- generation succeeds
- generated Markdown passes the five-capability usability review

## Self-Review Checklist

- The plan implements full capability scope using existing `--knowledge capability` and `--target` semantics.
- The plan does not create unit test files.
- Every verification step uses the real `music-education-app` project.
- The plan prevents one CAP per Controller method.
- The plan includes inventory, scoring, merge, budget, multi-capability generation, maps, catalog, and Markdown usability review.
- The final acceptance depends on generated Markdown usefulness, not just build success.
