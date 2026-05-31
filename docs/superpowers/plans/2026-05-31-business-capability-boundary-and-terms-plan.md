# Business Capability Boundary And Terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `generate-capability` produce business-named, term-rich capability knowledge for the real `music-education-app` project instead of technical `MyBatis evidence processing` knowledge.

**Architecture:** Keep the existing deterministic pipeline. Add target term classification and business capability naming in `slicing`, add deterministic TERM claims in `generation`, preserve TERM metadata in `knowledge`, and clean the output package in `packaging` before writing.

**Tech Stack:** TypeScript strict mode, Node `fs/promises` and `path`, Vitest, CLI validation with `node dist/cli/index.js`, Windows PowerShell.

---

## Requirements

- Do not use `git worktree`.
- Do not move business logic into `src/cli/`.
- Do not make `generation/` write files.
- Do not introduce Java AST parser.
- Keep all non-OPEN knowledge objects evidence-backed.
- Validate on the real project: `D:\workspace\other_project\music-education-app`.
- Write real validation output to: `D:\tmp\music-education-app-capability-validation`.

## Files

- Modify: `src/slicing/capability-discovery.ts`
- Modify: `src/evidence/evidence-bundle-schema.ts`
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`
- Modify: `tests/unit/knowledge/capability-object-assembler.test.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Classify Business Terms And Technical Context Terms

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add failing unit tests for technical terms not driving capability name**

Add this test to `tests/unit/slicing/capability-discovery.test.ts`:

```ts
it('uses business terms rather than mybatis as the capability name', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'capability-business-name-'));
  await mkdir(join(repoRoot, 'src/main/java/com/demo/service/mall'), { recursive: true });
  await mkdir(join(repoRoot, 'src/main/resources/mapper'), { recursive: true });

  await writeFile(join(repoRoot, 'src/main/java/com/demo/service/mall/OrderGoodsService.java'), `
    package com.demo.service.mall;
    import org.springframework.stereotype.Service;
    @Service
    public class OrderGoodsService {
      public void checkProdStockAndCreateOrder() {}
      public void findById() {}
    }
  `);

  await writeFile(join(repoRoot, 'src/main/resources/mapper/OrderGoodsMapper.xml'), `
    <mapper namespace="com.demo.mapper.OrderGoodsMapper">
      <select id="selectOrderGoods" resultType="OrderGoods">select * from order_goods</select>
    </mapper>
  `);

  const candidates = await discoverCapabilities({
    repoRoot,
    targetTerms: ['course', 'goods', 'order', 'mybatis'],
    targetPaths: ['src/main/java', 'src/main/resources'],
  });

  expect(candidates).toHaveLength(1);
  expect(candidates[0]!.nameCandidates[0]).toMatch(/goods|order/i);
  expect(candidates[0]!.nameCandidates[0]).not.toMatch(/mybatis evidence processing/i);
});
```

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: fail because current implementation still returns `MyBatis evidence processing`.

- [ ] **Step 2: Add term classification helpers**

In `src/slicing/capability-discovery.ts`, add:

```ts
const TECHNICAL_CONTEXT_TERMS = new Set([
  'mybatis',
  'mapper',
  'xml',
  'sql',
  'db',
  'database',
  'table',
  'schema',
  'knowledge',
  'evidence',
  'capability',
  'bootstrap',
]);

function classifyTargetTerms(targetTerms: string[]): {
  businessTerms: string[];
  technicalTerms: string[];
  normalizedTerms: string[];
} {
  const normalizedTerms = normalizeTargetTerms(targetTerms);
  const businessTerms = normalizedTerms.filter(term => !TECHNICAL_CONTEXT_TERMS.has(term));
  const technicalTerms = normalizedTerms.filter(term => TECHNICAL_CONTEXT_TERMS.has(term));
  return { businessTerms, technicalTerms, normalizedTerms };
}

function titleCaseTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}
```

- [ ] **Step 3: Remove MyBatis hardcoded business name**

Replace the current name generation block:

```ts
if (targetTerms.includes('mybatis')) {
  nameCandidates.push('MyBatis evidence processing');
  if (!relatedTerms.includes('mybatis mapper')) {
    relatedTerms.push('mybatis mapper');
  }
}
```

with logic that keeps `mybatis mapper` only as a related technical term:

