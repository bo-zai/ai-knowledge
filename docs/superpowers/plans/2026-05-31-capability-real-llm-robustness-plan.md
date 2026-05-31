# Capability Real LLM Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make single-capability `generate-capability` robust against real LLM output and strict enough to reject low-quality business capability knowledge.

**Architecture:** Keep one LLM call per selected capability. Extend claim schema and parser normalization for real model shapes, add honest normalization trace metadata, strengthen final quality gates, and validate on `D:\workspace\other_project\music-education-app`.

**Tech Stack:** TypeScript strict mode, Zod, LangGraph, existing OpenAI-compatible config, Vitest, real CLI validation.

---

## Requirements

- Do not use `git worktree`.
- Do not implement multi-capability batch mode.
- Do not add `--llm` or `--require-llm`.
- Keep `generate-capability` as mandatory LLM mode.
- Keep LLM input bounded to one `EvidenceBundle`.
- Keep business logic out of `src/cli/`.
- Keep filesystem writes out of `src/generation/`.
- Validate on `D:\workspace\other_project\music-education-app`.

## File Map

- Modify: `src/generation/capability-claim-generator.ts`
  - Add `FieldSemanticSchema`.
  - Allow structured `fieldSemantics` values.
  - Enforce OPEN minimal next evidence in filtering.
- Modify: `src/generation/capability-llm-claims-provider.ts`
  - Add parser normalization result.
  - Normalize real LLM shapes.
  - Expose normalization notes.
- Modify: `src/generation/capability-langgraph-claims-runtime.ts`
  - Carry normalization notes into `graphTrace`.
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
  - Add single-capability report metadata.
  - Add stronger business quality gates.
  - Add technical term leakage report.
- Modify: `src/packaging/capability-knowledge-writer.ts`
  - Extend report type.
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`
- Modify: `tests/unit/generation/capability-llm-claims-provider.test.ts`
- Modify: `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Accept Structured Field Semantics

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add failing schema test**

Add to `tests/unit/generation/capability-claim-generator.test.ts`:

```ts
it('accepts structured fieldSemantics values from real LLM output', () => {
  const result = CandidateClaimSchema.safeParse({
    suggestedType: 'CON',
    claimText: 'Order detail contract exposes goods line items and goods price semantics.',
    confidence: 'high',
    evidenceRefs: ['evidence://contract/CON-EVID-001'],
    decisionPoints: ['affected_contracts'],
    sddStageUses: ['requirement_specification'],
    unsupportedParts: [],
    blockedDecisions: [],
    source: 'llm',
    objectHints: {
      contractSubject: 'Order detail goods contract',
      contractKind: 'schema',
      fieldSemantics: {
        goodsList: {
          meaning: 'Ordered goods line items returned with the order detail',
          validation: ['Must match submitted goods'],
          evidenceRef: 'evidence://contract/CON-EVID-001',
        },
        goodsPrice: {
          meaning: 'Price used for the ordered goods line',
          notes: ['Currency source is not proven by current evidence'],
        },
      },
    },
  });

  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Implement `FieldSemanticSchema`**

In `src/generation/capability-claim-generator.ts`, above `ObjectHintSchema`, add:

```ts
const FieldSemanticSchema = z.union([
  z.string(),
  z.object({
    meaning: z.string().optional(),
    validation: z.array(z.string()).optional(),
    evidenceRef: z.string().optional(),
    notes: z.array(z.string()).optional(),
  }).strict(),
]);
```

Change:

```ts
fieldSemantics: z.record(z.string(), z.string()).optional(),
```

to:

```ts
fieldSemantics: z.record(z.string(), FieldSemanticSchema).optional(),
```

- [ ] **Step 3: Run schema tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 2: Normalize Real LLM Shape Variations

**Files:**
- Modify: `src/generation/capability-llm-claims-provider.ts`
- Modify: `tests/unit/generation/capability-llm-claims-provider.test.ts`

- [ ] **Step 1: Add parser test for real failing output**

Add:

```ts
it('parses fieldSemantics object values from real LLM output', () => {
  const claims = parseCapabilityClaimJson(JSON.stringify([
    {
      suggestedType: 'CON',
      claimText: 'Order detail exposes ordered goods and price fields.',
      confidence: 'high',
      evidenceRefs: ['evidence://contract/CON-EVID-001'],
      decisionPoints: ['affected_contracts'],
      sddStageUses: ['requirement_specification'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: {
        contractSubject: 'Order detail goods contract',
        contractKind: 'schema',
        fieldSemantics: {
          goodsList: {
            meaning: 'Ordered goods line items',
            validation: ['Must match the order goods records'],
            evidenceRef: 'evidence://contract/CON-EVID-001',
          },
          goodsPrice: {
            meaning: 'Displayed price for ordered goods',
          },
        },
      },
    },
  ]));

  expect(claims).toHaveLength(1);
  expect(claims[0]!.objectHints?.fieldSemantics).toBeDefined();
});
```

- [ ] **Step 2: Add parser test for string-to-array normalization**

Add:

```ts
it('normalizes common string fields into arrays before schema validation', () => {
  const claims = parseCapabilityClaimJson(JSON.stringify([
    {
      suggestedType: 'OPEN',
      claimText: 'Validation oracle is not proven.',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: 'Cannot prove order submission behavior',
      objectHints: {
        minimalNextEvidence: 'Find an integration test for order submission',
      },
    },
  ]));

  expect(claims[0]!.blockedDecisions).toEqual(['Cannot prove order submission behavior']);
  expect(claims[0]!.objectHints?.minimalNextEvidence).toEqual(['Find an integration test for order submission']);
});
```

- [ ] **Step 3: Replace `repairArrayFields()` with general normalizer**

In `src/generation/capability-llm-claims-provider.ts`, replace `repairArrayFields` with:

```ts
interface NormalizeResult {
  value: unknown;
  notes: string[];
}

const ROOT_ARRAY_FIELDS = new Set([
  'evidenceRefs',
  'decisionPoints',
  'sddStageUses',
  'unsupportedParts',
  'blockedDecisions',
]);

const HINT_ARRAY_FIELDS = new Set([
  'notEqualTo',
  'aliases',
  'successCriteria',
  'nonGoals',
  'failureBranches',
  'compensation',
  'touchWhen',
  'doNotTouchWhen',
  'testAnchors',
  'validationRules',
  'acceptanceOracle',
  'minimalNextEvidence',
]);

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeClaimShape(item: unknown, index: number): NormalizeResult {
  const notes: string[] = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { value: item, notes };
  }

  const record = { ...(item as Record<string, unknown>) };

  for (const field of ROOT_ARRAY_FIELDS) {
    if (typeof record[field] === 'string') {
      record[field] = toArray(record[field]);
      notes.push(`claim[${index}].${field}: string normalized to array`);
    }
  }

  if (record.objectHints && typeof record.objectHints === 'object' && !Array.isArray(record.objectHints)) {
    const hints = { ...(record.objectHints as Record<string, unknown>) };

    for (const field of HINT_ARRAY_FIELDS) {
      if (typeof hints[field] === 'string') {
        hints[field] = toArray(hints[field]);
        notes.push(`claim[${index}].objectHints.${field}: string normalized to array`);
      }
    }

    if (Array.isArray(hints.orderedSteps) && hints.orderedSteps.every(step => typeof step === 'string')) {
      hints.orderedSteps = hints.orderedSteps.map(action => ({ action }));
      notes.push(`claim[${index}].objectHints.orderedSteps: string[] normalized to step objects`);
    }

    record.objectHints = hints;
  }

  return { value: record, notes };
}
```

- [ ] **Step 4: Use normalizer in `parseCapabilityClaimJson()`**

Change the map section to:

```ts
const allNotes: string[] = [];
const claims = (parsed as unknown[]).map((item, index) => {
  const normalized = normalizeClaimShape(item, index);
  allNotes.push(...normalized.notes);
  const result = CandidateClaimSchema.safeParse(normalized.value);
  if (!result.success) {
    throw new Error(`Invalid capability claim at index ${index}: ${result.error.message}`);
  }
  return result.data;
});

return claims;
```

This task only changes `parseCapabilityClaimJson()`. Task 3 adds traceable parse metadata.

- [ ] **Step 5: Run parser tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-llm-claims-provider.test.ts
```

Expected: pass.

## Task 3: Expose Parser Normalization Notes

**Files:**
- Modify: `src/generation/capability-llm-claims-provider.ts`
- Modify: `src/generation/capability-langgraph-claims-runtime.ts`
- Modify: `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`

- [ ] **Step 1: Add parse result type**

In `src/generation/capability-llm-claims-provider.ts`, add:

```ts
export interface CapabilityClaimParseResult {
  claims: CandidateClaim[];
  normalizationNotes: string[];
}
```

- [ ] **Step 2: Add `parseCapabilityClaimJsonWithMetadata()`**

Refactor `parseCapabilityClaimJson()` internals into:

```ts
export function parseCapabilityClaimJsonWithMetadata(text: string): CapabilityClaimParseResult {
  // same JSON/fence/control-char/truncation/extraction logic
  // run normalizeClaimShape for each parsed item
  // return { claims, normalizationNotes }
}
```

