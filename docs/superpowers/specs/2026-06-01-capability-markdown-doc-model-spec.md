# Capability Markdown Doc Model Spec

## 背景

当前 capability 生成链路已经基本符合项目边界：

```text
EvidenceBundle
-> LLM CandidateClaim[]
-> filterCandidateClaims
-> assembleCapabilityKnowledgeObjects
-> buildCapabilityKnowledgeFiles
-> writeKnowledgePackage
```

关键代码：

- `src/generation/capability-claim-generator.ts`
  - 定义 `CandidateClaimSchema`
  - 要求 LLM 返回 strict JSON array
  - 要求非 `OPEN` claim 引用 evidence refs
  - 禁止 LLM 决定对象 ID、路径和目录结构
- `src/knowledge/capability-object-assembler.ts`
  - 把 `CandidateClaim[]` 转成 `KnowledgeObject[]`
  - 程序生成对象 ID
  - 保留 `metadata`，包括 `businessDefinition`、`touchWhen`、`doNotTouchWhen`、`acceptanceOracle`、`minimalNextEvidence`
- `src/packaging/capability-knowledge-writer.ts`
  - 生成 `catalog.yaml`
  - 生成 `objects/<type>/<id>.yaml`
  - 生成 `views/capabilities/<capabilityId>.md`
  - 生成 evidence、report、debug 文件

现有主要问题不是“LLM 返回 JSON”这条路线错了，而是最终 capability Markdown view 太像对象索引：

```md
## Requirement Intent
- CAP-XXX: ...

## Current Behavior
- FLOW-XXX: ...

## Code Anchors
- MOD-XXX: ...
```

这不能满足本轮讨论的 MVP 目标：用户主要关心最后的 Markdown 文档内容是什么样，以及 Agent 读一份能力文档后是否能形成需求理解、改动定位和验证计划。

## 目标

在不推翻现有 JSON claim 和对象组装链路的前提下，新增一个确定性的 `CapabilityDocModel`，把 `KnowledgeObject[] + evidenceIndex` 聚合成一份固定结构的能力 Markdown。

目标输出从“对象列表式 view”升级为“Agent 可直接阅读的业务能力文档”：

```md
# <能力名称>

## 1. 能力结论
## 2. 什么时候会用到这份知识
## 3. 业务术语
## 4. 当前行为
## 5. 入口与代码位置
## 6. 改动定位建议
## 7. 数据与契约
## 8. 不能猜的边界
## 9. 验证方式
## 10. 证据索引
```

LLM 仍然只返回结构化 JSON。Markdown 标题、章节顺序、表格结构和文件路径全部由程序决定。

## 非目标

- 不让 LLM 直接输出最终 Markdown。
- 不重写 capability discovery。
- 不重写 `EvidenceBundle` 结构。
- 不删除现有 `KnowledgeObject` 抽象。
- 不实现完整多能力 inventory。
- 不新增对象类型。
- 不实现 freshness、activation catalog、maps 层。

## MVP 输出目录

继续兼容现有目录，但主阅读入口调整为更清晰的 capability Markdown：

```text
bootstrap-knowledge/
├── catalog.yaml
├── capabilities/
│   └── CAP-XXX.md
├── views/
│   └── capabilities/
│       └── CAP-XXX.md
├── objects/
│   └── ...
├── evidence/
│   └── index.jsonl
├── reports/
│   └── capability-generation.json
└── debug/
```

MVP 中：

- `capabilities/CAP-XXX.md` 是推荐主入口。
- `views/capabilities/CAP-XXX.md` 保留兼容，内容与 `capabilities/CAP-XXX.md` 相同。
- `objects/**/*.yaml` 暂时保留，作为结构化调试与未来拆分基础。

## CapabilityDocModel

新增文件：

```text
src/knowledge/capability-doc-model.ts
```

核心类型：

```ts
export interface CapabilityDocModel {
  capabilityId: string;
  title: string;
  summaryZh: string;
  includes: string[];
  excludes: string[];
  triggers: string[];
  terms: CapabilityDocTerm[];
  behaviors: CapabilityDocBehavior[];
  codeAnchors: CapabilityDocCodeAnchor[];
  dataContracts: CapabilityDocDataContract[];
  unknowns: CapabilityDocUnknown[];
  validation: CapabilityDocValidation[];
  evidenceIndex: CapabilityDocEvidence[];
}
```

聚合规则：

- `CAP` 对象提供：
  - `title`
  - `summaryZh`
  - `includes`
  - `excludes`
  - `triggers`
- `TERM` 对象提供：
  - 业务术语、含义、非等价项、证据
- `FLOW` 对象提供：
  - 当前行为步骤、分支、失败语义
- `MOD` 对象提供：
  - 入口、路径、职责、`touchWhen`、`doNotTouchWhen`
- `CON` 对象提供：
  - 数据/接口/SQL/DB 字段契约
- `VER` 对象提供：
  - 验证目标、验收 oracle、测试锚点
- `OPEN` 对象提供：
  - 不能猜的问题、阻塞决策、最小下一证据
- `evidenceIndex` 提供：
  - `evidence://...` 到代码路径、符号、摘要的映射

如果某类对象缺失，Markdown 不应只写 `(none)`。章节应给出可执行的替代信息：