```ts
const { businessTerms, technicalTerms } = classifyTargetTerms(targetTerms);

if (technicalTerms.includes('mybatis') && !relatedTerms.includes('mybatis mapper')) {
  relatedTerms.push('mybatis mapper');
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: the new test may still fail until Task 2 adds business name derivation.

## Task 2: Derive Capability Name From Ranked Business Evidence

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add a test for evidence-weighted business naming**

Add:

```ts
it('prefers business terms that appear in high ranked evidence', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'capability-evidence-name-'));
  await mkdir(join(repoRoot, 'src/main/java/com/demo/aop'), { recursive: true });
  await mkdir(join(repoRoot, 'src/main/java/com/demo/service/mall'), { recursive: true });

  await writeFile(join(repoRoot, 'src/main/java/com/demo/aop/LogAop.java'), `
    package com.demo.aop;
    import org.springframework.stereotype.Component;
    @Component
    public class LogAop {
      public void log() {}
    }
  `);

  await writeFile(join(repoRoot, 'src/main/java/com/demo/service/mall/OrderGoodsService.java'), `
    package com.demo.service.mall;
    import org.springframework.stereotype.Service;
    @Service
    public class OrderGoodsService {
      public void createOrderWithGoods() {}
    }
  `);

  const candidates = await discoverCapabilities({
    repoRoot,
    targetTerms: ['course', 'goods', 'order', 'mybatis'],
    targetPaths: ['src/main/java'],
  });

  const candidate = candidates[0]!;
  expect(candidate.nameCandidates[0]).toMatch(/goods/i);
  expect(candidate.nameCandidates[0]).toMatch(/order/i);
  expect(candidate.nameCandidates[0]).not.toMatch(/log|aop|mybatis/i);
});
```

- [ ] **Step 2: Add helper to collect matched business term scores**

In `src/slicing/capability-discovery.ts`, add:

```ts
type RankedSignal = {
  targetRelevance?: number;
  matchedTerms?: string[];
  name?: string;
  location?: string;
};

function collectBusinessTermScores(signals: RankedSignal[], businessTerms: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const businessSet = new Set(businessTerms);

  for (const signal of signals) {
    const relevance = signal.targetRelevance ?? 0;
    for (const term of signal.matchedTerms ?? []) {
      if (!businessSet.has(term)) continue;
      scores.set(term, (scores.get(term) ?? 0) + Math.max(0.1, relevance));
    }
  }

  return scores;
}

function deriveBusinessCapabilityName(input: {
  businessTerms: string[];
  entrySignals: RankedSignal[];
  behaviorSignals: RankedSignal[];
  dataSignals: RankedSignal[];
  moduleSignals: RankedSignal[];
}): string {
  const scores = collectBusinessTermScores(
    [
      ...input.entrySignals,
      ...input.behaviorSignals,
      ...input.dataSignals,
      ...input.moduleSignals,
    ],
    input.businessTerms,
  );

  const rankedTerms = [...input.businessTerms].sort((left, right) => {
    const diff = (scores.get(right) ?? 0) - (scores.get(left) ?? 0);
    if (diff !== 0) return diff;
    return left.localeCompare(right);
  });

  const selectedTerms = rankedTerms
    .filter(term => (scores.get(term) ?? 0) > 0)
    .slice(0, 3);

  const termsForName = selectedTerms.length > 0 ? selectedTerms : input.businessTerms.slice(0, 3);
  if (termsForName.length === 0) {
    return 'Repository capability';
  }

  return `${termsForName.map(titleCaseTerm).join(' ')} capability`;
}
```

- [ ] **Step 3: Use the derived business name when building candidate**

In `discoverCapabilities()`, after signals are collected and sorted:

```ts
const { businessTerms, technicalTerms } = classifyTargetTerms(targetTerms);
const nameCandidates: string[] = [];
const relatedTerms: string[] = [...targetTerms];

const businessCapabilityName = deriveBusinessCapabilityName({
  businessTerms,
  entrySignals: primaryEntryPoints,
  behaviorSignals: behaviorAnchors,
  dataSignals: dataAnchors,
  moduleSignals: moduleClusters.map(cluster => ({
    targetRelevance: cluster.targetRelevance,
    matchedTerms: cluster.matchedTerms,
    name: cluster.rootPath,
    location: cluster.rootPath,
  })),
});

nameCandidates.push(businessCapabilityName);

