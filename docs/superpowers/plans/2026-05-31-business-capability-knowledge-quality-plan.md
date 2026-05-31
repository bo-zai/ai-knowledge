# Business Capability Knowledge Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `generate-capability` produce useful AI-facing business capability knowledge for one real business capability, not just runnable skeleton-backed files.

**Architecture:** Keep the current discovery -> evidence bundle -> LangGraph LLM claims -> pipeline -> assembler -> writer flow. Enrich `CandidateClaim` hints, preserve LLM/skeleton source metadata, tighten success gates, and improve object assembly for `CAP/TERM/FLOW/CON/MOD/VER/OPEN`.

**Tech Stack:** TypeScript strict mode, Zod, LangGraph, existing model config, Vitest, real validation on `D:\workspace\other_project\music-education-app`.

---

## Requirements

- Do not use `git worktree`.
- Keep business logic out of `src/cli/`.
- Keep file writes in `src/packaging/`.
- Do not let the LLM decide object IDs, object paths, catalog paths, or package layout.
- Do not let the LLM read the whole repository.
- Do not implement full `SYS` / `OWN` / `INV` / `STATE` / `DEC` in this round.
- The first landed target object set is `CAP`, `TERM`, `FLOW`, `CON`, `MOD`, `VER`, `OPEN`.
- Real validation must run against `D:\workspace\other_project\music-education-app`.

## File Map

- Modify: `src/generation/capability-claim-generator.ts`
  - Enrich `CandidateClaimSchema.objectHints`.
  - Add claim source type.
  - Strengthen prompt with business object rules and rejected examples.
  - Add quality helper functions for technical term detection and skeleton phrase detection.
- Modify: `src/knowledge/capability-object-assembler.ts`
  - Preserve `metadata.source`.
  - Assemble enriched business metadata for each supported object type.
  - Reject or avoid low-quality business objects.
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
  - Require LLM `CAP`.
  - Require LLM `FLOW` or `CON`.
  - Add required business object quality gates.
  - Add report metadata.
- Modify: `src/packaging/capability-knowledge-writer.ts`
  - Extend report type.
  - Update capability view sections.
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`
- Modify: `tests/unit/knowledge/capability-object-assembler.test.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Enrich Candidate Claim Schema

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add schema tests for enriched hints**

Add a test that parses a claim with business quality hints:

```ts
it('accepts business capability object hints used by the assembler', () => {
  const result = CandidateClaimSchema.safeParse({
    suggestedType: 'FLOW',
    claimText: 'Customer submits an order and the system records ordered goods.',
    confidence: 'high',
    evidenceRefs: ['evidence://behavior/BEH-001'],
    decisionPoints: ['current_behavior'],
    sddStageUses: ['requirement_specification'],
    unsupportedParts: [],
    blockedDecisions: [],
    objectHints: {
      subject: 'Order goods fulfillment',
      orderedSteps: [
        {
          action: 'Validate selected goods before creating the order',
          evidenceRef: 'evidence://behavior/BEH-001',
          note: 'Goods stock check participates in order creation',
        },
      ],
      touchWhen: ['Changing order goods fulfillment behavior'],
      doNotTouchWhen: ['Changing unrelated user profile behavior'],
      verificationGoal: 'Order creation keeps goods line items consistent',
      acceptanceOracle: ['Order detail returns the submitted goods line items'],
      minimalNextEvidence: ['Find an integration test or API contract for order submission'],
    },
  });

  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Extend `CandidateClaimSchema.objectHints`**

Replace the current object hints schema with:

```ts
const ObjectHintSchema = z.object({
  canonicalTerm: z.string().optional(),
  subject: z.string().optional(),
  businessDefinition: z.string().optional(),
  notEqualTo: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  goal: z.string().optional(),
  successCriteria: z.array(z.string()).optional(),
  nonGoals: z.array(z.string()).optional(),
  orderedSteps: z.array(z.object({
    action: z.string(),
    evidenceRef: z.string().optional(),
    note: z.string().optional(),
  })).optional(),
  failureBranches: z.array(z.string()).optional(),
  compensation: z.array(z.string()).optional(),
  modulePath: z.string().optional(),
  ownedResponsibility: z.string().optional(),
  touchWhen: z.array(z.string()).optional(),
  doNotTouchWhen: z.array(z.string()).optional(),
  testAnchors: z.array(z.string()).optional(),
  contractSubject: z.string().optional(),
  contractKind: z.enum(['schema', 'sql', 'api', 'event', 'output']).optional(),
  fieldSemantics: z.record(z.string(), z.string()).optional(),
  validationRules: z.array(z.string()).optional(),
  schemaRef: z.string().optional(),
  verificationGoal: z.string().optional(),
  acceptanceOracle: z.array(z.string()).optional(),
  minimalNextEvidence: z.array(z.string()).optional(),
  ownerToAsk: z.string().optional(),
  escalationGate: z.string().optional(),
  termSource: z.enum(['target_term', 'evidence_match', 'data_contract']).optional(),
  matchedEvidenceCount: z.number().int().nonnegative().optional(),
}).strict();
```

Use it in `CandidateClaimSchema`:

```ts
objectHints: ObjectHintSchema.optional(),
source: z.enum(['llm', 'skeleton', 'evidence_seed']).optional(),
```

- [ ] **Step 3: Mark skeleton claims with source**

Every object returned by `buildSkeletonClaims()` must include:

```ts
source: 'skeleton'
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: all tests pass.

