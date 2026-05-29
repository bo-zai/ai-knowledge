# Business Capability Reverse Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice that discovers a repository business capability and generates AI-consumable `bootstrap-knowledge/` objects, catalog, and capability view.

**Architecture:** Add a targeted capability discovery pipeline under `src/slicing`, build bounded evidence bundles under `src/evidence`, generate claim candidates under `src/generation`, assemble knowledge objects under `src/knowledge`, and render the package under `src/packaging`. The first pilot targets the existing DB/MyBatis knowledge generation capability in this repository.

**Tech Stack:** TypeScript strict mode, Zod runtime schemas, existing `engine`/`query` data when available, existing test stack with Vitest, existing packaging/rendering patterns.

---

## Implementation Notes

- Follow `AGENTS.md`: do not use git worktree, do not put business logic in `cli/`, keep `generation/` filesystem-free, and schema-validate all external boundary data.
- Use Conventional Commits if committing.
- Comments in source code must be Simplified Chinese and only explain non-obvious reasons.
- The MVP should run in targeted mode first. Full-repo discovery is not required.
- LLM must never decide final object IDs, paths, object types, catalog structure, or filesystem writes.

## File Map

Create:

- `src/slicing/capability-candidate-schema.ts`: Zod schemas and types for capability candidates and discovery signals.
- `src/slicing/capability-discovery.ts`: targeted capability discovery from paths, names, tests, docs, and optional graph references.
- `src/evidence/evidence-bundle-schema.ts`: Zod schemas and types for EvidenceBundle and evidence refs.
- `src/evidence/capability-evidence-builder.ts`: converts a `CapabilityCandidate` into a bounded EvidenceBundle.
- `src/generation/capability-claim-generator.ts`: prompt construction, LLM output schema, and claim filtering.
- `src/knowledge/capability-object-assembler.ts`: converts filtered candidate claims and bundle data into knowledge objects.
- `src/packaging/capability-knowledge-writer.ts`: writes objects, catalog entries, and capability views.
- `tests/unit/slicing/capability-discovery.test.ts`
- `tests/unit/evidence/capability-evidence-builder.test.ts`
- `tests/unit/generation/capability-claim-generator.test.ts`
- `tests/unit/knowledge/capability-object-assembler.test.ts`
- `tests/unit/packaging/capability-knowledge-writer.test.ts`

Modify:

- `src/slicing/types.ts`: export shared capability discovery types if existing patterns prefer central exports.
- `src/evidence/types.ts`: export shared evidence bundle types if existing patterns prefer central exports.
- `src/cli` command registration only after core pipeline is tested, and only as orchestration.
- `src/packaging` catalog/render helpers if reusable writer hooks already exist.

## Task 1: Capability Candidate Schema

**Files:**
- Create: `src/slicing/capability-candidate-schema.ts`
- Test: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Write schema tests**

Add tests that validate a minimal candidate and reject invalid confidence values.

```ts
import { describe, expect, it } from "vitest";
import { CapabilityCandidateSchema } from "../../../src/slicing/capability-candidate-schema";

describe("CapabilityCandidateSchema", () => {
  it("accepts a valid targeted capability candidate", () => {
    const candidate = CapabilityCandidateSchema.parse({
      candidateId: "CAND-DB-KNOWLEDGE-GENERATION",
      nameCandidates: ["DB knowledge generation"],
      confidence: 0.78,
      confidenceBreakdown: {
        entrySignal: 0.75,
        behaviorSignal: 0.85,
        dataSignal: 0.9,
        testSignal: 0.65,
        docSignal: 0.4,
        graphCohesion: 0.75,
      },
      primaryEntryPoints: [],
      behaviorAnchors: [],
      dataAnchors: [],
      testAnchors: [],
      docAnchors: [],
      moduleClusters: [],
      relatedTerms: ["db object", "description source"],
      risks: ["no_external_boundary_found"],
      missingSignals: ["No explicit external DB ownership contract found"],
    });

    expect(candidate.candidateId).toBe("CAND-DB-KNOWLEDGE-GENERATION");
  });

  it("rejects confidence greater than one", () => {
    expect(() =>
      CapabilityCandidateSchema.parse({
        candidateId: "CAND-BAD",
        nameCandidates: ["Bad"],
        confidence: 1.2,
        confidenceBreakdown: {
          entrySignal: 0,
          behaviorSignal: 0,
          dataSignal: 0,
          testSignal: 0,
          docSignal: 0,
          graphCohesion: 0,
        },
        primaryEntryPoints: [],
        behaviorAnchors: [],
        dataAnchors: [],
        testAnchors: [],
        docAnchors: [],
        moduleClusters: [],
        relatedTerms: [],
        risks: [],
        missingSignals: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: fail because `capability-candidate-schema.ts` does not exist.

- [ ] **Step 3: Implement schema**

Create `src/slicing/capability-candidate-schema.ts` with Zod schemas for:

- `EntrySignalSchema`
- `BehaviorSignalSchema`
- `DataSignalSchema`
- `TestSignalSchema`
- `DocSignalSchema`
- `ModuleClusterSchema`
- `CandidateRiskSchema`
- `CapabilityCandidateSchema`

Use camelCase field names.

- [ ] **Step 4: Run test**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 2: Targeted Capability Discovery

**Files:**
- Create: `src/slicing/capability-discovery.ts`
- Test: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add discovery tests**

Extend the test file with an in-memory signal fixture. Test that targeted terms `["db", "mybatis", "knowledge"]` produce a candidate named `DB knowledge generation`.

The test should assert:

- candidate confidence is at least `0.55`
- related terms include `db object`
- risks include `no_external_boundary_found` when no external contract signal exists

- [ ] **Step 2: Implement term normalization**

Implement helpers in `capability-discovery.ts`:

- `normalizeCapabilityTerms(input: string): string[]`
- split camelCase, PascalCase, kebab-case, snake_case
- merge domain phrases: `db object`, `knowledge object`, `description source`, `mybatis mapper`, `sql evidence`, `field description`, `bootstrap knowledge`

- [ ] **Step 3: Implement targeted discovery**

Export:

```ts
export type DiscoverCapabilitiesInput = {
  repoRoot: string;
  targetTerms?: string[];
  targetPaths?: string[];
};