if (technicalTerms.includes('mybatis') && !relatedTerms.includes('mybatis mapper')) {
  relatedTerms.push('mybatis mapper');
}
```

Remove the old `DB knowledge generation` and `MyBatis evidence processing` name branches. Keep technical phrases only in `relatedTerms`.

- [ ] **Step 4: Run discovery tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 3: Fix Windows Path Role Detection

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add a unit test for backslash paths**

Add a direct test for role-sensitive behavior by creating normal files and asserting the resulting location still assigns relevant role-driven ranking:

```ts
it('detects roles on Windows-style paths after normalization', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'capability-windows-role-'));
  await mkdir(join(repoRoot, 'src/main/java/com/demo/controller'), { recursive: true });
  await writeFile(join(repoRoot, 'src/main/java/com/demo/controller/OrderController.java'), `
    package com.demo.controller;
    import org.springframework.web.bind.annotation.RestController;
    @RestController
    public class OrderController {
      public void getOrder() {}
    }
  `);

  const candidates = await discoverCapabilities({
    repoRoot,
    targetTerms: ['order'],
    targetPaths: ['src/main/java'],
  });

  expect(candidates[0]!.primaryEntryPoints[0]!.role).toBe('controller');
  expect(candidates[0]!.behaviorAnchors[0]!.role).toBe('controller');
});
```

- [ ] **Step 2: Add path normalization helper**

In `src/slicing/capability-discovery.ts`, add:

```ts
function normalizePathForMatch(input: string): string {
  return input.replace(/\\/g, '/').toLowerCase();
}
```

- [ ] **Step 3: Replace role detection in behavior signals**

Replace:

```ts
const role = relative.includes('/controller/') ? 'controller' :
             relative.includes('/service/') ? 'service' :
             relative.includes('/mapper/') ? 'mapper' : undefined;
```

with:

```ts
const normalizedRelative = normalizePathForMatch(relative);
const role = normalizedRelative.includes('/controller/') ? 'controller' :
             normalizedRelative.includes('/service/') ? 'service' :
             normalizedRelative.includes('/mapper/') ? 'mapper' : undefined;
```

- [ ] **Step 4: Replace role detection in data signals**

Replace the data signal role block with:

```ts
const normalizedRelative = normalizePathForMatch(relative);
const role = normalizedRelative.includes('/controller/') ? 'controller' :
             normalizedRelative.includes('/service/') ? 'service' :
             normalizedRelative.includes('/mapper/') ? 'mapper' :
             normalizedRelative.includes('/entity/') ? 'entity' :
             normalizedRelative.includes('/dto/') ||
             normalizedRelative.includes('/vo/') ||
             normalizedRelative.includes('/request/') ||
             normalizedRelative.includes('/response/') ? 'dto' : undefined;
```

- [ ] **Step 5: Run discovery tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: pass.

## Task 4: Add Deterministic TERM Claims

**Files:**
- Modify: `src/evidence/evidence-bundle-schema.ts`
- Modify: `src/generation/capability-claim-generator.ts`
- Modify: `tests/unit/generation/capability-claim-generator.test.ts`

- [ ] **Step 1: Extend claim object hints for TERM metadata**

In `src/generation/capability-claim-generator.ts`, extend `objectHints` schema:

```ts
objectHints: z.object({
  canonicalTerm: z.string().optional(),
  subject: z.string().optional(),
  modulePath: z.string().optional(),
  contractKind: z.enum(['schema', 'sql', 'api', 'event', 'output']).optional(),
  termSource: z.enum(['target_term', 'evidence_match', 'data_contract']).optional(),
  matchedEvidenceCount: z.number().int().nonnegative().optional(),
}).optional(),
```

- [ ] **Step 2: Add a failing test for TERM claims**

Add to `tests/unit/generation/capability-claim-generator.test.ts`:

```ts
it('generates TERM claims from matched business evidence', () => {
  const bundle = makeBundle({
    capabilityHints: {
      nameCandidates: ['Goods Order capability'],
      relatedTerms: ['goods', 'order', 'mybatis mapper'],
    },
    entryPoints: [
      {
        ref: 'evidence://entry/EP-001',
        kind: 'service',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
        description: 'Spring service entry',
        targetRelevance: 0.75,
        matchedTerms: ['goods', 'order'],
      },
    ],
    behaviorSlices: [
      {
        ref: 'evidence://behavior/BEH-001',
        location: 'src/main/java/demo/OrderGoodsService.java',
        verb: 'create',
        object: 'order goods',
        targetRelevance: 0.75,
        matchedTerms: ['goods', 'order'],
      },
    ],
  });

  const claims = buildSkeletonClaims(bundle);
  const termClaims = claims.filter(claim => claim.suggestedType === 'TERM');

  expect(termClaims.map(claim => claim.objectHints?.canonicalTerm)).toEqual(expect.arrayContaining(['goods', 'order']));
  expect(termClaims.every(claim => claim.evidenceRefs.length > 0)).toBe(true);
  expect(termClaims.every(claim => claim.confidence !== 'low')).toBe(true);
});
```

Use the existing test helper pattern in this file. If there is no `makeBundle` helper with partial overrides, add one near the existing test fixtures.

- [ ] **Step 3: Implement TERM evidence collection helper**

In `src/generation/capability-claim-generator.ts`, add:

```ts
const TECHNICAL_TERM_HINTS = new Set([
  'mybatis',
  'mapper',
  'xml',
  'sql',
  'db',
  'database',
  'table',
  'schema',
  'knowledge',
  'evidence',
  'capability',
  'bootstrap',
]);