## Task 2: Strengthen Prompt For Business Capability Objects

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add prompt tests**

Add:

```ts
it('instructs the model to produce business capability knowledge, not generic code summaries', () => {
  const prompt = buildCapabilityClaimPrompt(makeEvidenceBundle());

  expect(prompt).toContain('Generate business capability knowledge for AI agents');
  expect(prompt).toContain('TERM is business vocabulary only');
  expect(prompt).toContain('FLOW steps must be business actions');
  expect(prompt).toContain('CON must describe business-relevant contract semantics');
  expect(prompt).toContain('MOD must include touchWhen and doNotTouchWhen');
  expect(prompt).toContain('VER must include verificationGoal and acceptanceOracle');
  expect(prompt).toContain('OPEN must include blockedDecisions and minimalNextEvidence');
  expect(prompt).toContain('Rejected examples');
});
```

- [ ] **Step 2: Add business rules to `buildCapabilityClaimPrompt()`**

Add a section after hard rules:

```ts
lines.push('');
lines.push('BUSINESS OBJECT QUALITY RULES:');
lines.push('- Generate business capability knowledge for AI agents, not generic code summaries.');
lines.push('- TERM is business vocabulary only; reject mybatis, mapper, service, controller, xml, sql, dto, vo, req, resp, entity as standalone terms.');
lines.push('- FLOW steps must be business actions, not raw method names.');
lines.push('- CON must describe business-relevant contract semantics; mapper methods and DTOs are evidence, not the whole contract.');
lines.push('- MOD must include touchWhen and doNotTouchWhen guidance.');
lines.push('- VER must include verificationGoal and acceptanceOracle.');
lines.push('- OPEN must include blockedDecisions and minimalNextEvidence.');
lines.push('- Missing failure semantics, ownership, source of truth, or validation evidence must become OPEN.');
```

Add rejected examples:

```ts
lines.push('');
lines.push('Rejected examples:');
lines.push('- CAP: "X is a discovered business capability supported by repository evidence."');
lines.push('- FLOW: "X has a repository-derived execution flow."');
lines.push('- FLOW: "add add -> find by id"');
lines.push('- CON: "X is a data or schema contract related to Y."');
lines.push('- TERM: "OrderGoodsVO has fields id, goodsName, number."');
```

Update output format to include enriched `objectHints`.

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: all tests pass.

## Task 3: Preserve Object Source And Assemble Business Metadata

**Files:**
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `tests/unit/knowledge/capability-object-assembler.test.ts`

- [ ] **Step 1: Add assembler tests for LLM metadata**

Add a test for `CAP`:

```ts
it('assembles CAP metadata from LLM business hints', () => {
  const objects = assembleCapabilityKnowledgeObjects({
    bundle: makeBundle(),
    claims: [{
      suggestedType: 'CAP',
      claimText: 'Order goods fulfillment lets a customer submit goods as part of an order.',
      confidence: 'high',
      evidenceRefs: ['evidence://entry/EP-001'],
      decisionPoints: ['requirement_intent'],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: [],
      source: 'llm',
      objectHints: {
        canonicalTerm: 'Order goods fulfillment',
        goal: 'Submit goods as part of an order',
        successCriteria: ['Order detail shows submitted goods'],
        nonGoals: ['Changing payment settlement'],
      },
    }],
  });

  const cap = objects.find(object => object.type === 'CAP');
  expect(cap?.metadata.source).toBe('llm');
  expect(cap?.metadata.goal).toBe('Submit goods as part of an order');
  expect(cap?.metadata.successCriteria).toEqual(['Order detail shows submitted goods']);
});
```

