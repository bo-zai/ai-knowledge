# Capability Routing And Package Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `--knowledge capability` from generating a generic `Repository capability`, route no-target generation to multiple business capabilities, and make `capabilities/*.md` the clear primary knowledge entry.

**Architecture:** Keep the existing single capability pipeline for targeted generation. Add a full-MVP wrapper for no-target generation, tighten evidence scoping, and update catalog/package metadata so generated Markdown is organized around business capabilities rather than internal object files.

**Tech Stack:** TypeScript, existing CLI orchestration, existing capability discovery/evidence/LLM pipeline, YAML catalog writer, Vitest where existing tests cover package writing, real `music-education-app` generation for acceptance.

---

## File Structure

- Modify: `src/cli/generate.ts`
  - Branch no-target capability generation away from the single pipeline.

- Create or update: `src/slicing/capability-mvp-inventory.ts`
  - Defines fixed MVP business capabilities for `music-education-app` style projects.

- Create or update: `src/knowledge/full-capability-mvp-pipeline.ts`
  - Runs the existing single capability pipeline once per inventory item and merges files/reports/debug.

- Modify: `src/evidence/capability-evidence-builder.ts`
  - Caps and filters evidence included in a single capability bundle.

- Modify: `src/packaging/knowledge-package-writer.ts`
  - Writes catalog with primary docs, compatibility views, supporting material, and capability routing.

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
  - Adds guardrails against repository-level fallback success.

- Modify existing tests only if needed:
  - `tests/unit/cli/generate-orchestration.test.ts`
  - `tests/unit/packaging/capability-knowledge-writer.test.ts`

## Task 1: Add Or Confirm MVP Inventory

**Files:**
- Create or modify: `src/slicing/capability-mvp-inventory.ts`

- [ ] **Step 1: Create inventory type and data**

If the file does not exist, create it. If it exists, update it to match this shape:

```ts
export interface CapabilityMvpInventoryItem {
  id: string;
  name: string;
  targetTerms: string[];
  targetPaths: string[];
}

export function buildCapabilityMvpInventory(): CapabilityMvpInventoryItem[] {
  return [
    {
      id: 'goods-browse-search',
      name: '商品浏览与搜索',
      targetTerms: ['goods', 'search', 'search history'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/GoodsController.java',
        'src/main/java/com/education/music/app/service/mall/GoodsService.java',
        'src/main/java/com/education/music/app/service/mall/SearchHistoryService.java',
        'src/main/resources/mappers/GoodsMapper.xml',
        'src/main/resources/mappers/SearchHistoryMapper.xml',
      ],
    },
    {
      id: 'cart-management',
      name: '购物车管理',
      targetTerms: ['cart', 'checkout'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/CartController.java',
        'src/main/java/com/education/music/app/service/mall/CartService.java',
        'src/main/resources/mappers/CartMapper.xml',
      ],
    },
    {
      id: 'order-management',
      name: '订单管理',
      targetTerms: ['order', 'order goods', 'order submit'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/OrderController.java',
        'src/main/java/com/education/music/app/service/mall/OrderService.java',
        'src/main/java/com/education/music/app/service/mall/OrderGoodsService.java',
        'src/main/resources/mappers/OrderMapper.xml',
        'src/main/resources/mappers/OrderGoodsMapper.xml',
      ],
    },
    {
      id: 'payment-callback',
      name: '支付与回调',
      targetTerms: ['pay', 'payment', 'alipay', 'wxpay', 'callback', 'notify'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/OrderController.java',
        'src/main/java/com/education/music/app/controller/PayUnkController.java',
        'src/main/java/com/education/music/app/entity/DTO/alipay',
      ],
    },
    {
      id: 'coupon-usage',
      name: '优惠券领取与使用',
      targetTerms: ['coupon', 'coupon user', 'coupon verify'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/CouponController.java',
        'src/main/java/com/education/music/app/service/mall/CouponService.java',
        'src/main/java/com/education/music/app/service/mall/CouponUserService.java',
        'src/main/java/com/education/music/app/service/mall/CouponVerifyService.java',
      ],
    },
    {
      id: 'teach-content',
      name: '教学内容浏览',
      targetTerms: ['teach', 'course', 'course template', 'video'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/TeachController.java',
        'src/main/java/com/education/music/app/controller/NoLoginTeachController.java',
        'src/main/java/com/education/music/app/service/teach/TeachService.java',
        'src/main/java/com/education/music/app/service/teach/CourseService.java',
      ],
    },
    {
      id: 'course-schedule',
      name: '课程安排',
      targetTerms: ['course', 'timetable', 'class', 'teacher', 'student'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/TeacherController.java',
        'src/main/java/com/education/music/app/controller/ClassController.java',
        'src/main/java/com/education/music/app/service/user/TeacherService.java',
        'src/main/java/com/education/music/app/service/user/ClassService.java',
        'src/main/java/com/education/music/app/service/teach/CourseService.java',
      ],
    },
    {
      id: 'record-submission',
      name: '录音提交与作品管理',
      targetTerms: ['record', 'upload', 'works'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/RecordController.java',
        'src/main/java/com/education/music/app/service/teach/RecordService.java',
      ],
    },
    {
      id: 'record-grading',
      name: '录音评分',
      targetTerms: ['record', 'score', 'grade'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/RecordController.java',
        'src/main/java/com/education/music/app/controller/TeacherController.java',
        'src/main/java/com/education/music/app/service/teach/RecordService.java',
      ],
    },
    {
      id: 'user-auth-profile',
      name: '用户登录与资料',
      targetTerms: ['user', 'login', 'profile', 'vcode', 'wx login'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/UserController.java',
        'src/main/java/com/education/music/app/service/user/UserService.java',
      ],
    },
  ];
}
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS or only import-related errors to fix in later tasks.

## Task 2: Add Full Capability MVP Pipeline

**Files:**
- Create or modify: `src/knowledge/full-capability-mvp-pipeline.ts`

- [ ] **Step 1: Create wrapper result types**

Create or update:

```ts
import { buildCapabilityMvpInventory } from '../slicing/capability-mvp-inventory.js';
import {
  runCapabilityKnowledgePipeline,
  type CapabilityClaimsProviderResult,
} from './capability-knowledge-pipeline.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import type { KnowledgePackageFile, KnowledgePackageObjectRef } from '../packaging/knowledge-package-contribution.js';