type TermEvidence = {
  term: string;
  refs: string[];
  count: number;
  source: 'target_term' | 'evidence_match' | 'data_contract';
};

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

function addTermEvidence(map: Map<string, TermEvidence>, term: string, ref: string, source: TermEvidence['source']): void {
  const normalized = normalizeTerm(term);
  if (!normalized || TECHNICAL_TERM_HINTS.has(normalized)) return;

  const current = map.get(normalized) ?? { term: normalized, refs: [], count: 0, source };
  if (!current.refs.includes(ref)) {
    current.refs.push(ref);
  }
  current.count += 1;
  map.set(normalized, current);
}

function collectTermEvidence(bundle: EvidenceBundle): TermEvidence[] {
  const terms = new Map<string, TermEvidence>();

  for (const item of [...bundle.entryPoints, ...bundle.behaviorSlices, ...bundle.dataContracts, ...bundle.validationAnchors]) {
    for (const term of item.matchedTerms ?? []) {
      addTermEvidence(terms, term, item.ref, 'evidence_match');
    }
  }

  for (const related of bundle.capabilityHints.relatedTerms) {
    const normalized = normalizeTerm(related);
    if (TECHNICAL_TERM_HINTS.has(normalized)) continue;
    const existingRef = [...terms.values()].find(item => item.refs.length > 0)?.refs[0];
    if (existingRef) {
      addTermEvidence(terms, normalized, existingRef, 'target_term');
    }
  }

  return [...terms.values()]
    .filter(item => item.refs.length > 0)
    .sort((left, right) => {
      const diff = right.count - left.count;
      if (diff !== 0) return diff;
      return left.term.localeCompare(right.term);
    })
    .slice(0, 8);
}
```

- [ ] **Step 4: Emit TERM claims in `buildSkeletonClaims()`**

After the CAP claim and before FLOW claim, add:

```ts
for (const termEvidence of collectTermEvidence(bundle)) {
  claims.push({
    suggestedType: 'TERM',
    claimText: `${termEvidence.term} is a business term evidenced within ${capabilityName}.`,
    confidence: 'medium',
    evidenceRefs: [termEvidence.refs[0]!],
    decisionPoints: ['business_vocabulary'],
    sddStageUses: ['requirement_clarification', 'requirement_specification', 'coding', 'review'],
    unsupportedParts: [],
    blockedDecisions: [],
    objectHints: {
      canonicalTerm: termEvidence.term,
      termSource: termEvidence.source,
      matchedEvidenceCount: termEvidence.count,
    },
  });
}
```

- [ ] **Step 5: Run generation tests**

Run:

```bash
npx vitest run tests/unit/generation/capability-claim-generator.test.ts
```

Expected: pass.

## Task 5: Preserve TERM Metadata In Knowledge Objects

**Files:**
- Modify: `src/knowledge/capability-object-assembler.ts`
- Modify: `tests/unit/knowledge/capability-object-assembler.test.ts`

- [ ] **Step 1: Add a failing test for TERM metadata**

Add:

```ts
it('preserves term metadata from claim object hints', () => {
  const bundle = makeBundle({
    capabilityHints: {
      nameCandidates: ['Goods Order capability'],
      relatedTerms: ['goods', 'order'],
    },
  });

  const objects = assembleCapabilityKnowledgeObjects({
    bundle,
    claims: [
      {
        suggestedType: 'TERM',
        claimText: 'goods is a business term evidenced within Goods Order capability.',
        confidence: 'medium',
        evidenceRefs: ['evidence://entry/EP-001'],
        decisionPoints: ['business_vocabulary'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          canonicalTerm: 'goods',
          termSource: 'evidence_match',
          matchedEvidenceCount: 2,
        },
      },
    ],
  });

  expect(objects).toHaveLength(1);
  expect(objects[0]!.id).toBe('TERM-GOODS');
  expect(objects[0]!.metadata).toMatchObject({
    canonicalTerm: 'goods',
    source: 'evidence_match',
    matchedEvidenceCount: 2,
  });
});
```

Adapt the fixture helper to the existing test file style.

- [ ] **Step 2: Replace TERM assembler branch**

In `src/knowledge/capability-object-assembler.ts`, replace the current TERM MVP branch with:

```ts
case 'TERM': {
  const canonicalTerm = claim.objectHints?.canonicalTerm || claim.claimText.slice(0, 30);
  obj = {
    id: makeObjectId('TERM', canonicalTerm),
    type: 'TERM',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      canonicalTerm,
      source: claim.objectHints?.termSource ?? 'evidence_match',
      matchedEvidenceCount: claim.objectHints?.matchedEvidenceCount ?? claim.evidenceRefs.length,
    },
  };
  break;
}
```

- [ ] **Step 3: Run assembler tests**

Run:

```bash
npx vitest run tests/unit/knowledge/capability-object-assembler.test.ts
```

Expected: pass.

## Task 6: Clean Existing bootstrap-knowledge Before Writing

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Add a failing writer cleanup test**

Add:

```ts
it('removes stale files from previous bootstrap-knowledge output before writing', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'capability-clean-output-'));
  const staleFile = join(outputRoot, 'bootstrap-knowledge', 'objects', 'contracts', 'CON-LOGAOP.yaml');
  await mkdir(dirname(staleFile), { recursive: true });
  await writeFile(staleFile, 'id: CON-LOGAOP\n');

  await writeCapabilityKnowledgePackage({
    outputRoot,
    capabilityId: 'CAP-GOODS-ORDER-CAPABILITY',
    objects: [
      {
        id: 'CAP-GOODS-ORDER-CAPABILITY',
        type: 'CAP',
        description: 'Goods Order capability',
        evidencePrimary: ['evidence://entry/EP-001'],
        evidenceSupporting: [],
        decisionPoints: ['matched_capability'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        metadata: { canonicalTerm: 'Goods Order capability' },
      },
    ],
    evidenceIndex: [
      {
        ref: 'evidence://entry/EP-001',
        kind: 'entry',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
      },
    ],
  });

  await expect(access(staleFile)).rejects.toThrow();
  await expect(access(join(outputRoot, 'bootstrap-knowledge', 'catalog.yaml'))).resolves.toBeUndefined();
});
```

Add needed imports from `fs/promises` and `path` if missing.

- [ ] **Step 2: Add safe package root resolver**

In `src/packaging/capability-knowledge-writer.ts`, add:

```ts
async function preparePackageRoot(outputRoot: string): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const packageRoot = path.resolve(outputRoot, 'bootstrap-knowledge');

  if (path.basename(packageRoot) !== 'bootstrap-knowledge') {
    throw new Error(`Refusing to clean invalid package root: ${packageRoot}`);
  }

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  return packageRoot;
}
```

- [ ] **Step 3: Use package root in writer**

Change `writeCapabilityKnowledgePackage()`:

```ts
const packageRoot = await preparePackageRoot(outputRoot);

