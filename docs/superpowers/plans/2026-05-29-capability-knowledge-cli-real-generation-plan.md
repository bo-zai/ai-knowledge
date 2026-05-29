# Capability Knowledge CLI Real Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make capability-oriented business knowledge generation runnable from CLI and verifiable on `D:\workspace\other_project\music-education-app`.

**Architecture:** Add deterministic skeleton claim generation so capability knowledge does not depend on injected test claims or a live LLM. Wire the capability pipeline into a CLI command that writes `bootstrap-knowledge/` to the target repo. Update catalog rendering so SDD tools can route from capability to objects and view.

**Tech Stack:** TypeScript strict mode, Commander CLI, Zod schemas, Vitest, existing packaging conventions, Windows PowerShell validation.

---

## Requirements

- Do not use git worktree.
- Keep business logic out of `cli/`; CLI only parses options and calls `knowledge/` pipeline.
- `generation/` must not write files.
- `packaging/` owns filesystem writes.
- All generated non-OPEN claims must cite evidence refs.
- Real validation must run against `D:\workspace\other_project\music-education-app`.

## Files

- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/cli/index.ts` or the existing CLI command registration file that owns commands.
- Test: `tests/unit/generation/capability-claim-generator.test.ts`
- Test: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`
- Test: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Test: add or modify an integration test under `tests/integration/`

## Task 1: Add Skeleton Claim Generation

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Write skeleton claim tests**

Add tests that build a minimal `EvidenceBundle` with:

- one flow trace
- one module surface
- one data contract
- one validation anchor
- one open question

Assert `buildSkeletonClaims(bundle)` returns at least:

- one CAP claim
- one FLOW claim
- one MOD claim
- one CON claim
- one VER claim
- one OPEN claim

Assert every non-OPEN claim has `evidenceRefs.length > 0`.

- [ ] **Step 2: Implement `buildSkeletonClaims`**

Add:

```ts
export function buildSkeletonClaims(bundle: EvidenceBundle): CandidateClaim[] {
  const claims: CandidateClaim[] = [];
  const capabilityName = bundle.capabilityHints.nameCandidates[0] ?? bundle.candidateId;

  const firstEvidence =
    bundle.entryPoints[0]?.ref ??
    bundle.flowTraces[0]?.ref ??
    bundle.behaviorSlices[0]?.ref ??
    bundle.moduleSurfaces[0]?.ref ??
    bundle.dataContracts[0]?.ref ??
    bundle.validationAnchors[0]?.ref;

  if (firstEvidence) {
    claims.push({
      suggestedType: 'CAP',
      claimText: `${capabilityName} is a discovered business capability supported by repository evidence.`,
      confidence: 'medium',
      evidenceRefs: [firstEvidence],
      decisionPoints: ['matched_capability'],
      sddStageUses: ['requirement_clarification', 'requirement_specification'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: capabilityName },
    });
  }

  const flow = bundle.flowTraces[0];
  if (flow) {
    claims.push({
      suggestedType: 'FLOW',
      claimText: `${capabilityName} has a repository-derived execution flow.`,
      confidence: 'medium',
      evidenceRefs: [flow.ref],
      decisionPoints: ['current_behavior'],
      sddStageUses: ['requirement_specification', 'design_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { subject: capabilityName },
    });
  }

  const module = bundle.moduleSurfaces[0];
  if (module) {
    claims.push({
      suggestedType: 'MOD',
      claimText: `${module.rootPath} is part of the change surface for ${capabilityName}.`,
      confidence: 'medium',
      evidenceRefs: [module.ref],
      decisionPoints: ['change_surface'],
      sddStageUses: ['implementation_planning', 'coding'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { modulePath: module.rootPath },
    });
  }

  const contract = bundle.dataContracts[0];
  if (contract) {
    claims.push({
      suggestedType: 'CON',
      claimText: `${contract.name} is a data or schema contract related to ${capabilityName}.`,
      confidence: 'medium',
      evidenceRefs: [contract.ref],
      decisionPoints: ['affected_contracts'],
      sddStageUses: ['design_planning', 'implementation_planning', 'review'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: {
        subject: contract.name,
        contractKind: contract.kind === 'sql' ? 'sql' : contract.kind === 'api' ? 'api' : contract.kind === 'event' ? 'event' : 'schema',
      },
    });
  }

  const validation = bundle.validationAnchors[0];
  if (validation) {
    claims.push({
      suggestedType: 'VER',
      claimText: `${validation.name} is a validation anchor for ${capabilityName}.`,
      confidence: 'medium',
      evidenceRefs: [validation.ref],
      decisionPoints: ['validation_plan'],
      sddStageUses: ['validation', 'review'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { subject: capabilityName },
    });
  }

  for (const question of bundle.openQuestions) {
    claims.push({
      suggestedType: 'OPEN',
      claimText: question.question,
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: question.blockedDecisions,
    });
  }

  for (const negative of bundle.negativeEvidence) {
    claims.push({
      suggestedType: 'OPEN',
      claimText: negative.description,
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['design_planning'],
      unsupportedParts: [],
      blockedDecisions: [negative.impact],
    });
  }

  return claims;
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 2: Use Skeleton Claims In Pipeline

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/knowledge/capability-knowledge-pipeline.test.ts`

