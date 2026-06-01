# Full Capability Knowledge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quickly generate one usable Markdown knowledge set for the main business capabilities in `music-education-app`.

**Architecture:** Reuse the existing single capability pipeline. Add a thin full-capability wrapper that feeds a fixed MVP inventory into the existing pipeline repeatedly, then merges outputs into one package.

**Tech Stack:** TypeScript, existing CLI, existing capability discovery/evidence/LLM/object writer, real Java/Spring/MyBatis project validation.

---

## Hard Verification Rule

Do not write unit test code.

Verification is only:

```powershell
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-mvp --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Then inspect generated Markdown.

## Task 1: Add MVP Inventory

**Files:**
- Create: `src/slicing/capability-mvp-inventory.ts`

- [ ] **Step 1: Create static inventory type and data**

Create:

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
      targetTerms: ['goods', 'search'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/GoodsController.java',
        'src/main/java/com/education/music/app/service/mall/GoodsService.java',
        'src/main/resources/mappers/GoodsMapper.xml',
      ],
    },
    {
      id: 'cart-management',
      name: '购物车管理',
      targetTerms: ['cart'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/CartController.java',
        'src/main/java/com/education/music/app/service/mall/CartService.java',
        'src/main/resources/mappers/CartMapper.xml',
      ],
    },
    {
      id: 'order-management',
      name: '订单管理',
      targetTerms: ['order'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/OrderController.java',
        'src/main/java/com/education/music/app/service/mall/OrderService.java',
        'src/main/resources/mappers/OrderMapper.xml',
      ],
    },
    {
      id: 'payment-callback',
      name: '支付与回调',
      targetTerms: ['pay', 'payment', 'order'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/OrderController.java',
        'src/main/java/com/education/music/app/controller/PayUnkController.java',
        'src/main/java/com/education/music/app/service/pay',
      ],
    },
    {
      id: 'coupon-usage',
      name: '优惠券领取与使用',
      targetTerms: ['coupon'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/CouponController.java',
        'src/main/java/com/education/music/app/service/mall/CouponService.java',
      ],
    },
    {
      id: 'teach-content',
      name: '教学内容浏览',
      targetTerms: ['teach', 'course'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/TeachController.java',
        'src/main/java/com/education/music/app/controller/NoLoginTeachController.java',
        'src/main/java/com/education/music/app/service/teach/TeachService.java',
      ],
    },
    {
      id: 'course-schedule',
      name: '课程安排',
      targetTerms: ['course', 'timetable', 'class'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/TeacherController.java',
        'src/main/java/com/education/music/app/controller/ClassController.java',
        'src/main/java/com/education/music/app/service/user/TeacherService.java',
        'src/main/java/com/education/music/app/service/user/ClassService.java',
      ],
    },
    {
      id: 'record-submission',
      name: '录音提交与作品管理',
      targetTerms: ['record'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/RecordController.java',
        'src/main/java/com/education/music/app/service/teach/RecordService.java',
      ],
    },
    {
      id: 'record-grading',
      name: '录音评分',
      targetTerms: ['record', 'score'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/RecordController.java',
        'src/main/java/com/education/music/app/controller/TeacherController.java',
        'src/main/java/com/education/music/app/service/teach/RecordService.java',
      ],
    },
    {
      id: 'user-auth-profile',
      name: '用户登录与资料',
      targetTerms: ['user'],
      targetPaths: [
        'src/main/java/com/education/music/app/controller/UserController.java',
        'src/main/java/com/education/music/app/service/user/UserService.java',
      ],
    },
  ];
}
```

- [ ] **Step 2: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 2: Add Full MVP Pipeline

**Files:**
- Create: `src/knowledge/full-capability-mvp-pipeline.ts`
- Modify: `src/knowledge/capability-knowledge-pipeline.ts` only if needed to reuse existing result types.

- [ ] **Step 1: Create pipeline wrapper**

Create `runFullCapabilityMvpPipeline`:

```ts
import { buildCapabilityMvpInventory } from '../slicing/capability-mvp-inventory.js';
import {
  runCapabilityKnowledgePipeline,
  type CapabilityClaimsProviderResult,
} from './capability-knowledge-pipeline.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';

export interface FullCapabilityMvpResult {
  files: Array<{ path: string; content: string }>;
  report: {
    mode: 'full-mvp';
    succeeded: number;
    failed: number;
    capabilities: Array<{
      id: string;
      name: string;
      status: 'succeeded' | 'failed';
      capabilityId?: string;
      error?: string;
    }>;
  };
}

export async function runFullCapabilityMvpPipeline(input: {
  repoRoot: string;
  claimsProvider: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  model?: string;
}): Promise<FullCapabilityMvpResult> {
  const inventory = buildCapabilityMvpInventory();
  const allFiles: Array<{ path: string; content: string }> = [];
  const capabilities: FullCapabilityMvpResult['report']['capabilities'] = [];

  for (const item of inventory) {
    try {
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoRoot,
        targetTerms: item.targetTerms,
        targetPaths: item.targetPaths,
        claimsProvider: input.claimsProvider,
        llmMode: { requested: true, required: true, model: input.model },
      });

      for (const file of result.files) {
        if (file.path === 'catalog.yaml') continue;
        if (file.path === 'reports/capability-generation.json') {
          allFiles.push({
            path: `reports/capabilities/${item.id}.json`,
            content: file.content,
          });
          continue;
        }
        if (file.path.startsWith('debug/')) {
          allFiles.push({
            path: `debug/${item.id}/${file.path.replace(/^debug\//, '')}`,
            content: file.content,
          });
          continue;
        }
        allFiles.push(file);
      }

      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'succeeded',
        capabilityId: result.metadata.capabilityId,
      });
    } catch (error) {
      capabilities.push({
        id: item.id,
        name: item.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    mode: 'full-mvp' as const,
    succeeded: capabilities.filter(c => c.status === 'succeeded').length,
    failed: capabilities.filter(c => c.status === 'failed').length,
    capabilities,
  };

  allFiles.push({
    path: 'reports/capability-inventory.json',
    content: JSON.stringify({ inventory, report }, null, 2) + '\n',
  });

  return { files: allFiles, report };
}
```

- [ ] **Step 2: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 3: Route No-Target Capability Generation To MVP Full Pipeline

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/packaging/knowledge-package-contribution.ts` if the existing contribution type needs report details only.

- [ ] **Step 1: Import MVP pipeline**

In `src/cli/generate.ts`:

```ts
import { runFullCapabilityMvpPipeline } from '../knowledge/full-capability-mvp-pipeline.js';
```

- [ ] **Step 2: Branch inside runCapability**

After `claimsProvider` is created, before current single pipeline call:

```ts
const legacySingleRequested = targetTerms.length > 0 || targetPaths.length > 0;
const targetSingleRequested = input.scope.target?.kind === 'capability';
const fullCapabilityRequested = !legacySingleRequested && !targetSingleRequested;

if (fullCapabilityRequested) {
  const full = await runFullCapabilityMvpPipeline({
    repoRoot: input.repoPath,
    claimsProvider,
    model: capResolvedConfig.model,
  });

  return {
    stage: 'capability',
    files: full.files,
    objects: [],
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
    warnings: full.report.capabilities
      .filter(c => c.status === 'failed')
      .map(c => `${c.id}: ${c.error}`),
  };
}
```

Leave existing single pipeline unchanged for target/legacy filters.

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 4: Make Catalog Useful Enough

**Files:**
- Modify: `src/packaging/knowledge-package-writer.ts`
- Modify: `src/knowledge/full-capability-mvp-pipeline.ts`

- [ ] **Step 1: Add a generated catalog file from MVP pipeline**

In `runFullCapabilityMvpPipeline`, after report:

```ts
const catalog = {
  version: 1,
  generation: {
    knowledge: 'capability',
    capability_scope: 'full-mvp',
  },
  capabilities: Object.fromEntries(
    capabilities.map(c => [c.id, {
      name: c.name,
      status: c.status,
      capability_id: c.capabilityId ?? null,
      error: c.error ?? null,
    }]),
  ),
  reports: {
    inventory: 'reports/capability-inventory.json',
  },
};

allFiles.push({
  path: 'catalog.yaml',
  content: YAML.stringify(catalog),
});
```

Import YAML:

```ts
import YAML from 'yaml';
```

- [ ] **Step 2: Preserve catalog override**

In `writeKnowledgePackage`, if a contribution contains `catalog.yaml`, write it instead of the default minimal catalog.

Implementation:

```ts
const catalogFile = input.contributions
  .flatMap(contribution => contribution.files)
  .find(file => file.path === 'catalog.yaml');

if (catalogFile) {
  await fs.writeFile(path.join(packageRoot, 'catalog.yaml'), catalogFile.content, 'utf-8');
} else {
  await fs.writeFile(path.join(packageRoot, 'catalog.yaml'), YAML.stringify(catalog), 'utf-8');
}
```

Also change the file-writing skip:

```ts
if (file.path === 'catalog.yaml' || file.path === 'reports/generation.json') continue;
```

This remains okay because catalog was already written.

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

## Task 5: Real Project Validation

**Files:**
- Modify source based on Markdown failures.

- [ ] **Step 1: Run real generation**

Run:

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-mvp --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- command completes
- output directory exists

- [ ] **Step 2: Count views**

Run:

```powershell
Get-ChildItem D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\views\capabilities -Filter *.md | Select-Object Name
```

Expected:

- at least 6 Markdown files
- names represent business capabilities, not every Controller method

- [ ] **Step 3: Inspect catalog**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\catalog.yaml
```

Expected:

- `capability_scope: full-mvp`
- multiple capabilities listed
- failures listed if any

- [ ] **Step 4: Inspect inventory report**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\reports\capability-inventory.json
```

Expected:

- includes static inventory
- includes succeeded/failed status for each ability

- [ ] **Step 5: Read generated Markdown**

Open at least:

```powershell
Get-Content D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\views\capabilities\*.md
```

Check:

- It says what the business ability is.
- It has code anchors.
- It has validation or unknowns.
- It is not just a generic code summary.

If fewer than 6 abilities succeed, inspect failed reports, adjust target terms/paths, rebuild, and rerun.

## Task 6: README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document full MVP behavior**

Add:

```md
## 业务功能知识

生成全量业务功能知识：

```bash
rkg generate <repo> --knowledge capability
```

生成单个业务功能知识：

```bash
rkg generate <repo> --knowledge capability --target capability:order
```

当前 MVP 会按主要业务域聚合生成多个 capability Markdown，并通过真实项目生成结果验证可用性。
```

- [ ] **Step 2: Final validation**

Run:

```powershell
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-mvp --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

- build succeeds
- generation succeeds
- at least 6 useful Markdown capability views generated