Keep backward compatibility:

```ts
export function parseCapabilityClaimJson(text: string): CandidateClaim[] {
  return parseCapabilityClaimJsonWithMetadata(text).claims;
}
```

- [ ] **Step 3: Update LangGraph runtime**

In `src/generation/capability-langgraph-claims-runtime.ts`, import:

```ts
parseCapabilityClaimJsonWithMetadata
```

Change `validateAcceptedClaims()` to return:

```ts
{
  claims: CandidateClaim[];
  normalizationNotes: string[];
}
```

The parse_validate node should return:

```ts
claims: validation.claims,
normalizationNotes: validation.normalizationNotes,
```

Extend `State`:

```ts
normalizationNotes: Annotation<string[]>({
  reducer: (left, right) => [...left, ...right],
  default: () => [],
}),
```

Extend result graphTrace:

```ts
normalizationNotes: result.normalizationNotes,
```

- [ ] **Step 4: Add runtime test**

Add to `tests/unit/generation/capability-langgraph-claims-runtime.test.ts`:

```ts
it('records parser normalization notes in graphTrace', async () => {
  const result = await runCapabilityClaimsLangGraph({
    bundle: makeBundle(),
    modelName: 'test-model',
    model: makeModel([
      JSON.stringify([
        {
          suggestedType: 'OPEN',
          claimText: 'Validation oracle is missing.',
          confidence: 'low',
          evidenceRefs: [],
          decisionPoints: [],
          sddStageUses: ['requirement_clarification'],
          unsupportedParts: [],
          blockedDecisions: 'Cannot plan validation',
          objectHints: { minimalNextEvidence: 'Find validation test' },
        },
        {
          suggestedType: 'CAP',
          claimText: 'Goods Order capability lets customers submit goods orders.',
          confidence: 'high',
          evidenceRefs: ['evidence://entry/EP-001'],
          decisionPoints: ['requirement_intent'],
          sddStageUses: ['requirement_clarification'],
          unsupportedParts: [],
          blockedDecisions: [],
          objectHints: { canonicalTerm: 'Goods Order capability' },
        },
      ]),
    ]),
  });

  expect(result.graphTrace.normalizationNotes.length).toBeGreaterThan(0);
});
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-langgraph-claims-runtime.test.ts tests/unit/generation/capability-llm-claims-provider.test.ts
```

Expected: pass.

## Task 4: Enforce OPEN Minimal Next Evidence

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add filtering test**

Add:

```ts
it('rejects OPEN claim without minimalNextEvidence', () => {
  const bundle = makeEvidenceBundle();
  const filtered = filterCandidateClaims([
    {
      suggestedType: 'OPEN',
      claimText: 'Ownership boundary is unknown.',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: ['Cannot decide source of truth'],
      source: 'llm',
    },
  ], bundle);

  expect(filtered).toEqual([]);
});
```

- [ ] **Step 2: Update OPEN filtering**

In `filterCandidateClaims()`:

```ts
if (claim.suggestedType === 'OPEN') {
  if (claim.blockedDecisions.length === 0) return false;
  const minimalNextEvidence = claim.objectHints?.minimalNextEvidence;
  if (!minimalNextEvidence || minimalNextEvidence.length === 0) return false;
  return true;
}
```

- [ ] **Step 3: Add minimal next evidence to skeleton OPEN claims**

In `buildSkeletonClaims()`:

For open questions:

```ts
objectHints: { minimalNextEvidence: [question.minimalNextEvidence] },
```

For negative evidence:

```ts
objectHints: { minimalNextEvidence: [negative.location ?? negative.description] },
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 5: Strengthen Final Quality Gates

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Extend report type**

In `CapabilityGenerationReport.requiredBusinessObjects`, add:

```ts
modHasTouchGuidance: boolean;
verHasOracle: boolean;
openHasMinimalNextEvidence: boolean;
noTechnicalTermLeakage: boolean;
```

Add:

```ts
technicalTermLeakage?: string[];
```

- [ ] **Step 2: Add helper functions in pipeline**

In `src/knowledge/capability-knowledge-pipeline.ts`, import:

```ts
isTechnicalTerm
```

Add:

```ts
function hasNonEmptyArrayMetadata(object: KnowledgeObject, key: string): boolean {
  const value = object.metadata[key];
  return Array.isArray(value) && value.length > 0;
}