- 缺少验证时，展示 validation `OPEN`；如果也没有 validation `OPEN`，展示 “当前知识包没有足够证据证明验证路径，计划前必须补充测试、手工验收或运行证据”。
- 缺少契约时，展示当前 evidence 中可见的 `dataContracts` 缺口或 `OPEN`。
- 缺少术语时，不生成误导性 skeleton 术语，只在能力结论中保留能力名。

## Markdown 渲染规则

新增或重写渲染函数：

```text
src/packaging/capability-markdown-renderer.ts
```

职责：

- 输入 `CapabilityDocModel`
- 输出固定结构 Markdown
- 不调用 LLM
- 不决定对象 ID
- 不读取文件系统

渲染规则：

### 1. 能力结论

包含：

- 能力摘要
- 包含范围
- 不包含范围
- 置信度或风险提示，如果对象里有对应元数据

### 2. 什么时候会用到这份知识

来自：

- `CAP.metadata.canonicalTerm`
- `TERM.metadata.canonicalTerm`
- `object.decisionPoints`
- capability hints 可落入对象时的术语

### 3. 业务术语

表格：

```md
| 术语 | 含义 | 不等于 | 证据 |
| --- | --- | --- | --- |
```

不允许输出只有 `Definition: order` 这种无业务价值的 skeleton 术语。

### 4. 当前行为

优先来自 `FLOW.metadata.orderedSteps`，其次来自 `FLOW.metadata.evidenceSteps`，最后使用 `FLOW.description`。

每个步骤必须尽量带 evidence ref。

### 5. 入口与代码位置

来自：

- `MOD.metadata.entryPoints`
- `MOD.metadata.rootPath`
- `evidenceIndex` 中 `kind=entry/module/behavior`

表格：

```md
| 场景 | 入口/方法 | 文件 | 作用 | 证据 |
| --- | --- | --- | --- | --- |
```

### 6. 改动定位建议

来自 `MOD.metadata.touchWhen` 与 `MOD.metadata.doNotTouchWhen`。

如果只有泛化建议，没有证据支撑，则不应渲染为事实，应转入 `不能猜的边界`。

### 7. 数据与契约

来自 `CON.metadata.fieldSemantics`、`CON.metadata.kind`、`CON.metadata.subject`、`evidenceIndex`。

表格：

```md
| 数据/字段 | 含义 | 来源 | 注意 | 证据 |
| --- | --- | --- | --- | --- |
```

### 8. 不能猜的边界

来自所有 `OPEN` 对象。

必须展示：

- 问题
- 阻塞的决策
- 最小下一证据
- 如果猜测的风险

### 9. 验证方式

来自 `VER` 对象和 validation `OPEN`。

不允许空章节。

### 10. 证据索引

只展示当前文档实际引用过的 evidence refs。

表格：

```md
| 证据 | 类型 | 位置 | 支撑结论 |
| --- | --- | --- | --- |
```

## 对现有代码的改动点

### 1. `src/knowledge/capability-doc-model.ts`

新增：

- `CapabilityDocModel` 类型
- `buildCapabilityDocModel(input)` 函数
- 从 `KnowledgeObject[]` 和 `EvidenceIndexItem[]` 聚合能力文档数据
- 过滤弱 skeleton TERM
- 标记 validation 为空时的 `validationGap`

### 2. `src/packaging/capability-markdown-renderer.ts`

新增：

- `renderCapabilityMarkdown(model)` 函数
- 固定章节输出
- 表格转义 helper
- evidence refs 格式化 helper

### 3. `src/packaging/capability-knowledge-writer.ts`

修改：

- `buildCapabilityView()` 不再直接列对象 bullet。
- 调用 `buildCapabilityDocModel()` 和 `renderCapabilityMarkdown()`。
- `buildCapabilityKnowledgeFiles()` 同时输出：
  - `capabilities/<capabilityId>.md`
  - `views/capabilities/<capabilityId>.md`

### 4. `src/knowledge/capability-knowledge-pipeline.ts`

小改：

- 最终质量门禁从“有对象”补充为“文档模型可用”。
- 至少检查：
  - `summaryZh` 非空
  - `codeAnchors` 非空
  - `validation` 非空或 `unknowns` 中存在 validation gap

### 5. `tests/unit/packaging/capability-knowledge-writer.test.ts`

更新现有测试，不新增大范围测试体系：

- 断言最终 Markdown 包含 10 个固定章节。
- 断言包含 `touchWhen` / `doNotTouchWhen` 渲染。
- 断言 validation 章节不输出 `(none)`。
- 断言 `capabilities/<capabilityId>.md` 被生成。

## 验收标准

运行：

```powershell
npm run typecheck
npm run build
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

真实生成命令：

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-md-model --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

检查：

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\views\capabilities\*.md
```

必须满足：

1. 主能力 Markdown 存在于 `bootstrap-knowledge/capabilities/`。
2. Markdown 包含固定 10 个章节。
3. Markdown 不是对象 bullet 列表，而是有表格、行为步骤、改动建议、验证和未知边界。
4. `## 9. 验证方式` 不为空。
5. `## 10. 证据索引` 只列本文实际引用的 evidence refs。
6. LLM debug 仍显示模型返回 JSON claim，而不是 Markdown。

## 后续演进

如果这版 Markdown 内容可用，再考虑：

- 是否停止输出 `objects/**/*.yaml`
- 是否把 `CapabilityDocModel` 作为新的 LLM 输出 schema
- 是否让 `catalog.yaml` 直接路由到 `capabilities/*.md`
- 是否对多能力生成复用同一文档模型