export async function discoverCapabilities(input: DiscoverCapabilitiesInput): Promise<CapabilityCandidate[]> {
  // MVP can use path/name heuristics first.
}
```

For MVP, implement deterministic heuristics using:

- provided target terms
- target paths
- known source roots under `src`
- known test roots under `tests` and `test`

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 3: EvidenceBundle Schema

**Files:**
- Create: `src/evidence/evidence-bundle-schema.ts`
- Test: `tests/unit/evidence/capability-evidence-builder.test.ts`

- [ ] **Step 1: Write schema tests**

Add tests for a minimal valid EvidenceBundle with:

- one entry point
- one flow trace
- one module surface
- one data contract
- one validation anchor
- one negative evidence item
- one open question seed

Also test that `bundleId` and `candidateId` are required.

- [ ] **Step 2: Implement schema**

Create schemas for:

- `EvidenceEntryPointSchema`
- `EvidenceBehaviorSliceSchema`
- `EvidenceDataContractSchema`
- `EvidenceFlowTraceSchema`
- `EvidenceModuleSurfaceSchema`
- `EvidenceValidationAnchorSchema`
- `NegativeEvidenceSchema`
- `OpenQuestionSeedSchema`
- `EvidenceBundleSchema`

Use `evidence://...` refs as plain strings in MVP. Do not add URI parsing yet.

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/unit/evidence/capability-evidence-builder.test.ts
```

Expected: pass.

## Task 4: Capability Evidence Builder

**Files:**
- Create: `src/evidence/capability-evidence-builder.ts`
- Test: `tests/unit/evidence/capability-evidence-builder.test.ts`

- [ ] **Step 1: Add builder tests**

Test that `buildEvidenceBundle(candidate)`:

- copies candidate name candidates and related terms
- limits behavior slices to 12
- creates `no_external_boundary_found` when no API/event/external system signal exists
- creates an OPEN seed from negative evidence

- [ ] **Step 2: Implement builder**

Export:

```ts
export function buildEvidenceBundle(candidate: CapabilityCandidate): EvidenceBundle
```

Mapping:

- EntrySignal -> EvidenceEntryPoint
- BehaviorSignal -> EvidenceBehaviorSlice
- DataSignal -> EvidenceDataContract
- ModuleCluster -> EvidenceModuleSurface
- TestSignal -> EvidenceValidationAnchor
- Candidate risks/missing signals -> NegativeEvidence and OpenQuestionSeed

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/unit/evidence/capability-evidence-builder.test.ts
```

Expected: pass.

## Task 5: Candidate Claim Generation Contract

**Files:**
- Create: `src/generation/capability-claim-generator.ts`
- Test: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Write claim filtering tests**

Test that:

- non-OPEN claim without evidence refs is rejected
- low-confidence non-OPEN claim is rejected
- unsupported parts create OPEN candidates
- OPEN claim without blocked decisions is rejected

- [ ] **Step 2: Implement schema and filter**

Implement:

```ts
export const CandidateClaimSchema = z.object({...});
export function filterCandidateClaims(claims: CandidateClaim[], bundle: EvidenceBundle): CandidateClaim[]
export function buildCapabilityClaimPrompt(bundle: EvidenceBundle): string
```

`buildCapabilityClaimPrompt` must include hard rules:

- use only bundle evidence
- every non-OPEN claim cites evidence refs
- missing evidence becomes OPEN
- do not create object IDs or file paths

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 6: Knowledge Object Assembly

**Files:**
- Create: `src/knowledge/capability-object-assembler.ts`
- Test: `tests/unit/knowledge/capability-object-assembler.test.ts`