function collectTechnicalTermLeakage(objects: KnowledgeObject[]): string[] {
  return objects
    .filter(object => object.type === 'TERM')
    .map(object => String(object.metadata.canonicalTerm ?? object.id.replace(/^TERM-/, '')))
    .filter(term => isTechnicalTerm(term));
}
```

- [ ] **Step 3: Compute stronger gates**

Replace final gate block with:

```ts
const capFromLlm = objects.some(o => o.type === 'CAP' && o.metadata.source === 'llm');
const flowOrConFromLlm = objects.some(o =>
  (o.type === 'FLOW' || o.type === 'CON') && o.metadata.source === 'llm',
);
const modPresent = objects.some(o => o.type === 'MOD');
const modHasTouchGuidance = objects.some(o =>
  o.type === 'MOD' &&
  o.metadata.source === 'llm' &&
  hasNonEmptyArrayMetadata(o, 'touchWhen') &&
  hasNonEmptyArrayMetadata(o, 'doNotTouchWhen'),
);
const verHasOracle = objects.some(o =>
  o.type === 'VER' &&
  hasNonEmptyArrayMetadata(o, 'acceptanceOracle') &&
  typeof o.metadata.verificationGoal === 'string' &&
  o.metadata.verificationGoal.length > 0,
);
const openHasMinimalNextEvidence = objects.some(o =>
  o.type === 'OPEN' &&
  o.blockedDecisions.length > 0 &&
  hasNonEmptyArrayMetadata(o, 'minimalNextEvidence'),
);
const verOrValidationOpenPresent = verHasOracle || openHasMinimalNextEvidence;
const technicalTermLeakage = collectTechnicalTermLeakage(objects);
const noTechnicalTermLeakage = technicalTermLeakage.length === 0;