- [ ] **Step 1: Write pipeline fallback test**

Add a test that calls `runCapabilityKnowledgePipeline()` without `claimsProvider`:

```ts
const result = await runCapabilityKnowledgePipeline({
  repoRoot: '.',
  targetTerms: ['db', 'mybatis', 'knowledge'],
  targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge', 'src/schemas'],
});

expect(result.files.some(f => f.path.includes('objects/capabilities/CAP-'))).toBe(true);
expect(result.files.some(f => f.path.includes('objects/flows/FLOW-'))).toBe(true);
expect(result.files.some(f => f.path.includes('objects/modules/MOD-'))).toBe(true);
expect(result.files.some(f => f.path.includes('objects/contracts/CON-'))).toBe(true);
expect(result.files.some(f => f.path.includes('objects/validation/VER-'))).toBe(true);
expect(result.files.some(f => f.path.includes('objects/open/OPEN-'))).toBe(true);
```

- [ ] **Step 2: Implement fallback**

Import `buildSkeletonClaims` and change claim selection:

```ts
const providerClaims = claimsProvider ? await claimsProvider() : [];
const filteredProviderClaims = filterCandidateClaims(providerClaims, bundle);
const skeletonClaims = filterCandidateClaims(buildSkeletonClaims(bundle), bundle);

const hasNonOpenProviderClaim = filteredProviderClaims.some(claim => claim.suggestedType !== 'OPEN');
const claims = hasNonOpenProviderClaim
  ? mergeClaimsByTypeAndText(filteredProviderClaims, skeletonClaims)
  : skeletonClaims;
```

Add local helper `mergeClaimsByTypeAndText` to preserve provider claims while filling missing skeleton types.

- [ ] **Step 3: Run pipeline tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 3: Render Capability Mapping In Catalog

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Write catalog mapping test**

Add a test that calls:

```ts
const files = buildCapabilityKnowledgeFiles({
  objects,
  capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
});
const catalog = files.find(file => file.path === 'catalog.yaml')?.content ?? '';
expect(catalog).toContain('capabilities:');
expect(catalog).toContain('CAP-DB-KNOWLEDGE-GENERATION:');
expect(catalog).toContain('view: views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
expect(catalog).toContain('objects:');
expect(catalog).toContain('- CAP-DB-KNOWLEDGE-GENERATION');
```

- [ ] **Step 2: Update catalog builder signature**

Change:

```ts
function buildCatalogYaml(objects: KnowledgeObject[]): string
```

to:

```ts
function buildCatalogYaml(objects: KnowledgeObject[], capabilityId: string): string
```

Render:

```yaml
capabilities:
  CAP-XXX:
    view: views/capabilities/CAP-XXX.md
    objects:
      - CAP-XXX
      - FLOW-XXX
```

- [ ] **Step 3: Pass capabilityId from `buildCapabilityKnowledgeFiles`**

Update catalog call:

```ts
content: buildCatalogYaml(objects, capabilityId),
```

- [ ] **Step 4: Run packaging tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 4: Add CLI Command

**Files:**
- Modify: `src/cli/index.ts` or existing CLI command registration file
- Optional Create: `src/cli/capability.ts` if command registration is split by file
- Test: integration test under `tests/integration/`

- [ ] **Step 1: Inspect CLI structure**

Run:

```powershell
Get-Content -Path .\src\cli\index.ts
Get-ChildItem -Path .\src\cli
```

Find where `generate`, `status`, and `clean` commands are registered.

- [ ] **Step 2: Add command parser only**

Add command:

```text
generate-capability [path]
```

Options:

```text
--terms <terms>
--paths <paths>
--out <out>
```

Parse comma-separated values with:

```ts
function parseCommaList(value?: string): string[] {
  return value
    ? value.split(',').map(item => item.trim()).filter(item => item.length > 0)
    : [];
}
```

CLI action should call a knowledge-layer function, not implement business logic in `cli/`.

- [ ] **Step 3: Add writer call**

In command action:

```ts
const result = await runCapabilityKnowledgePipeline({
  repoRoot: resolved.repoPath,
  targetTerms: parseCommaList(options.terms),
  targetPaths: parseCommaList(options.paths),
});

if (result.files.length === 0) {
  logger.warn('No capability knowledge files generated');
  return;
}

await writeCapabilityKnowledgePackage({
  outputRoot: options.out ? path.resolve(options.out) : resolved.repoPath,
  objects: result.objects,
  capabilityId: result.metadata.capabilityId,
});
```

If `runCapabilityKnowledgePipeline` currently returns only files, update its result to also return `objects`, or add a `writeFiles` function that writes returned descriptors. Prefer returning `objects` because `writeCapabilityKnowledgePackage` already accepts objects.

- [ ] **Step 4: Add integration smoke test**

Create an integration test that:

- builds or invokes the CLI in mock/no-LLM deterministic mode
- runs `generate-capability` against a temporary fixture repo
- asserts `bootstrap-knowledge/catalog.yaml` and `views/capabilities/*.md` are written

Use existing integration test patterns in `tests/integration/partial-failure.test.ts`.

## Task 5: Verify Local Tests And Build

**Files:**
- No additional files unless tests require fixtures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: pass.

## Task 6: Real Project Validation On `music-education-app`

**Files:**
- Generated files under `D:\workspace\other_project\music-education-app\bootstrap-knowledge`.

- [ ] **Step 1: Confirm real project exists**

Run:

```powershell
Get-ChildItem -Path D:\workspace\other_project\music-education-app
```

Expected: lists project files.

- [ ] **Step 2: Run capability generation**

From `D:\workspace\ai-wiki`, run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms db,mybatis,knowledge --paths src/main,src/test
```

If the project uses different source roots, inspect directories and rerun with correct paths, for example:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test
```

Expected: command exits successfully and writes `bootstrap-knowledge/`.

- [ ] **Step 3: Verify required files**

Run:

```powershell
Get-ChildItem -Path D:\workspace\other_project\music-education-app\bootstrap-knowledge -Recurse | Select-Object -ExpandProperty FullName
```

Expected includes:

```text
bootstrap-knowledge\catalog.yaml
bootstrap-knowledge\views\capabilities\CAP-*.md
bootstrap-knowledge\objects\capabilities\CAP-*.yaml
```

- [ ] **Step 4: Verify object type coverage**

Run:

```powershell
Get-ChildItem -Path D:\workspace\other_project\music-education-app\bootstrap-knowledge\objects -Directory | Select-Object -ExpandProperty Name
```

Expected includes at least five of:

```text
capabilities
flows
modules
contracts
validation
open
```

- [ ] **Step 5: Verify catalog capability mapping**

Run:

```powershell
Get-Content -Path D:\workspace\other_project\music-education-app\bootstrap-knowledge\catalog.yaml
```

Expected:

- `capabilities:` is not `{}`
- contains a `CAP-*` key
- contains `view: views/capabilities/CAP-*.md`
- contains object IDs under the capability

- [ ] **Step 6: Verify capability view references objects**

Run:

```powershell
Get-Content -Path (Get-ChildItem D:\workspace\other_project\music-education-app\bootstrap-knowledge\views\capabilities\*.md | Select-Object -First 1).FullName
```

Expected:

- has headings Purpose, Terms, Current Flow, Code Surface, Contracts, Validation, Unknowns
- references generated object IDs such as `CAP-*`, `FLOW-*`, `MOD-*`, `CON-*`, `VER-*`, `OPEN-*`

- [ ] **Step 7: Record validation result**

Final implementation response must include:

```text
Real project validated: D:\workspace\other_project\music-education-app
Command used:
Generated package path:
Generated capability ID:
Object types generated:
Catalog capability mapping: present / missing
Capability view object references: present / missing
```

## Self-Review Checklist

- Spec coverage: plan covers skeleton claims, pipeline fallback, catalog routing, CLI entry, tests, build, and real project validation.
- Placeholder scan: no task contains TBD/TODO/fill-in steps.
- Type consistency: `CandidateClaim`, `EvidenceBundle`, `KnowledgeObject`, and pipeline result names match existing source names.
- Scope control: no full repo auto-discovery, no SDD adapters, no unrelated DB generator rewrite.

