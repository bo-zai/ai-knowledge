# Full Capability Knowledge Generation Spec

## 背景

当前 `generate --knowledge capability` 已经能为一个 target 生成单个业务能力知识包，但它不是全量业务功能知识生成。

当前链路：

```text
src/cli/generate.ts
-> src/knowledge/generate-scope.ts
-> src/knowledge/generate-orchestrator.ts
-> src/knowledge/capability-knowledge-pipeline.ts
-> src/slicing/capability-discovery.ts
-> src/evidence/capability-evidence-builder.ts
-> src/generation/capability-claim-generator.ts
-> src/knowledge/capability-object-assembler.ts
-> src/packaging/capability-knowledge-writer.ts
-> src/packaging/knowledge-package-writer.ts
```

核心限制：

- `capability-knowledge-pipeline.ts` 只选择最高分一个候选能力。
- `capability-discovery.ts` 当前把全仓库信号聚合成一个 `CapabilityCandidate`。
- 没有 Domain -> Capability -> Scenario -> Entry -> Code Anchor 层级。
- 没有生成预算、候选评分、合并规则和全局对象复用。
- 最终 `catalog.yaml` 缺少 `activation`、`maps`、capability 分组、对象依赖、风险和 stale 信息。
- 验证不能只看命令成功，必须看真实生成的 Markdown 是否能帮助 Agent 理解和规划。

## 目标

为 `D:\workspace\other_project\music-education-app` 生成全量业务功能知识。

全量不是按 Controller、接口、Service、Mapper 或方法逐个生成文档，而是先从代码中发现业务能力，再按业务粒度合并、评分、筛选和生成知识。

目标输出：

```text
bootstrap-knowledge/
├── catalog.yaml
├── maps/
│   ├── repo-map.md
│   ├── module-map.yaml
│   └── entrypoints.yaml
├── objects/
│   ├── capabilities/
│   ├── terms/
│   ├── flows/
│   ├── contracts/
│   ├── modules/
│   ├── validation/
│   └── open/
├── views/
│   └── capabilities/
├── evidence/
│   └── index.jsonl
└── reports/
    ├── generation.json
    └── capability-inventory.json
```

## 非目标

- 不按每个 Controller 方法生成 `CAP`。
- 不生成几千个 Markdown。
- 不写任何单元测试代码作为本轮验证手段。
- 不把 LLM 作为结构决策者；LLM 只生成对象内容。
- 不要求第一版覆盖所有边缘接口，先覆盖高价值业务能力。

## 命令行为

复用现有参数语义：

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-full-capability-knowledge --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

兼容现有模式：

```bash
node dist/cli/index.js generate <repo> --knowledge capability --target capability:order
```

规则：

- `--knowledge capability` 且没有 `--target` 时，执行全量业务能力发现和多能力生成。
- `--knowledge capability --target capability:<name>` 时，执行单能力生成。
- 旧参数 `--terms` / `--paths` 继续作为兼容入口，等价于带过滤条件的单能力生成；后续应逐步降级为 deprecated。
- 不新增 `--capability-mode`，避免命令面出现与 `--target` 重叠的模式开关。

## 能力粒度

业务能力层级：

```text
Domain
└── Capability
    └── Scenario
        └── Entry
            └── Code Anchor
```

`music-education-app` 示例能力：

```text
商城
├── 商品浏览与搜索
├── 购物车管理
├── 优惠券领取与使用
├── 订单创建
├── 订单支付
├── 订单退款
└── 地址管理

教学
├── 教学内容浏览
├── 课程安排
├── 课件学习
├── 录音提交
└── 评分与学习记录

用户
├── 登录注册
├── 用户资料
└── 签到积分

外部系统
├── 支付回调
├── OSS 上传回调
└── 文件转码
```

允许第一版输出 10-30 个能力。低价值候选进入 `maps/` 和 `evidence/`，不提升为 `CAP`。

## 能力发现

新增 capability inventory 阶段。

输入：

- Controller routes
- Service classes and method calls
- Mapper XML statements
- DO / Req / VO / DTO fields
- package/domain names
- docs under `doc/`
- existing `.knowledge/lbug` graph if available

输出：

```ts
interface CapabilityInventory {
  repoRoot: string;
  generatedAt: string;
  domains: BusinessDomain[];
  candidates: CapabilityInventoryCandidate[];
  rejectedCandidates: RejectedCapabilityCandidate[];
  budget: CapabilityGenerationBudget;
}
```