for (const file of files) {
  const fullPath = path.join(packageRoot, file.path);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, file.content, 'utf-8');
}
```

- [ ] **Step 4: Run packaging tests**

Run:

```bash
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

## Task 7: Update Integration Fixture Expectations

**Files:**
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Update Java/Spring/MyBatis fixture test**

In the existing Java/MyBatis integration test, add expectations after command success:

```ts
const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf-8');
const viewFiles = await readdir(join(repo, 'bootstrap-knowledge', 'views', 'capabilities'));
const view = await readFile(join(repo, 'bootstrap-knowledge', 'views', 'capabilities', viewFiles[0]!), 'utf-8');

expect(catalog).not.toContain('CAP-MYBATIS-EVIDENCE-PROCESSING');
expect(catalog).toMatch(/CAP-.*(GOODS|ORDER|COURSE).*/);
expect(view).not.toContain('- (none)');
expect(view).toContain('TERM-');
```

- [ ] **Step 2: Add stale output assertion**

Before invoking the command in the fixture test, create a stale file under the fixture repo output:

```ts
const staleContract = join(repo, 'bootstrap-knowledge', 'objects', 'contracts', 'CON-LOGAOP.yaml');
await mkdir(dirname(staleContract), { recursive: true });
await writeFile(staleContract, 'id: CON-LOGAOP\n');
```

