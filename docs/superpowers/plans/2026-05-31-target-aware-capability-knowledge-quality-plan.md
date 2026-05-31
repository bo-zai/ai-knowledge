# Target-Aware Capability Knowledge Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated capability knowledge align with target business terms on the real `music-education-app` project, and add an evidence index so object refs are traceable.

**Architecture:** Add target-aware scoring in `slicing`, sort evidence before bundling, select skeleton claims from ranked evidence, split module surfaces more finely, and write `evidence/index.jsonl` alongside objects and views. Keep the pipeline deterministic and AI-first.

**Tech Stack:** TypeScript strict mode, Node fs/path, Vitest, JSONL evidence index, Windows PowerShell validation.

---

## Requirements

- Do not use git worktree.
- Do not add Java AST parser.
- Do not make CLI contain business logic.
- Keep non-OPEN objects evidence-backed.
- Validate with `D:\workspace\other_project\music-education-app`.
- Write validation output to `D:\tmp\music-education-app-capability-validation`.

## Files

- Modify: `src/slicing/capability-candidate-schema.ts`
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `src/evidence/evidence-bundle-schema.ts`
- Modify: `src/evidence/capability-evidence-builder.ts`
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`
- Modify: `tests/unit/evidence/capability-evidence-builder.test.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Add Relevance Fields To Signal Schemas

**Files:**
- Modify: `src/slicing/capability-candidate-schema.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Extend signal schemas**

Add optional fields to `EntrySignalSchema`, `BehaviorSignalSchema`, `DataSignalSchema`, `TestSignalSchema`, and `ModuleClusterSchema`:

```ts
targetRelevance: z.number().min(0).max(1).optional(),
matchedTerms: z.array(z.string()).optional(),
role: z.string().optional(),
```

If `role` does not fit all schemas, add it only to `ModuleClusterSchema` and signal schemas where useful.

- [ ] **Step 2: Update existing tests**

Existing fixtures should still parse without these fields.

- [ ] **Step 3: Run schema tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 2: Implement Target Relevance Scoring

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add tests for ranking target business signals above AOP**

Create a fixture with:

```text
src/main/java/com/demo/aop/LogAop.java
src/main/java/com/demo/aop/RateLimitAspect.java
src/main/java/com/demo/controller/CourseController.java
src/main/java/com/demo/service/CourseService.java
src/main/java/com/demo/mapper/CourseMapper.java
src/main/resources/mapper/CourseMapper.xml
```

Call:

```ts
const candidates = await discoverCapabilities({
  repoRoot,
  targetTerms: ['course', 'mybatis'],
  targetPaths: ['src/main/java', 'src/main/resources'],
});
```

Assert:

```ts
const candidate = candidates[0]!;
expect(candidate.behaviorAnchors[0]?.location.toLowerCase()).toContain('course');
expect(candidate.dataAnchors[0]?.location.toLowerCase()).toContain('course');
expect(candidate.moduleClusters[0]?.rootPath.toLowerCase()).toMatch(/course|mapper|service|controller/);
expect(candidate.behaviorAnchors[0]?.location.toLowerCase()).not.toContain('aop');
```

- [ ] **Step 2: Add scoring helpers**

Implement:

```ts
const CROSS_CUTTING_TERMS = [
  'aop',
  'aspect',
  'config',
  'interceptor',
  'filter',
  'util',
  'utils',
  'common',
  'job',
  'listener',
  'event',
  'bootstrap',
  'security',
  'auth',
  'logging',
  'log',
  'ratelimit',
  'rate-limit',
];

function normalizeTargetTerms(targetTerms: string[]): string[] {
  return [...new Set(targetTerms.flatMap(normalizeCapabilityTerms).map(term => term.toLowerCase()))];
}

function textForRelevance(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').replace(/\\/g, '/').toLowerCase();
}