Add a test for `MOD`:

```ts
it('assembles MOD touch guidance from LLM hints', () => {
  const objects = assembleCapabilityKnowledgeObjects({
    bundle: makeBundle(),
    claims: [{
      suggestedType: 'MOD',
      claimText: 'Order service owns order goods fulfillment changes.',
      confidence: 'high',
      evidenceRefs: ['evidence://module/MOD-001'],
      decisionPoints: ['change_surface'],
      sddStageUses: ['implementation_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      source: 'llm',
      objectHints: {
        modulePath: 'src/main/java/com/education/music/app/service/mall',
        ownedResponsibility: 'Coordinates order goods fulfillment',
        touchWhen: ['Changing order goods creation or lookup'],
        doNotTouchWhen: ['Changing unrelated course catalog display'],
      },
    }],
  });

  const mod = objects.find(object => object.type === 'MOD');
  expect(mod?.metadata.source).toBe('llm');
  expect(mod?.metadata.touchWhen).toEqual(['Changing order goods creation or lookup']);
  expect(mod?.metadata.doNotTouchWhen).toEqual(['Changing unrelated course catalog display']);
});
```

- [ ] **Step 2: Add source helper**

In `capability-object-assembler.ts`, add:

```ts
function claimSource(claim: CandidateClaim): 'llm' | 'skeleton' | 'evidence_seed' {
  return claim.source ?? 'llm';
}
```

- [ ] **Step 3: Enrich object builders**

Update each builder metadata:

```ts
metadata: {
  source: claimSource(claim),
  ...
}
```

Map hints:

- `CAP`: `goal`, `successCriteria`, `nonGoals`, `canonicalTerm`
- `TERM`: `canonicalTerm`, `businessDefinition`, `aliases`, `notEqualTo`
- `FLOW`: `orderedSteps`, `failureBranches`, `compensation`
- `CON`: `kind`, `subject`, `fieldSemantics`, `validationRules`, `schemaRef`
- `MOD`: `rootPath`, `ownedResponsibility`, `touchWhen`, `doNotTouchWhen`, `testAnchors`
- `VER`: `verificationGoal`, `acceptanceOracle`, `testAnchors`
- `OPEN`: `minimalNextEvidence`, `ownerToAsk`, `escalationGate`

- [ ] **Step 4: Keep fallback metadata for skeleton**

When a skeleton claim lacks enriched hints, keep existing metadata but include:

```ts
source: 'skeleton'
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-object-assembler.test.ts
```

Expected: all tests pass.

## Task 4: Add Quality Gates To Pipeline

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Add tests for required LLM business objects**

Add:

```ts
it('throws when accepted LLM claims do not include CAP', async () => {
  await expect(runCapabilityKnowledgePipeline({
    repoRoot: '.',
    targetTerms: ['order'],
    targetPaths: ['src'],
    claimsProvider: async () => ({
      claims: [{
        suggestedType: 'CON',
        claimText: 'Order goods input includes goods id and quantity.',
        confidence: 'high',
        evidenceRefs: ['evidence://contract/CON-EVID-001'],
        decisionPoints: ['affected_contracts'],
        sddStageUses: ['requirement_specification'],
        unsupportedParts: [],
        blockedDecisions: [],
        source: 'llm',
      }],
    }),
  })).rejects.toThrow(/LLM CAP claim is required/);
});
```

Add:

```ts
it('throws when accepted LLM claims do not include FLOW or CON', async () => {
  await expect(runCapabilityKnowledgePipeline({
    repoRoot: '.',
    targetTerms: ['order'],
    targetPaths: ['src'],
    claimsProvider: async () => ({
      claims: [{
        suggestedType: 'CAP',
        claimText: 'Order goods fulfillment lets a customer submit goods as part of an order.',
        confidence: 'high',
        evidenceRefs: ['evidence://entry/EP-001'],
        decisionPoints: ['requirement_intent'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        source: 'llm',
      }],
    }),
  })).rejects.toThrow(/LLM FLOW or CON claim is required/);
});
```

- [ ] **Step 2: Add skeleton phrase detector**

In `capability-knowledge-pipeline.ts`, add:

```ts
const BAD_DEFAULT_PHRASES = [
  'is a discovered business capability supported by repository evidence',
  'has a repository-derived execution flow',
  'is a data or schema contract related',
];

function hasBadDefaultPhrase(text: string): boolean {
  const normalized = text.toLowerCase();
  return BAD_DEFAULT_PHRASES.some(phrase => normalized.includes(phrase));
}
```

- [ ] **Step 3: Add required claim gate after filtering**

After `filteredProviderClaims`:

```ts
const llmClaims = filteredProviderClaims.filter(claim => (claim.source ?? 'llm') === 'llm');
const hasLlmCap = llmClaims.some(claim => claim.suggestedType === 'CAP' && !hasBadDefaultPhrase(claim.claimText));
const hasLlmFlowOrCon = llmClaims.some(claim =>
  (claim.suggestedType === 'FLOW' || claim.suggestedType === 'CON') &&
  !hasBadDefaultPhrase(claim.claimText),
);

if (!hasLlmCap) {
  throw new Error('LLM generation failed: LLM CAP claim is required for business capability knowledge');
}

if (!hasLlmFlowOrCon) {
  throw new Error('LLM generation failed: LLM FLOW or CON claim is required for business capability knowledge');
}
```

- [ ] **Step 4: Add final object gate**

After objects are assembled:

```ts
const capFromLlm = objects.some(object => object.type === 'CAP' && object.metadata.source === 'llm');
const flowOrConFromLlm = objects.some(object =>
  (object.type === 'FLOW' || object.type === 'CON') && object.metadata.source === 'llm',
);
const modPresent = objects.some(object => object.type === 'MOD');
const verOrValidationOpenPresent = objects.some(object => object.type === 'VER') ||
  objects.some(object =>
    object.type === 'OPEN' &&
    Array.isArray(object.metadata.minimalNextEvidence) &&
    object.metadata.minimalNextEvidence.length > 0,
  );

if (!capFromLlm || !flowOrConFromLlm || !modPresent || !verOrValidationOpenPresent) {
  throw new Error('LLM generation failed: generated capability package is missing required business knowledge objects');
}
```

- [ ] **Step 5: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: all tests pass.

## Task 5: Extend Report With Business Quality Metadata

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Extend report type**

Add to `CapabilityGenerationReport`:

```ts
objectSourceCounts?: {
  llm: number;
  skeleton: number;
  evidence_seed: number;
};
requiredBusinessObjects?: {
  capFromLlm: boolean;
  flowOrConFromLlm: boolean;
  modPresent: boolean;
  verOrValidationOpenPresent: boolean;
};
qualityWarnings?: string[];
```

- [ ] **Step 2: Compute source counts in pipeline**

Add:

```ts
function countObjectSources(objects: KnowledgeObject[]): { llm: number; skeleton: number; evidence_seed: number } {
  const counts = { llm: 0, skeleton: 0, evidence_seed: 0 };
  for (const object of objects) {
    const source = object.metadata.source;
    if (source === 'skeleton') counts.skeleton += 1;
    else if (source === 'evidence_seed') counts.evidence_seed += 1;
    else counts.llm += 1;
  }
  return counts;
}
```

Use it in `report`.

- [ ] **Step 3: Add writer test**

Assert report output contains:

```ts
expect(reportContent).toContain('"objectSourceCounts"');
expect(reportContent).toContain('"requiredBusinessObjects"');
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: all tests pass.

## Task 6: Update Capability Page Structure

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Add page structure test**

Add:

```ts
it('builds capability view using business knowledge sections', () => {
  const content = buildCapabilityView(makeObjects(), 'CAP-ORDER-GOODS');

  expect(content).toContain('## Requirement Intent');
  expect(content).toContain('## Current Behavior');
  expect(content).toContain('## Business Terms');
  expect(content).toContain('## Contracts');
  expect(content).toContain('## Code Anchors');
  expect(content).toContain('## Validation');
  expect(content).toContain('## Unknowns and Escalation');
});
```

- [ ] **Step 2: Update `buildCapabilityView()` sections**

Use this section order:

```md
## Requirement Intent
## Current Behavior
## Business Terms
## Contracts
## Code Anchors
## Validation
## Unknowns and Escalation
```

Each item should include object ID and a short description from the object:

```ts
function objectLine(object: KnowledgeObject): string {
  return `- ${object.id}: ${object.description}`;
}
```

Do not create facts that are not already in objects.

- [ ] **Step 3: Run packaging tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: all tests pass.

## Task 7: Add Integration Test For Successful Mock LLM Generation

**Files:**
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add a fake local LLM server helper**

Use Node `http` in the test file:

```ts
import http from 'node:http';

