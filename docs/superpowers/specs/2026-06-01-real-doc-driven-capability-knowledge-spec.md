# Real Document Driven Capability Knowledge Spec

## 背景

当前业务功能知识生成已经接入 `generate --knowledge capability --target <name>`，但真实项目验证仍失败：

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-review-capability-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

失败信息：

```text
LLM generation failed: LLM MOD touch guidance is required for business capability knowledge
```

这说明当前实现不能只靠单元测试、mock LLM 或结构字段断言判定完成。后续必须改为“真实生成知识文档 -> 阅读和评估知识可用性 -> 反向修改代码”的闭环。

## 核心原则

### 1. 验证对象是真实生成的 Markdown 知识文档

验收不再以新增单元测试为主，不再要求写新的单元测试代码。

每次改动都必须在真实项目：

```text
D:\workspace\other_project\music-education-app
```

运行真实命令，生成真实 `bootstrap-knowledge/`，然后检查生成的 Markdown 知识文档是否能服务 AI Agent。

### 2. Markdown 是本轮知识可用性验收入口

本轮验收重点看：

```text
bootstrap-knowledge/
├── catalog.yaml
├── objects/**/*.md
├── views/capabilities/*.md
├── reports/*.json
└── debug/*
```

如果当前实现仍生成 `objects/**/*.yaml`，本轮需要改为 Markdown 对象文件，使用 YAML frontmatter + Markdown 正文。JSON/YAML 可以作为机器索引和报告存在，但用于 AI 读取和验收的权威知识文档必须是 `.md`。

### 3. 代码修改由文档缺陷驱动

每轮验证必须先回答：

- 真实生成的 capability page 是否让 AI 知道需求属于哪个业务能力。
- 真实生成的对象文档是否说明业务目标、当前行为、契约、代码落点、验证方式和未知项。
- 是否存在无证据泛化、技术摘要、模板套话、伪造的 `touchWhen/doNotTouchWhen`。
- 如果让 AI 用这些文档做需求澄清、实现计划和验证计划，是否足够。

发现文档不可用后，再反向修改 discovery、evidence bundle、prompt、LLM repair、claim filter、object assembler 或 writer。

### 4. 不再用程序补业务事实

程序可以：

- 校验字段是否存在。
- 把 LLM 输出归一化成合法结构。
- 把证据引用映射为对象路径。
- 把缺失信息转为 `OPEN`。

程序不可以：

- 编造 `touchWhen`。
- 编造 `doNotTouchWhen`。
- 编造验收 oracle。
- 把模板句当成业务事实。
- 为了过门禁而补业务内容。

如果 LLM 没生成可用业务事实，系统应执行修复提示，或生成明确 `OPEN`，或失败并保留 debug 材料。

## 本轮目标

本轮只完成“业务功能知识生成完全可用”的闭环，不扩展到完整 wiki-agent 全对象系统。

必须做到：

1. `generate --knowledge capability --target order` 能在 `music-education-app` 上生成可用的 Markdown 知识文档。
2. 生成结果至少包含一个 capability view Markdown。
3. 生成结果至少包含 `CAP/MOD/VER` Markdown 对象，以及 `FLOW` 或 `CON` Markdown 对象。
4. 如果缺少失败语义、source of truth、外部边界或验证证据，必须生成 `OPEN` Markdown 对象。
5. `MOD` 的 `touchWhen/doNotTouchWhen` 必须来自 LLM 基于证据生成，或作为 `OPEN` 升级，不允许程序模板补齐。
6. 真实生成的 capability page 必须能支撑 AI 做需求澄清、实现定位和验证计划。
7. 失败时必须落出 debug 材料，能看到 evidence bundle、LLM request、LLM raw response、filter/reject reason。

## 非目标

本轮不要求：

- 为所有业务功能批量生成稳定知识。
- 补齐 `SYS/OWN/INV/STATE/DEC/ACTOR`。
- 为本轮新增单元测试代码。
- 继续扩大 mock LLM 覆盖。
- 以测试断言替代真实文档审查。

## 必须验证的真实命令

### 单业务功能生成

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

必须生成：

```text
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\catalog.yaml
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\views\capabilities\*.md
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\capabilities\*.md
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\modules\*.md
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\objects\validation\*.md
```

并且至少存在：

```text
objects/flows/*.md
```

或：

```text
objects/contracts/*.md
```

### 文档审查命令

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge -Recurse -Filter *.md | Select-Object FullName
```

```bash
Get-Content <generated-capability-view.md>
```

```bash
Get-Content <generated-capability-object.md>
Get-Content <generated-module-object.md>
Get-Content <generated-validation-object.md>
```

如果生成失败，也必须能检查：

```bash
Get-ChildItem D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge\debug -Recurse
Get-Content <debug-file>
```

## Markdown 文档质量标准

### Capability Page

`views/capabilities/*.md` 必须包含固定区块：

```md
# CAP-...

## Requirement Intent
## Current Behavior
## Contracts
## Code Anchors
## Validation
## Unknowns and Escalation
```

每个区块必须引用对象 ID，不允许只写泛泛摘要。

### CAP 对象

必须回答：

- 这个业务能力是什么。
- 面向什么业务目标。
- 成功标准是什么。
- 哪些不是这个能力的职责。
- 证据来自哪些 entry/behavior/contract/module。

### FLOW 或 CON 对象

`FLOW` 必须回答：

- 主业务步骤。
- 失败分支。
- 补偿或缺失补偿时的 `OPEN`。

`CON` 必须回答：

- 契约主体。
- 关键字段语义。
- 校验规则。
- 缺失错误语义时的 `OPEN`。

### MOD 对象

必须回答：

- 代码路径。
- 该模块承担什么业务责任。
- 什么情况下应该修改它。
- 什么情况下不应该修改它。
- 关联测试或缺失测试风险。

`touchWhen/doNotTouchWhen` 必须是具体业务条件，不能是：

- `Adding new functionality that aligns with this module responsibility`
- `Modifying existing behavior within this module scope`
- `Database schema changes (handled by data access layer)`
- 其他通用模板句。

### VER 对象

必须回答：

- 验证目标。
- 可观察验收 oracle。
- 最少验证路径。
- 不能仅写“运行测试”。

### OPEN 对象

必须回答：

- 未知是什么。
- 阻塞了哪些决策。
- 最小下一步证据是什么。
- 应该问谁或看什么文件。

## 失败处理要求

当真实 LLM 输出不满足质量门禁时：

1. 不要静默成功。
2. 不要用程序模板补业务事实。
3. 必须保留 debug 文件。
4. debug 文件必须包含：
   - selected candidate
   - evidence bundle
   - LLM request
   - raw LLM response
   - parse/normalization notes
   - rejected claims and rejection reasons
   - failed quality gates
5. CLI 应输出 debug 路径。

## 完成定义

只有同时满足以下条件，才算业务功能知识生成可用：

1. 真实命令退出成功。
2. 生成的知识对象是 Markdown 文档。
3. capability page 能通过对象引用组织 `CAP/FLOW或CON/MOD/VER/OPEN`。
4. 文档没有技术摘要冒充业务知识。
5. 文档没有程序补齐的模板业务事实。
6. `reports/generation.json` 记录 `llmRuntime=langgraph`、`llmCalled=true`、`llmSucceeded=true`。
7. 人工阅读生成 Markdown 后，可以基于它给出一个可信的 AI change plan。