function computeTargetRelevance(parts: Array<string | undefined>, targetTerms: string[]): {
  score: number;
  matchedTerms: string[];
} {
  const text = textForRelevance(parts);
  const normalizedTargets = normalizeTargetTerms(targetTerms);
  const matchedTerms = normalizedTargets.filter(term => text.includes(term));
  const base = normalizedTargets.length === 0 ? 0 : matchedTerms.length / normalizedTargets.length;
  const roleBoost =
    /controller|service|mapper|xml|request|response|vo|dto|entity/.test(text) ? 0.25 : 0;
  const crossCutPenalty = CROSS_CUTTING_TERMS.some(term => text.includes(term)) ? 0.45 : 0;
  const score = Math.max(0, Math.min(1, base + roleBoost - crossCutPenalty));
  return { score, matchedTerms };
}
```

- [ ] **Step 3: Apply scoring to signals**

When creating each signal, include:

```ts
const relevance = computeTargetRelevance([relative, name, className, routeSignature], targetTerms);
targetRelevance: relevance.score,
matchedTerms: relevance.matchedTerms,
```

Apply to:

- entry signals
- behavior signals
- data signals
- test signals
- module clusters

- [ ] **Step 4: Sort signals**

Before building the candidate, sort arrays:

```ts
function byRelevanceDesc<T extends { targetRelevance?: number; location?: string }>(left: T, right: T): number {
  const scoreDiff = (right.targetRelevance ?? 0) - (left.targetRelevance ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (left.location ?? '').localeCompare(right.location ?? '');
}
```

Use:

```ts
primaryEntryPoints.sort(byRelevanceDesc);
behaviorAnchors.sort(byRelevanceDesc);
dataAnchors.sort(byRelevanceDesc);
testAnchors.sort(byRelevanceDesc);
moduleClusters.sort(byRelevanceDesc);
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 3: Split Module Surfaces More Finely

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add test that MOD is not whole `src/main/java` when target business files exist**

Assert:

```ts
expect(candidate.moduleClusters[0]?.rootPath).not.toBe('src/main/java');
expect(candidate.moduleClusters[0]?.rootPath.toLowerCase()).toMatch(/controller|service|mapper|course/);
```

- [ ] **Step 2: Group module clusters by role/path**

Replace `analyzeModuleClusters` whole-target behavior with grouping by meaningful roots:

```ts
function deriveModuleRoot(relativeFile: string): string {
  const normalized = relativeFile.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const roleIndex = parts.findIndex(part =>
    ['controller', 'service', 'mapper', 'repository', 'dao', 'resources', 'test'].includes(part.toLowerCase())
  );
  if (roleIndex >= 0) {
    return parts.slice(0, roleIndex + 1).join('/');
  }
  return parts.slice(0, Math.min(parts.length - 1, 4)).join('/');
}
```

Build clusters per derived root, then score each cluster with files and module names.

- [ ] **Step 3: Keep top relevant clusters**

Limit module clusters to top 8 after relevance sort.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 4: Sort Evidence Bundle Before Truncation

**Files:**
- Modify: `src/evidence/evidence-bundle-schema.ts`
- Modify: `src/evidence/capability-evidence-builder.ts`
- Modify: `tests/unit/evidence/capability-evidence-builder.test.ts`

- [ ] **Step 1: Add optional relevance fields to evidence schemas**

Add to evidence schemas where applicable:

```ts
targetRelevance: z.number().min(0).max(1).optional(),
matchedTerms: z.array(z.string()).optional(),
sourceLocation: z.string().optional(),
```

- [ ] **Step 2: Map relevance from candidate signals**

In mapping functions, preserve:

```ts
targetRelevance: signal.targetRelevance,
matchedTerms: signal.matchedTerms,
sourceLocation: signal.location,
```

- [ ] **Step 3: Sort before slice**

In `mapBehaviorSignals`, `mapDataSignals`, `mapTestSignals`, `mapModuleClusters`, sort by `targetRelevance` before applying limits.

- [ ] **Step 4: Flow traces should use top-ranked behavior anchors**

`buildFlowTraces()` should use already sorted `candidate.behaviorAnchors.slice(0, 3)`.

- [ ] **Step 5: Run evidence tests**

Run:

```bash
npx vitest run tests/unit/evidence/capability-evidence-builder.test.ts
```

Expected: pass.

## Task 5: Skeleton Claims Use Ranked Evidence

**Files:**
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Add test that skeleton claims avoid AOP when ranked business evidence exists**

Create an `EvidenceBundle` where:

- first unranked-looking input includes AOP and Course
- Course evidence has higher `targetRelevance`
- AOP has low or zero relevance

Assert generated CON/FLOW/MOD claims reference Course/Mapper evidence refs, not AOP refs.

- [ ] **Step 2: Add helper to pick best evidence**

Implement:

```ts
function byEvidenceRelevance<T extends { targetRelevance?: number; ref: string }>(items: T[]): T | undefined {
  return [...items].sort((left, right) => {
    const scoreDiff = (right.targetRelevance ?? 0) - (left.targetRelevance ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return left.ref.localeCompare(right.ref);
  })[0];
}
```

- [ ] **Step 3: Replace `[0]` access**

Replace:

```ts
bundle.flowTraces[0]
bundle.moduleSurfaces[0]
bundle.dataContracts[0]
bundle.validationAnchors[0]
```

with `byEvidenceRelevance(...)`.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 6: Add Evidence Index Output

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Define evidence index item type**

In packaging writer:

```ts
export interface EvidenceIndexItem {
  ref: string;
  kind: string;
  location?: string;
  name?: string;
  summary?: string;
  targetRelevance?: number;
  matchedTerms?: string[];
}
```

- [ ] **Step 2: Build evidence index from bundle**

Add function in `capability-knowledge-pipeline.ts` or evidence builder:

```ts
function buildEvidenceIndex(bundle: EvidenceBundle): EvidenceIndexItem[] {
  return [
    ...bundle.entryPoints.map(item => ({ ref: item.ref, kind: 'entry', location: item.location, name: item.name, summary: item.description, targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
    ...bundle.behaviorSlices.map(item => ({ ref: item.ref, kind: 'behavior', location: item.location, name: `${item.verb} ${item.object}`, summary: item.summary, targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
    ...bundle.dataContracts.map(item => ({ ref: item.ref, kind: 'contract', location: item.location, name: item.name, summary: item.description, targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
    ...bundle.moduleSurfaces.map(item => ({ ref: item.ref, kind: 'module', location: item.rootPath, name: item.rootPath, summary: item.responsibilities.join('; '), targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
    ...bundle.validationAnchors.map(item => ({ ref: item.ref, kind: 'validation', location: item.location, name: item.name, summary: item.assertion ?? item.oracle, targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
    ...bundle.flowTraces.map(item => ({ ref: item.ref, kind: 'flow', name: 'flow trace', summary: item.steps.map(step => step.action).join(' -> '), targetRelevance: item.targetRelevance, matchedTerms: item.matchedTerms })),
  ];
}
```

- [ ] **Step 3: Extend pipeline result**

Add:

```ts
evidenceIndex: EvidenceIndexItem[];
```

to `RunCapabilityKnowledgePipelineResult`.

- [ ] **Step 4: Extend writer input**

Update:

```ts
buildCapabilityKnowledgeFiles({ objects, capabilityId, evidenceIndex })
writeCapabilityKnowledgePackage({ outputRoot, objects, capabilityId, evidenceIndex })
```

Generate:

```text
evidence/index.jsonl
```

Content:

```ts
evidenceIndex.map(item => JSON.stringify(item)).join('\n') + '\n'
```

- [ ] **Step 5: Add tests**

Assert:

```ts
files.some(file => file.path === 'evidence/index.jsonl')
```

and every non-OPEN object evidence ref exists in the index.

- [ ] **Step 6: Run packaging and pipeline tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts
```

Expected: pass.

## Task 7: Strengthen Java/MyBatis Integration Fixture

**Files:**
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add AOP before Course in fixture**

In Java integration fixture, create:

```text
src/main/java/com/demo/aop/LogAop.java
src/main/java/com/demo/aop/RateLimitAspect.java
```

before creating Course files.

Run command:

```bash
node dist/cli/index.js generate-capability <repo> --terms course,mybatis --paths src/main/java,src/main/resources,src/test
```

Assert generated catalog/view/object content does not choose `LOGAOP` or `RATELIMIT` as primary FLOW/CON.

- [ ] **Step 2: Assert evidence index exists**

In integration test:

```ts
const evidenceIndex = await readFile(join(repo, 'bootstrap-knowledge', 'evidence', 'index.jsonl'), 'utf8');
expect(evidenceIndex).toContain('Course');
expect(evidenceIndex.toLowerCase()).toContain('mapper');
```

- [ ] **Step 3: Run integration test**

Run:

```bash
npm run build
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 8: Local Verification

**Files:**
- No new files expected.

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

- [ ] **Step 3: Focused tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts tests/unit/evidence/capability-evidence-builder.test.ts tests/unit/generation/capability-claim-generator.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts tests/integration/generate-capability.test.ts
```

Expected: pass.

- [ ] **Step 4: Full tests**

Run:

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Validation

**Files:**
- Generated output under `D:\tmp\music-education-app-capability-validation`.

- [ ] **Step 1: Run real project command**

Run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

Expected:

- command exits 0
- generated capability package exists

- [ ] **Step 2: Inspect catalog and view**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
Get-Content (Get-ChildItem D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\*.md | Select-Object -First 1).FullName
```

Expected:

- capability routing present
- view references CAP/FLOW/MOD/CON/VER/OPEN

- [ ] **Step 3: Inspect selected objects**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects\flows\*.yaml
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects\contracts\*.yaml
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects\modules\*.yaml
```

Expected:

- at least one selected FLOW/CON/MOD references Course, Goods, Order, Mapper, or MyBatis XML evidence
- `LogAop` and `RateLimitAspect` are not selected as primary FLOW or CON for the target command

- [ ] **Step 4: Inspect evidence index**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\evidence\index.jsonl
```

Expected:

- contains refs used by generated non-OPEN objects
- contains source locations
- contains Course/Goods/Order/Mapper related evidence

- [ ] **Step 5: Final response**

Claude Code final response must include:

```text
Real project validated: D:\workspace\other_project\music-education-app
Command used:
Generated capability:
Selected FLOW evidence:
Selected CON evidence:
Selected MOD evidence:
Evidence index path:
AOP selected as primary: yes/no
Tests:
```

## Self-Review Checklist

- Spec coverage: ranking/filtering, module splitting, evidence sorting, skeleton selection, evidence index, tests, real validation.
- Placeholder scan: no TBD/TODO/fill-in steps.
- Type consistency: relevance fields must flow from signals to evidence to skeleton claims to evidence index.
- Scope control: no AST parser, no full repo clustering, no SDD adapter.