export interface FullCapabilityMvpCapabilityReport {
  id: string;
  name: string;
  status: 'succeeded' | 'failed';
  capabilityId?: string;
  primaryDoc?: string;
  compatibilityView?: string;
  objectCount?: number;
  error?: string;
}

export interface FullCapabilityMvpResult {
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: {
    mode: 'full-mvp';
    succeeded: number;
    failed: number;
    capabilities: FullCapabilityMvpCapabilityReport[];
  };
  warnings: string[];
}
```

- [ ] **Step 2: Add file path rewrite helper**

Append:

```ts
function rewriteFullCapabilityFilePath(path: string, inventoryId: string): string | undefined {
  if (path === 'catalog.yaml') return undefined;
  if (path === 'reports/generation.json') return undefined;
  if (path === 'reports/capability-generation.json') {
    return `reports/capabilities/${inventoryId}.json`;
  }
  if (path.startsWith('debug/')) {
    return `debug/capabilities/${inventoryId}/${path.replace(/^debug\//, '')}`;
  }
  return path;
}
```

- [ ] **Step 3: Add main wrapper function**

Append:

```ts
export async function runFullCapabilityMvpPipeline(input: {
  repoRoot: string;
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  model?: string;
}): Promise<FullCapabilityMvpResult> {
  const inventory = buildCapabilityMvpInventory();
  const files: KnowledgePackageFile[] = [];
  const objects: KnowledgePackageObjectRef[] = [];
  const capabilities: FullCapabilityMvpCapabilityReport[] = [];
  const warnings: string[] = [];

  for (const item of inventory) {
    try {
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoRoot,
        targetTerms: item.targetTerms,
        targetPaths: item.targetPaths,
        claimsProvider: input.claimsProvider,
        llmMode: { requested: true, required: true, model: input.model },
      });

      const primaryDoc = result.files.find(file => file.path.startsWith('capabilities/') && file.path.endsWith('.md'))?.path;
      const compatibilityView = result.files.find(file => file.path.startsWith('views/capabilities/') && file.path.endsWith('.md'))?.path;

      for (const file of result.files) {
        const rewritten = rewriteFullCapabilityFilePath(file.path, item.id);
        if (!rewritten) continue;
        files.push({ path: rewritten, content: file.content });
      }

      objects.push(...result.objects.map(obj => ({
        id: obj.id,
        type: obj.type,
        path: `objects/${obj.type.toLowerCase()}/${obj.id}.yaml`,
      })));

      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'succeeded',
        capabilityId: result.metadata.capabilityId,
        primaryDoc,
        compatibilityView,
        objectCount: result.objects.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${item.id}: ${message}`);
      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'failed',
        error: message,
      });
    }
  }

  const succeeded = capabilities.filter(c => c.status === 'succeeded').length;
  const failed = capabilities.filter(c => c.status === 'failed').length;

  if (succeeded === 0) {
    throw new Error(`Full capability MVP generation failed for all ${inventory.length} capabilities`);
  }

  const report = {
    mode: 'full-mvp' as const,
    succeeded,
    failed,
    capabilities,
  };

  files.push({
    path: 'reports/capability-inventory.json',
    content: JSON.stringify({ inventory, report }, null, 2) + '\n',
  });

  return { files, objects, report, warnings };
}
```

- [ ] **Step 4: Typecheck**

Run:

```powershell
npm run typecheck
```

Expected: fix any path/type import issues without introducing `any`.

## Task 3: Route No-Target CLI To Full Pipeline

**Files:**
- Modify: `src/cli/generate.ts`

- [ ] **Step 1: Import full pipeline**

Add:

```ts
import { runFullCapabilityMvpPipeline } from '../knowledge/full-capability-mvp-pipeline.js';
```

- [ ] **Step 2: Detect full capability request**

Inside `runCapability`, after `claimsProvider` is created and before computing `capTerms/capPaths`, add:

```ts
const targetSingleRequested = input.scope.target?.kind === 'capability';
const legacySingleRequested = targetTerms.length > 0 || targetPaths.length > 0;
const fullCapabilityRequested = !targetSingleRequested && !legacySingleRequested;
```

- [ ] **Step 3: Add full pipeline branch**

Before the existing single-pipeline `try`, add:

```ts
if (fullCapabilityRequested) {
  const full = await runFullCapabilityMvpPipeline({
    repoRoot: input.repoPath,
    claimsProvider,
    model: capResolvedConfig.model,
  });

  console.log(`Generated ${full.report.succeeded} capability documents (${full.report.failed} failed)`);

  return {
    stage: 'capability',
    files: full.files,
    objects: full.objects,
    report: {
      stage: 'capability',
      ran: true,
      succeeded: full.report.succeeded,
      failed: full.report.failed,
      details: {
        capabilityGenerationMode: 'full-mvp',
        capabilities: full.report.capabilities,
      },
    },
    warnings: full.warnings,
  };
}
```

- [ ] **Step 4: Keep single pipeline target behavior**

Leave existing code for:

```ts
const capTerms = input.scope.target?.kind === 'capability' ? [input.scope.target.value] : targetTerms;
const capPaths = targetPaths.length > 0 ? targetPaths : ['src'];
```

but it is now only reachable for target or legacy single requests.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: PASS.

## Task 4: Guard Against Repository Capability Success

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`

- [ ] **Step 1: Add guard helper**

Near helper functions, add:

```ts
function isRepositoryFallbackCapability(capabilityId: string, candidateId?: string): boolean {
  return capabilityId === 'CAP-REPOSITORY-CAPABILITY' || candidateId === 'CAND-';
}
```

- [ ] **Step 2: Reject fallback after capabilityId is known**

After:

```ts
const capabilityId = capObject?.id || 'UNKNOWN-CAPABILITY';
```

add:

```ts
if (isRepositoryFallbackCapability(capabilityId, topCandidate.candidateId)) {
  throw new CapabilityKnowledgeGenerationError(
    'Capability generation failed: repository-level fallback capability is not a valid business capability',
    buildCapabilityKnowledgeFiles({
      objects,
      capabilityId,
      evidenceIndex: buildEvidenceIndexFromBundle(bundle),
      report: {
        mode: 'llm',
        capabilityGenerationMode: 'single',
        selectedCandidateId: topCandidate.candidateId,
        candidateCount: candidates.length,
        llmRequested: true,
        llmRequired: true,
        llmCalled,
        llmSucceeded: false,
        llmRuntime: 'langgraph',
        model: llmMode.model,
        claimCounts: {
          llmRaw: rawClaimCount,
          llmAccepted: acceptedClaimCount,
          skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
          final: finalClaimCount,
        },
        warnings: ['Repository fallback capability is not a valid business capability'],
      },
      debug: providerDebug,
    }),
  );
}
```

If variables are not in scope at this exact location, move the guard to the nearest point where `objects`, `capabilityId`, `bundle`, `topCandidate`, claim counts, and debug are all available.

- [ ] **Step 3: Typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

## Task 5: Scope Evidence Bundle

**Files:**
- Modify: `src/evidence/capability-evidence-builder.ts`

- [ ] **Step 1: Add relevance helpers**

Add near `byEvidenceRelevance`:

```ts
const MIN_RELEVANCE = 0.5;

function hasTargetRelevance(item: { targetRelevance?: number }): boolean {
  return (item.targetRelevance ?? 0) >= MIN_RELEVANCE;
}

function topRelevant<T extends { targetRelevance?: number }>(
  items: T[],
  limit: number,
  fallbackLimit: number,
): T[] {
  const sorted = [...items].sort(byEvidenceRelevance);
  const relevant = sorted.filter(hasTargetRelevance).slice(0, limit);
  if (relevant.length > 0) return relevant;
  return sorted.slice(0, fallbackLimit);
}
```

- [ ] **Step 2: Apply limits in `buildEvidenceBundle`**

Change:

```ts
const entryPoints = mapEntrySignals(candidate.primaryEntryPoints);
const behaviorSlices = mapBehaviorSignals(candidate.behaviorAnchors);
const dataContracts = mapDataSignals(candidate.dataAnchors);
const validationAnchors = mapTestSignals(candidate.testAnchors);
const moduleSurfaces = mapModuleClusters(candidate.moduleClusters);
const docs = mapDocSignals(candidate.docAnchors);
```

to:

```ts
const scopedEntries = topRelevant(candidate.primaryEntryPoints, 30, 8);
const scopedBehaviors = topRelevant(candidate.behaviorAnchors, 12, 6);
const scopedData = topRelevant(candidate.dataAnchors, 80, 20);
const scopedTests = topRelevant(candidate.testAnchors, 40, 10);
const scopedModules = topRelevant(candidate.moduleClusters, 10, 4);
const scopedDocs = topRelevant(candidate.docAnchors, 20, 5);

const entryPoints = mapEntrySignals(scopedEntries);
const behaviorSlices = mapBehaviorSignals(scopedBehaviors);
const dataContracts = mapDataSignals(scopedData);
const validationAnchors = mapTestSignals(scopedTests);
const moduleSurfaces = mapModuleClusters(scopedModules);
const docs = mapDocSignals(scopedDocs);
```

- [ ] **Step 3: Ensure API contracts are scoped through entry points**

Leave:

```ts
const apiContracts = mapHttpEntryPointsToApiContracts(entryPoints);
```

This ensures API contracts are derived only from scoped entry points.

- [ ] **Step 4: Typecheck and build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both PASS.

## Task 6: Catalog Primary Docs

**Files:**
- Modify: `src/packaging/knowledge-package-writer.ts`

- [ ] **Step 1: Collect primary docs**

Before `const catalog`, add:

```ts
const files = input.contributions.flatMap(contribution => contribution.files);
const primaryCapabilityDocs = files
  .filter(file => file.path.startsWith('capabilities/') && file.path.endsWith('.md'))
  .map(file => file.path)
  .sort();
const compatibilityViews = files
  .filter(file => file.path.startsWith('views/capabilities/') && file.path.endsWith('.md'))
  .map(file => file.path)
  .sort();
```

- [ ] **Step 2: Add entry section to catalog**

In `catalog`, add:

```ts
entry: {
  summary: 'bootstrap-knowledge is a generated capability knowledge package for coding agents.',
  primary_docs: primaryCapabilityDocs,
  compatibility_views: compatibilityViews,
  supporting_material: {
    objects: 'objects/**',
    evidence: 'evidence/index.jsonl',
    reports: 'reports/**',
    debug: 'debug/**',
  },
  agent_must: [
    'read matching capabilities/*.md before planning capability changes',
    'use evidence refs for key claims',
    'stop when unknown boundaries block implementation or validation',
  ],
},
```

- [ ] **Step 3: Add capability docs list**

Add to catalog:

```ts
capability_docs: primaryCapabilityDocs,
```

- [ ] **Step 4: Avoid duplicate `files` variable**

The existing file writing loop uses:

```ts
for (const contribution of input.contributions) {
```

No change needed except do not shadow `files` inside that block.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: PASS.

## Task 7: Tests And Compile Checks

**Files:**
- Modify existing tests only if failures show stale assumptions.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run targeted packaging tests**

Run:

```powershell
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: PASS. If it fails because catalog now has `entry.primary_docs`, update expected catalog assertions to include the new entry.

- [ ] **Step 4: Run generate orchestration tests**

Run:

```powershell
npx vitest run tests/unit/cli/generate-orchestration.test.ts
```

Expected: PASS. If it fails because no-target capability now uses full mode, update the expectation to `capabilityGenerationMode: full-mvp`.

## Task 8: Real Full Capability Validation

**Files:**
- No source edits unless validation fails.

- [ ] **Step 1: Build CLI**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run full capability generation**

Run:

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-md-model --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 3: Confirm no repository capability**

Run:

```powershell
Get-ChildItem D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge -Recurse -Filter *REPOSITORY-CAPABILITY*
```

Expected: no files.

- [ ] **Step 4: Count primary docs**

Run:

```powershell
Get-ChildItem D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\capabilities -Filter *.md | Select-Object Name
```

Expected: at least 6 Markdown files.

- [ ] **Step 5: Read catalog**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\catalog.yaml
```

Expected:

```text
entry:
primary_docs:
capabilities/*.md entries
supporting_material:
```

- [ ] **Step 6: Read inventory report**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\reports\capability-inventory.json
```

Expected:

```text
Each inventory item has succeeded or failed status.
At least 6 succeeded.
```

## Task 9: Real Single Capability Scope Validation

**Files:**
- No source edits unless validation fails.

- [ ] **Step 1: Run order generation**

Run:

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-scoped --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 2: Confirm not repository capability**

Run:

```powershell
Get-ChildItem D:\tmp\music-education-app-capability-order-scoped\bootstrap-knowledge -Recurse -Filter *REPOSITORY-CAPABILITY*
```

Expected: no files.

- [ ] **Step 3: Inspect debug request scope**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-order-scoped\bootstrap-knowledge\debug\capability-llm-request.json
```

Expected:

```text
Contains OrderController or OrderService evidence.
Does not contain broad unrelated TeachController, RecordController, PetController, and many unrelated UserControllerTest entries.
```

- [ ] **Step 4: Read generated order Markdown**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-order-scoped\bootstrap-knowledge\capabilities\*.md
```

Expected:

```text
Document describes an order-related capability.
Code anchors are order-related.
Validation section is not empty.
Unknown boundaries are explicit if evidence is missing.
```

## Task 10: Final Verification

**Files:**
- No source edits unless verification fails.

- [ ] **Step 1: Run required project checks**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all PASS.

- [ ] **Step 2: Final report**

Report:

```text
Changed files:
Full command:
Full generated root:
Primary capability doc count:
Catalog primary_docs:
Inventory report status:
Single order command:
Order debug scope findings:
Repository capability absence:
Commands run:
Remaining gaps:
```

## Self-Review

- Spec coverage:
  - No-target routing is covered by Task 3.
  - Full inventory generation is covered by Tasks 1 and 2.
  - Repository fallback guard is covered by Task 4.
  - Evidence scoping is covered by Task 5.
  - Catalog organization is covered by Task 6.
  - Compile/test checks are covered by Task 7.
  - Real full and single validations are covered by Tasks 8 and 9.

- Placeholder scan:
  - The plan contains concrete file paths, commands, and expected results.

- Type consistency:
  - `FullCapabilityMvpResult`, `FullCapabilityMvpCapabilityReport`, `CapabilityMvpInventoryItem`, and `runFullCapabilityMvpPipeline()` are defined before use.