候选结构：

```ts
interface CapabilityInventoryCandidate {
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
```

评分：

```ts
interface CapabilityScore {
  requirementLikelihood: number;
  businessSemantics: number;
  changeSurfaceSize: number;
  riskLevel: number;
  validationValue: number;
  ambiguityRisk: number;
  total: number;
}
```

## 合并与预算

默认预算：

```ts
interface CapabilityGenerationBudget {
  maxCapabilities: number;          // 30
  maxObjectsPerCapability: number;  // 8
  maxTotalObjects: number;          // 180
  minCapabilityScore: number;       // 0.65
  mergeIfSharedModulesAbove: number;// 0.60
  mergeIfSharedTermsAbove: number;  // 0.70
}
```

合并规则：

- 共享同一业务目标、核心术语、主要模块和验证方式的候选能力必须合并。
- 多个 Controller route 可以属于一个 capability 的多个 scenarios。
- Mapper SQL、Service method、helper method 不直接提升为 capability。
- 搜索历史写入默认是商品浏览与搜索能力下的 flow，只有它有独立需求价值时才提升为独立 capability。

## 证据组装

每个保留的 capability candidate 生成一个 `EvidenceBundle`。

全局还要生成：

- `maps/repo-map.md`
- `maps/module-map.yaml`
- `maps/entrypoints.yaml`
- 全局 `evidence/index.jsonl`

证据必须包含足够让 LLM 生成真实业务对象的上下文：

- entry route and handler
- Controller -> Service
- Service -> Mapper
- Mapper SQL table and fields
- request fields
- response/VO fields if relevant
- side effects
- failure branches if evidenced
- validation anchors or `cannot_verify_without`

## 对象生成

每个 capability 通常生成：

- `CAP`
- `FLOW`
- `CON`
- `MOD`
- `VER`
- `OPEN` if needed
- `TERM` only when terms are business-relevant and reusable

全局去重：

- 相同 `TERM` 只保留一个对象。
- 同一模块职责对象可被多个 capability view 引用。
- 同一 contract 可被多个 view 引用。
- 对象 ID 必须稳定，不能依赖 LLM 输出。

## Catalog

最终 `catalog.yaml` 必须包含：

```yaml
version: 1
generation:
  knowledge: capability
  capability_scope: full
  target: null
budget:
domains:
capabilities:
activation:
objects:
maps:
unknown_escalation_rules:
reports:
```

必须支持：

- term match
- path match
- system/external match
- route match
- OPEN gate
- stale object policy

## Markdown 可用性标准

真实生成的 Markdown 必须能让 Claude Code 回答：

- 这个能力的业务目标是什么？
- 哪些入口触发它？
- 现有主流程是什么？
- 有哪些分支和副作用？
- 涉及哪些表、字段、请求对象？
- 代码应该改哪里？
- 哪些地方不能改或不能猜？
- 如何验证？
- 哪些问题必须升级提问？

## 验证方式

本任务所有验证都必须用真实项目生成真实知识 Markdown。

禁止：

- 不写任何单元测试代码。
- 不用 mock repo 作为主要验收。
- 不以 TypeScript 单测通过作为业务知识质量结论。

必须运行：

```bash
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-full-capability-knowledge --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

必须人工或脚本读取真实输出：

```powershell
Get-ChildItem D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\views\capabilities -Filter *.md
Get-Content D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\catalog.yaml
Get-Content D:\tmp\music-education-app-full-capability-knowledge\bootstrap-knowledge\reports\capability-inventory.json
```

抽查至少 5 个能力：

- 商品浏览与搜索
- 购物车管理
- 订单支付
- 教学内容浏览
- 录音提交或评分

每个抽查能力必须检查 Markdown 是否满足“可用性标准”。

## 验收标准

1. `--knowledge capability` 在未传 `--target` 时能在 `music-education-app` 上生成多能力知识包。
2. 生成结果不是按 Controller 方法一比一生成。
3. capability view 数量在预算内，默认不超过 30。
4. `reports/capability-inventory.json` 能解释候选、合并、拒绝和预算。
5. `catalog.yaml` 包含 capabilities、activation、maps、objects。
6. `maps/entrypoints.yaml` 覆盖主要 route。
7. 真实 Markdown 能让 Agent 理解能力、定位改动面和规划验证。
8. 若能力缺少验证证据，必须生成 `OPEN` 或 `cannot_verify_without`，不能伪装成已验证。