if (!capFromLlm) throw new Error('LLM generation failed: LLM CAP object is required');
if (!flowOrConFromLlm) throw new Error('LLM generation failed: LLM FLOW or CON object is required');
if (!modPresent) throw new Error('LLM generation failed: MOD object is required');
if (!modHasTouchGuidance) throw new Error('LLM generation failed: LLM MOD touch guidance is required for business capability knowledge');
if (!verOrValidationOpenPresent) throw new Error('LLM generation failed: validation oracle or validation OPEN is required');
if (!noTechnicalTermLeakage) throw new Error(`LLM generation failed: technical TERM leakage: ${technicalTermLeakage.join(', ')}`);
```

- [ ] **Step 4: Include new fields in report**

Report:

```ts
requiredBusinessObjects: {
  capFromLlm,
  flowOrConFromLlm,
  modPresent,
  modHasTouchGuidance,
  verOrValidationOpenPresent,
  verHasOracle,
  openHasMinimalNextEvidence,
  noTechnicalTermLeakage,
},
technicalTermLeakage,
```

- [ ] **Step 5: Add tests for MOD touch guidance gate**

Add:

```ts
it('throws when MOD exists only from skeleton without touch guidance', async () => {
  await expect(runCapabilityKnowledgePipeline({
    repoRoot: '.',
    targetTerms: ['db', 'mybatis', 'knowledge'],
    targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge', 'src/schemas'],
    claimsProvider: async () => ({ claims: [validCapClaim, validFlowClaim] }),
  })).rejects.toThrow(/MOD touch guidance/);
});
```

Then update existing success fixtures to include an LLM MOD claim with `touchWhen` and `doNotTouchWhen`.

- [ ] **Step 6: Add tests for validation oracle or OPEN**

Add a success fixture with either:

```ts
suggestedType: 'VER',
objectHints: {
  verificationGoal: 'Generated DB object matches schema contract',
  acceptanceOracle: ['DBObjectSchema validation passes'],
}
```

or an OPEN with:

```ts
blockedDecisions: ['Cannot plan validation without test evidence'],
objectHints: {
  minimalNextEvidence: ['Find test covering generated DB object output'],
}
```

- [ ] **Step 7: Run pipeline and writer tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 6: Add Single-Capability Report Metadata

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Extend report type**

In `CapabilityGenerationReport`, add:

```ts
capabilityGenerationMode?: 'single';
selectedCandidateId?: string;
candidateCount?: number;
```

- [ ] **Step 2: Populate report**

After candidates are discovered and top candidate selected:

```ts
capabilityGenerationMode: 'single',
selectedCandidateId: topCandidate.candidateId,
candidateCount: candidates.length,
```

- [ ] **Step 3: Add test**

Add:

```ts
it('reports single capability generation mode and selected candidate', async () => {
  const result = await runCapabilityKnowledgePipeline({
    repoRoot: '.',
    targetTerms: ['db', 'mybatis', 'knowledge'],
    targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge', 'src/schemas'],
    claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
  });

  expect(result.report.capabilityGenerationMode).toBe('single');
  expect(result.report.selectedCandidateId).toBeTruthy();
  expect(result.report.candidateCount).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 7: Improve Integration Mock To Cover Real Shapes

**Files:**
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add structured fieldSemantics to mock response**

In the mock LLM success response, add a `CON` claim:

```ts
{
  suggestedType: 'CON',
  claimText: 'Order output exposes order identity, amount, and status used by order management.',
  confidence: 'high',
  evidenceRefs: ['evidence://contract/CON-EVID-001'],
  decisionPoints: ['affected_contracts'],
  sddStageUses: ['requirement_specification'],
  unsupportedParts: [],
  blockedDecisions: [],
  objectHints: {
    contractSubject: 'Order output contract',
    contractKind: 'schema',
    fieldSemantics: {
      status: {
        meaning: 'Current lifecycle state of the order',
        validation: ['pending after creation'],
        evidenceRef: 'evidence://contract/CON-EVID-001',
      },
    },
  },
}
```

- [ ] **Step 2: Add LLM MOD and VER quality**

Ensure mock response includes:

```ts
{
  suggestedType: 'MOD',
  objectHints: {
    modulePath: 'src/order.ts',
    ownedResponsibility: 'Order lifecycle management',
    touchWhen: ['Changing order creation logic'],
    doNotTouchWhen: ['Changing unrelated payment behavior'],
  }
}
```

and:

```ts
{
  suggestedType: 'VER',
  evidenceRefs: ['evidence://validation/VAL-001'],
  objectHints: {
    verificationGoal: 'Order creation returns pending status',
    acceptanceOracle: ['createOrder returns an order with pending status'],
  }
}
```

- [ ] **Step 3: Assert new report gates**

Add:

```ts
expect(report.requiredBusinessObjects.modHasTouchGuidance).toBe(true);
expect(report.requiredBusinessObjects.verHasOracle).toBe(true);
expect(report.requiredBusinessObjects.noTechnicalTermLeakage).toBe(true);
expect(report.capabilityGenerationMode).toBe('single');
expect(report.selectedCandidateId).toBeTruthy();
expect(report.candidateCount).toBeGreaterThan(0);
```

- [ ] **Step 4: Run integration test**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 8: Full Verification

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Validation

**Files:**
- No source changes unless validation fails.

- [ ] **Step 1: Run real command**

Run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-real-llm-robustness-validation --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

```text
Generated
LLM runtime: langgraph
Succeeded: true
```

- [ ] **Step 2: Inspect report**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-real-llm-robustness-validation\bootstrap-knowledge\reports\capability-generation.json
```

Expected:

```json
"capabilityGenerationMode": "single"
"llmRuntime": "langgraph"
"llmSucceeded": true
"capFromLlm": true
"flowOrConFromLlm": true
"modHasTouchGuidance": true
"noTechnicalTermLeakage": true
```

- [ ] **Step 3: Reject known bad phrases**

Run:

```bash
rg -n "is a discovered business capability supported by repository evidence|has a repository-derived execution flow|is a data or schema contract related|TERM-MYBATIS-MAPPER|service_implementation|data_access_layer|business_logic|persistence_layer" D:\tmp\music-education-app-capability-real-llm-robustness-validation\bootstrap-knowledge
```

Expected: no matches.

- [ ] **Step 4: Verify evidence refs**

Run:

```powershell
$root = "D:\tmp\music-education-app-capability-real-llm-robustness-validation\bootstrap-knowledge"
$indexRefs = Get-Content "$root\evidence\index.jsonl" | ForEach-Object { ($_ | ConvertFrom-Json).ref }
$objectRefs = rg --no-filename -o "evidence://[A-Za-z0-9/.-]+" "$root\objects"
$missing = $objectRefs | Where-Object { $_ -notin $indexRefs } | Sort-Object -Unique
if ($missing) { $missing; exit 1 } else { "all evidence refs resolved" }
```

Expected:

```text
all evidence refs resolved
```

## Task 10: Final Handoff

**Files:**
- Review only.

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected:

- Source and tests changed.
- `D:\tmp` output is not tracked.
- Root `bootstrap-knowledge/` output is not newly added unless explicitly requested.

- [ ] **Step 2: Final response**

Claude Code must report:

```text
Generation mode: single capability per LLM call
Selected candidate:
Candidate count:
Generated capability:
LLM runtime:
LLM accepted claims:
Skeleton added claims:
CAP source:
FLOW/CON source:
MOD has touch guidance:
VER has oracle:
OPEN has minimal next evidence:
Technical term leakage:
Parser normalization notes:
Evidence refs verified:
Real project command:
```

