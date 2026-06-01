# Capability Routing And Package Organization Spec

## 背景

用户检查真实生成目录：

```text
D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge
```

发现知识组织混乱。实际输出只有一个泛化能力：

```text
capabilities/CAP-REPOSITORY-CAPABILITY.md
views/capabilities/CAP-REPOSITORY-CAPABILITY.md
objects/capabilities/CAP-REPOSITORY-CAPABILITY.yaml
```

`reports/generation.json` 显示：

```json
{
  "knowledge": "capability",
  "target": null,
  "capabilityGenerationMode": "single",
  "selectedCandidateId": "CAND-"
}
```

主 Markdown 标题为：

```md
# Repository capability
```

这不是业务能力知识，而是全仓库泛化总结。它把 mall、teach、user、news、pet、common 等多个业务域揉成一个能力，无法指导 Agent 做真实需求归因、改动定位和验证计划。

## 根因

### 1. 无 target 时仍走单能力 pipeline

文件：`src/cli/generate.ts`

当前逻辑：

```ts
const capTerms = input.scope.target?.kind === 'capability' ? [input.scope.target.value] : targetTerms;
const capPaths = targetPaths.length > 0 ? targetPaths : ['src'];

result = await runCapabilityKnowledgePipeline({
  repoRoot: input.repoPath,
  targetTerms: capTerms,
  targetPaths: capPaths,
  claimsProvider,
  llmMode: { requested: true, required: true, model: capResolvedConfig.model },
});
```

当命令为：

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability
```

且没有 `--target`、`--terms`、`--paths` 时：

```ts
capTerms = []
capPaths = ['src']
```

这会让单能力 pipeline 以整个 `src` 为范围生成一个能力。

### 2. discovery 对无业务词候选回退到 Repository capability

文件：`src/slicing/capability-discovery.ts`

当前逻辑：

```ts
if (termsForName.length === 0) {
  return 'Repository capability';
}
```

所以无 target、无业务词时，最终产生：

```text
CAP-REPOSITORY-CAPABILITY
```

### 3. evidence bundle 放大了错误候选

文件：`src/evidence/capability-evidence-builder.ts`

当前 `buildEvidenceBundle()` 会直接映射候选中的：

```text
entryPoints
behaviorSlices
dataContracts
validationAnchors
moduleSurfaces
docs
```

对于全仓库候选，这会把所有 Controller、Service、VO/DTO、API contract、Test anchor 放入 LLM prompt。LLM 只能输出泛化的“数据管理能力”。

### 4. catalog 没有明确主阅读入口

文件：`src/packaging/knowledge-package-writer.ts`

当前 `catalog.yaml` 主要列出 `objects`：

```yaml
objects:
  CAP-REPOSITORY-CAPABILITY:
    type: CAP
    path: objects/capabilities/CAP-REPOSITORY-CAPABILITY.yaml