- [ ] **Step 1: Write assembler tests**

Use a fixed EvidenceBundle and filtered claims. Assert assembler creates:

- `CAP-DB-KNOWLEDGE-GENERATION`
- `FLOW-DB-KNOWLEDGE-GENERATION`
- `MOD-MYBATIS-EVIDENCE`
- `CON-DB-OBJECT-SCHEMA`
- `VER-DB-KNOWLEDGE-GENERATION`
- at least one `OPEN-*`

Assert every non-OPEN object has non-empty `evidencePrimary`.

- [ ] **Step 2: Implement object ID generation**

Implement deterministic ID helpers:

```ts
export function makeObjectId(type: KnowledgeObjectType, name: string): string
```

Rules:

- uppercase
- trim punctuation
- replace non-alphanumeric runs with `-`
- prefix with object type

- [ ] **Step 3: Implement assembler**

Export:

```ts
export function assembleCapabilityKnowledgeObjects(input: {
  bundle: EvidenceBundle;
  claims: CandidateClaim[];
}): KnowledgeObject[]
```

Map:

- CAP claim + capability hints -> CAP object
- FLOW claim + flow traces -> FLOW object
- MOD claim + module surfaces -> MOD object
- CON claim + data contracts -> CON object
- VER claim + validation anchors -> VER object
- OPEN claim + open question seeds -> OPEN object

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-object-assembler.test.ts
```

Expected: pass.

## Task 7: Catalog and Capability View Writer

**Files:**
- Create: `src/packaging/capability-knowledge-writer.ts`
- Test: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Write rendering tests**

Use assembled objects and assert writer output includes:

- `catalog.yaml`
- object paths under `objects/<type-dir>/`
- `views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md`
- capability view headings: Purpose, Terms, Current Flow, Code Surface, Contracts, Validation, Unknowns

Use an in-memory writer or temp directory consistent with existing packaging tests.

- [ ] **Step 2: Implement renderer**

Export:

```ts
export function buildCapabilityKnowledgeFiles(input: {
  objects: KnowledgeObject[];
  capabilityId: string;
}): Array<{ path: string; content: string }>
```

Do not write to filesystem in this function. Return file descriptors for packaging layer.

- [ ] **Step 3: Add filesystem wrapper**

Export:

```ts
export async function writeCapabilityKnowledgePackage(input: {
  outputRoot: string;
  objects: KnowledgeObject[];
  capabilityId: string;
}): Promise<void>
```

This function belongs in `packaging/` and may write files.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 8: Pilot Orchestration

**Files:**
- Modify: existing CLI orchestration only if there is already a suitable generate command hook.
- Create if needed: `src/knowledge/capability-knowledge-pipeline.ts`
- Test: `tests/unit/cli/generate-orchestration.test.ts` or a new focused pipeline test.

- [ ] **Step 1: Write pipeline test**

Test that a targeted input:

```ts
{
  repoRoot: ".",
  targetTerms: ["db", "mybatis", "knowledge"],
  targetPaths: ["src/mybatis", "src/evidence", "src/knowledge", "src/schemas"]
}
```

returns file descriptors including catalog, CAP object, FLOW object, MOD object, CON object, VER object, and OPEN object.

- [ ] **Step 2: Implement pipeline**

Pipeline order:

```text
discoverCapabilities
-> choose highest confidence candidate
-> buildEvidenceBundle
-> buildCapabilityClaimPrompt
-> parse/filter claims
-> assembleCapabilityKnowledgeObjects
-> buildCapabilityKnowledgeFiles
```

For MVP, allow injecting claims in tests so unit tests do not call a real LLM.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts tests/unit/evidence/capability-evidence-builder.test.ts tests/unit/generation/capability-claim-generator.test.ts tests/unit/knowledge/capability-object-assembler.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 9: Verification

**Files:**
- No new files unless tests reveal missing fixtures.

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

- [ ] **Step 4: Pilot manual check**

Run the new targeted pipeline or CLI command against this repo with:

```text
targetTerms: db,mybatis,knowledge
targetPaths: src/mybatis,src/evidence,src/knowledge,src/schemas
```

Expected generated knowledge contains:

- `CAP-DB-KNOWLEDGE-GENERATION`
- `FLOW-DB-KNOWLEDGE-GENERATION`
- `MOD-MYBATIS-EVIDENCE`
- `CON-DB-OBJECT-SCHEMA`
- `VER-DB-KNOWLEDGE-GENERATION`
- at least one `OPEN-*`

## Self-Review Checklist

- Spec coverage: this plan covers candidate discovery, evidence bundles, claim filtering, object assembly, catalog/view rendering, and pilot verification.
- Placeholder scan: no implementation step relies on an unspecified future component; LLM calls are injectable for tests.
- Type consistency: field names use camelCase and match the spec.
- Scope control: full-repo discovery and SDD adapters are intentionally excluded from MVP.