async function createFakeOpenAiServer(responseContent: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'test-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: responseContent },
        finish_reason: 'stop',
      }],
    }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
```

- [ ] **Step 2: Add success test**

Create a fake response containing LLM `CAP`, `FLOW`, `MOD`, and `OPEN` claims with valid refs for the fixture repo.

Assert:

```ts
expect(result.exitCode).toBe(0);
expect(report.llmRuntime).toBe('langgraph');
expect(report.requiredBusinessObjects.capFromLlm).toBe(true);
expect(report.requiredBusinessObjects.flowOrConFromLlm).toBe(true);
expect(report.objectSourceCounts.llm).toBeGreaterThan(0);
```

Also read generated CAP/MOD/OPEN objects and assert:

```ts
expect(capContent).toContain('source: llm');
expect(modContent).toContain('touchWhen');
expect(modContent).toContain('doNotTouchWhen');
expect(openContent).toContain('minimalNextEvidence');
```

- [ ] **Step 3: Run integration test**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: all tests pass.

## Task 8: Full Verification

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Test**

Run:

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Validation

**Files:**
- No source changes unless validation reveals implementation defects.

- [ ] **Step 1: Run real command**

Run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-business-capability-quality-validation --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

```text
LLM runtime: langgraph
Succeeded: true
```

- [ ] **Step 2: Inspect report**

Run:

```powershell
Get-Content D:\tmp\music-education-app-business-capability-quality-validation\bootstrap-knowledge\reports\capability-generation.json
```

Expected report values:

```json
"llmRuntime": "langgraph"
"llmSucceeded": true
"requiredBusinessObjects": {
  "capFromLlm": true,
  "flowOrConFromLlm": true,
  "modPresent": true,
  "verOrValidationOpenPresent": true
}
```

- [ ] **Step 3: Reject known bad phrases**

Run:

```bash
rg -n "is a discovered business capability supported by repository evidence|has a repository-derived execution flow|is a data or schema contract related|TERM-MYBATIS-MAPPER|service_implementation|data_access_layer|business_logic|persistence_layer" D:\tmp\music-education-app-business-capability-quality-validation\bootstrap-knowledge
```

Expected: no matches.

- [ ] **Step 4: Check business object quality**

Run:

```powershell
$root = "D:\tmp\music-education-app-business-capability-quality-validation\bootstrap-knowledge"
Get-Content "$root\objects\capabilities\*.yaml"
Get-Content "$root\objects\modules\*.yaml"
Get-Content "$root\objects\open\*.yaml"
```

Expected:

- CAP contains `source: llm`.
- MOD contains `touchWhen` and `doNotTouchWhen`.
- OPEN contains `minimalNextEvidence` when validation, ownership, external system, or failure semantics evidence is missing.

- [ ] **Step 5: Verify evidence refs**

Run:

```powershell
$root = "D:\tmp\music-education-app-business-capability-quality-validation\bootstrap-knowledge"
$indexRefs = Get-Content "$root\evidence\index.jsonl" | ForEach-Object { ($_ | ConvertFrom-Json).ref }
$objectRefs = rg --no-filename -o "evidence://[A-Za-z0-9/.-]+" "$root\objects"
$missing = $objectRefs | Where-Object { $_ -notin $indexRefs } | Sort-Object -Unique
if ($missing) { $missing; exit 1 } else { "all evidence refs resolved" }
```

Expected:

```text
all evidence refs resolved
```

## Task 10: Final Response Checklist

**Files:**
- Review only.

- [ ] **Step 1: Check architecture boundaries**

Confirm:

- `src/cli/generate-capability.ts` only resolves command options and config.
- `src/generation` owns prompt and LangGraph LLM generation.
- `src/knowledge` owns pipeline success semantics and object assembly coordination.
- `src/packaging` owns rendering and writing.

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short
```

Expected:

- Source/test/doc files are changed.
- `D:\tmp` output is not in git.
- Root `bootstrap-knowledge/` generated output is not committed unless explicitly requested.

- [ ] **Step 3: Report exact validation result**

Final response must include:

```text
Generated capability:
LLM runtime:
LLM accepted claims:
Skeleton added claims:
CAP source:
FLOW/CON source:
TERM technical leakage:
MOD has touch guidance:
VER has oracle:
OPEN has minimal next evidence:
Evidence refs verified:
Real project command:
```