After command success:

```ts
await expect(access(staleContract)).rejects.toThrow();
```

- [ ] **Step 3: Run integration test**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 8: Full Local Verification

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

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Validation

**Files:**
- No source changes unless validation fails.

- [ ] **Step 1: Generate knowledge for the real project**

Run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

Expected:

```text
Generated ... files for capability: CAP-...
Object types: CAP, TERM, FLOW, MOD, CON, VER, OPEN
```

The generated capability must not be:

```text
CAP-MYBATIS-EVIDENCE-PROCESSING
```

- [ ] **Step 2: Inspect catalog and capability view**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\*.md
```

Expected:

- catalog capability id contains a business term such as `GOODS`, `ORDER`, or `COURSE`.
- view `Terms` section lists TERM object IDs.
- view does not show `- (none)` under `Terms`.

- [ ] **Step 3: Inspect evidence index**

Run:

```bash
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\evidence\index.jsonl | Select-Object -First 80
```

Expected:

- top evidence includes business entries such as `OrderGoodsService`, `GoodsService`, `OrderController`, `CourseController`, `CourseService`, or mapper/XML evidence.
- `LogAop` and `RateLimitAspect` are not top primary evidence.

- [ ] **Step 4: Check forbidden stale and technical names**

Run:

```bash
rg -n "MYBATIS-EVIDENCE-PROCESSING|MyBatis evidence processing|CON-LOGAOP|MOD-SRC-MAIN-JAVA" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge
```

Expected:

```text
no matches
```

- [ ] **Step 5: Check business terms are present**

Run:

```bash
rg -n "TERM-|Course|Goods|Order|goods|order|course" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge
```

Expected:

- At least two TERM object references.
- At least one of `Goods`, `Order`, or `Course` appears in CAP/FLOW/MOD/CON/VER/evidence.

- [ ] **Step 6: Verify all primary evidence refs exist**

Run this PowerShell command:

```powershell
$root = "D:\tmp\music-education-app-capability-validation\bootstrap-knowledge"
$indexRefs = Get-Content "$root\evidence\index.jsonl" | ForEach-Object { ($_ | ConvertFrom-Json).ref }
$objectRefs = rg -o "evidence://[A-Za-z0-9/.-]+" "$root\objects" | ForEach-Object { ($_ -split ":", 2)[1] }
$missing = $objectRefs | Where-Object { $_ -notin $indexRefs } | Sort-Object -Unique
if ($missing) { $missing; exit 1 } else { "all evidence refs resolved" }
```

Expected:

```text
all evidence refs resolved
```

## Task 10: Final Review Checklist

**Files:**
- Review changed files only.

- [ ] **Step 1: Confirm architecture boundaries**

Check:

- `src/cli/` only parses command/options and calls pipeline.
- `src/generation/` does not write files.
- `src/packaging/` owns file writing and package cleanup.
- external data shape changes are schema-validated.

- [ ] **Step 2: Confirm no unrelated generated artifacts are staged**

Run:

```bash
git status --short
```

Expected:

- source/test/docs changes are intentional.
- generated `bootstrap-knowledge/` under `D:\workspace\ai-wiki` is not included unless explicitly required.
- temporary validation output under `D:\tmp` is not in git.

- [ ] **Step 3: Prepare final implementation report**

The final response must include:

```text
Generated capability:
Capability name contains technical-only term: yes/no
TERM objects:
Selected FLOW evidence:
Selected CON evidence:
Selected MOD evidence:
Stale LogAop object remains: yes/no
Evidence refs verified: yes/no
Real project command:
```