```

但 MVP 设计已经把主阅读入口改为：

```text
bootstrap-knowledge/capabilities/*.md
```

catalog 没有明确区分：

- 主阅读文档
- 兼容 view
- 内部对象
- evidence/debug/report

因此用户看到的包结构仍然像“对象调试产物”，不是“业务能力知识包”。

## 目标

修正 capability 生成的路由与包结构：

1. `--knowledge capability` 无 target 时不能再生成 `CAP-REPOSITORY-CAPABILITY`。
2. 无 target 时必须走多业务能力生成，或明确报错要求指定 target。
3. MVP 选择多业务能力生成：基于固定 inventory 生成多个 `capabilities/*.md`。
4. 单能力生成仍支持：

```powershell
--knowledge capability --target capability:order
--knowledge capability --target order
--knowledge capability --terms order
--knowledge capability --paths src/main/java/.../OrderController.java
```

5. `catalog.yaml` 必须明确 `capabilities/*.md` 是主阅读入口。
6. `objects/**`、`evidence/**`、`debug/**` 必须被标注为内部溯源/调试材料，不应作为默认阅读入口。
7. 单能力 evidence 必须按 target 收窄，避免全仓库证据进入 LLM prompt。

## 命令语义

### 全能力生成

```powershell
rkg generate <repo> --knowledge capability
```

含义：

- 生成多个主要业务能力 Markdown。
- 使用固定 MVP inventory。
- 每个 inventory item 调用现有单能力 pipeline。
- 单个能力失败不阻断其他能力。
- 最终 package 中不允许出现 `CAP-REPOSITORY-CAPABILITY`。

### 单能力生成

```powershell
rkg generate <repo> --knowledge capability --target order
rkg generate <repo> --knowledge capability --target capability:order
```

含义：

- 只生成 order 相关能力文档。
- target terms 和 target paths 必须传入 discovery/evidence。
- debug request 不应包含全仓库 Controller/Test/DTO。

### 旧筛选参数

```powershell
rkg generate <repo> --knowledge capability --terms goods,search
rkg generate <repo> --knowledge capability --paths src/main/java/.../GoodsController.java
```

含义：

- 走单能力 pipeline。
- 不触发 full inventory。

## 固定 MVP Inventory

新增或复用文件：

```text
src/slicing/capability-mvp-inventory.ts
```

至少包含：

```text
goods-browse-search        商品浏览与搜索
cart-management            购物车管理
order-management           订单管理
payment-callback           支付与回调
coupon-usage               优惠券领取与使用
teach-content              教学内容浏览
course-schedule            课程安排
record-submission          录音提交与作品管理
record-grading             录音评分
user-auth-profile          用户登录与资料
```

每个 item 必须包含：

```ts
id: string;
name: string;
targetTerms: string[];
targetPaths: string[];
```

Inventory 是 MVP 方案，不是最终自动聚类方案。它的职责是防止无 target 时退化为 repository-level capability。

## 多能力 Pipeline

新增或复用文件：

```text
src/knowledge/full-capability-mvp-pipeline.ts
```

职责：

1. 读取 `buildCapabilityMvpInventory()`。
2. 对每个 item 调用 `runCapabilityKnowledgePipeline()`。
3. 传入 item 的 `targetTerms` 和 `targetPaths`。
4. 收集每个能力的 files。
5. 跳过每个单能力产生的 `catalog.yaml`。
6. 将每个 `reports/capability-generation.json` 改写到：

```text
reports/capabilities/<inventory-id>.json
```

7. 将每个 debug 文件改写到：

```text
debug/capabilities/<inventory-id>/
```

8. 生成：

```text
reports/capability-inventory.json
```

9. 单个能力失败时记录失败并继续。
10. 如果所有能力都失败，命令失败。

## 输出包结构

推荐输出：

```text
bootstrap-knowledge/
├── catalog.yaml
├── capabilities/
│   ├── goods-browse-search.md
│   ├── cart-management.md
│   ├── order-management.md
│   └── ...
├── views/
│   └── capabilities/
│       └── ...                 # 兼容入口，可与 capabilities 内容一致
├── objects/
│   └── ...                     # 内部结构化对象，非默认阅读入口
├── evidence/
│   └── index.jsonl             # 溯源索引
├── reports/
│   ├── generation.json
│   ├── capability-inventory.json
│   └── capabilities/
└── debug/
    └── capabilities/
```

如果实现复杂度较高，`objects/` 可以继续保留在根目录，但 catalog 必须标明它是 internal/supporting，不是 primary docs。

## catalog.yaml 要求

`catalog.yaml` 应包含：

```yaml
version: 1

entry:
  summary: bootstrap-knowledge is a generated capability knowledge package for coding agents.
  primary_docs:
    - capabilities/*.md
  compatibility_views:
    - views/capabilities/*.md
  supporting_material:
    objects: objects/**
    evidence: evidence/index.jsonl
    reports: reports/**
    debug: debug/**
  agent_must:
    - read matching capabilities/*.md before planning capability changes
    - use evidence refs for key claims
    - stop when unknown boundaries block implementation or validation

generation:
  knowledge: capability
  target: null
  mode: full-mvp

capabilities:
  goods-browse-search:
    name: 商品浏览与搜索
    status: succeeded
    primary_doc: capabilities/goods-browse-search.md
    compatibility_view: views/capabilities/CAP-....md
    report: reports/capabilities/goods-browse-search.json
```

单能力生成时：

```yaml
generation:
  mode: single
  target:
    kind: capability
    value: order
```

## Evidence Scope 要求

单能力 generation 的 prompt 不应包含全仓库证据。

`src/evidence/capability-evidence-builder.ts` 应做限制：

- `entryPoints` 只保留 target 相关和高相关。
- `behaviorSlices` 保留高相关，最多 12 条。
- `dataContracts` 保留高相关，最多 80 条。
- `validationAnchors` 保留 target 相关，最多 40 条。
- `moduleSurfaces` 保留高相关，最多 10 条。
- `docs` 保留 target 相关，最多 20 条。

建议阈值：

```text
targetRelevance >= 0.5
```

如果某类证据全部被过滤为空，可保留 top N 作为 fallback，但必须很小：

```text
entryPoints top 8
dataContracts top 20
validationAnchors top 10
```

对 `--target order`，debug request 不应出现大量无关：

```text
TeachController
RecordController
UserControllerTest
BannerVO
PetService
```

除非它们确实被 order 证据引用。

## 失败保护

以下情况必须失败或降级为明确 warning，不能静默成功：

1. 生成出的 capabilityId 是 `CAP-REPOSITORY-CAPABILITY`。
2. `selectedCandidateId` 是空壳 `CAND-`。
3. 无 target 单能力模式被触发。
4. full inventory 所有能力都失败。
5. 单能力 prompt 证据超过合理上限且包含低相关全仓库内容。

## 验收标准

### 全能力命令

运行：

```powershell
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-md-model --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

必须满足：

1. 不生成 `CAP-REPOSITORY-CAPABILITY.md`。
2. `bootstrap-knowledge/capabilities/` 下至少有 6 个业务能力 Markdown。
3. capability 文件名或 catalog key 是业务能力名，而不是 repository。
4. `catalog.yaml` 有 `entry.primary_docs`。
5. `reports/capability-inventory.json` 记录每个 inventory item 的成功/失败。
6. 单个失败能力不阻断其他能力。

### 单能力命令

运行：

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-scoped --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

必须满足：

1. 生成的是 order 相关能力，不是 repository capability。
2. debug request 聚焦 order，不包含大量 teach/record/user/pet/common 证据。
3. 主 Markdown 位于 `capabilities/*.md`。
4. catalog 指向该主 Markdown。
5. validation section 不为空。

## 非目标

- 不实现自动业务聚类。
- 不实现完整 maps 层。
- 不删除当前对象 assembler。
- 不让 LLM 直接写 Markdown。
- 不重写 LangGraph runtime。
- 不在本轮解决 DB 知识生成。

## 完成报告要求

实现完成后报告：

```text
Changed files:
Full capability command:
Generated full docs root:
Generated capability markdown count:
Catalog primary_docs:
Inventory report:
Single order command:
Order debug request scope:
Repository capability absence:
Remaining gaps:
```
