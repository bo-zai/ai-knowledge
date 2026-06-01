# Capability Doc Usability Hardening Spec

## 背景

已经检查过真实生成目录：

```text
D:\tmp\music-education-app-capability-order-doc-review\bootstrap-knowledge
```

本次不重新生成，不用 mock，不用单元测试结果判断质量。基于已生成 Markdown 文档的检查结论如下：

- 已生成 `views/capabilities/CAP-ORDER-CAPABILITY.md`。
- 已生成 `CAP/FLOW/CON/MOD/TERM/OPEN` Markdown 对象。
- `CAP/FLOW/CON/MOD` 主体内容来自 LLM，整体比早期 skeleton 输出可读。
- `TERM` 与 `OPEN` 仍来自 skeleton。
- 没有生成 `VER` 对象。
- capability view 的 `## Validation` 是 `(none)`。
- report 中 `verHasOracle=false`，只是通过 `openHasMinimalNextEvidence=true` 让 `verOrValidationOpenPresent=true`。

当前生成结果不能算正确完成，因为它不能让 AI 基于文档形成可靠验证计划。

## 最高优先级要求

后续验证全部按以下方式执行：

1. 在真实项目 `D:\workspace\other_project\music-education-app` 运行真实生成命令。
2. 读取真实生成的 Markdown 知识文档。
3. 判断这些文档是否能让 AI 做需求澄清、实现定位和验证计划。
4. 根据文档缺陷反向修改代码。
5. 不新增任何单元测试代码。
6. 不用 mock LLM 输出作为验收依据。

允许运行：

```bash
npm run typecheck
npm run build
```

它们只作为编译安全检查，不作为业务知识质量验收。

## 本轮目标

让 `order` 单业务功能生成的 Markdown 知识达到可用标准。

真实命令：

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-order-doc-review --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

生成后必须通过人工读取 Markdown 文档验收：

```text
bootstrap-knowledge/views/capabilities/*.md
bootstrap-knowledge/objects/capabilities/*.md
bootstrap-knowledge/objects/flows/*.md
bootstrap-knowledge/objects/contracts/*.md
bootstrap-knowledge/objects/modules/*.md
bootstrap-knowledge/objects/validation/*.md
bootstrap-knowledge/objects/open/*.md
bootstrap-knowledge/objects/terms/*.md
```

## 当前文档缺陷

### 1. Validation 区块不可用

当前 capability view：

```md
## Validation
- (none)
```

这直接失败。AI 无法知道订单能力应该如何验证。

必须改为：

- 引用至少一个 `VER-*` 对象；或
- 引用一个明确的 validation `OPEN-*` 对象，说明缺什么验证证据、阻塞什么验证决策、下一步看什么。

### 2. 没有 VER 对象

当前没有：

```text
objects/validation/VER-*.md
```

`VER` 不只是形式字段。它必须包含：

- verification goal
- acceptance oracle
- minimal validation path
- negative or failure case
- evidence refs

如果真实代码里找不到测试锚点，也必须生成 validation `OPEN`，不能让 `Validation` 为空。

### 3. OPEN 对象 status 错误且不可执行

当前 `OPEN-N-DB.md` 和 `OPEN-N-API.md`：

```yaml
status: fact
```

这是错误的。`OPEN` 必须是：

```yaml
status: open-question
```

并且当前 `minimal next evidence` 只是重复“没有发现”。它应该告诉 AI：

- 应查看哪些文件或证据类型。
- 这个未知阻塞哪些决策。
- 如果不解决会导致什么错误。
- 是否影响当前 order 需求实现。

### 4. TERM 对象是 skeleton，占位感强

当前 `TERM-ORDER.md` 只有：

```md
order is a business term evidenced within Order capability.
Definition: order
Source: skeleton
```

这不能帮助 AI 区分：

- order
- orderSn
- order status
- mall order
- payment order
- refund or cancellation

`TERM` 必须由 LLM 基于证据生成，或者不进入稳定对象。不能把 skeleton TERM 当成稳定事实。

### 5. MOD 仍有模板化边界语句

当前 MOD 对象有可用定位价值，但仍出现泛化句：

- `Database schema changes (handled by mapper layer)`
- `Authentication/authorization logic (handled by security module)`

这些句子如果没有证据或替代路径，就不应作为事实写入。可以写为：

- 有证据支撑的 `doNotTouchWhen`；或
- `OPEN`：模块边界需要确认。

### 6. Evidence bundle 噪音过多

debug request 中包含大量非 order 证据和 1600+ contract evidence。LLM 最终输出虽然聚焦，但这会导致：

- 输出不稳定。
- raw response 出现控制字符和截断痕迹。
- LLM 更容易遗漏 `VER`。
- LLM 被无关 DTO/mapper/字段干扰。

必须收窄 capability evidence bundle，只给 order target 高相关证据。

## 必须实现的行为

### VER / Validation 行为

生成 order capability 时：

- 如果发现测试、控制器路径、服务方法、验证锚点或可观测业务结果，必须生成 `VER-*`。
- 如果没有足够测试证据，必须生成 `OPEN-VALIDATION-*`。
- capability view 的 `## Validation` 不允许为空。

`VER` 示例结构：

```md
---
id: VER-ORDER-CREATION
type: VER
status: fact
---

# VER-ORDER-CREATION

## Claim
Order creation is valid when a submitted order creates an order number, persists order goods, applies coupon and price calculation rules, and exposes the expected order status.

## Verification Goal
...

## Acceptance Oracle
- Created order has orderSn.
- Order goods are associated with the order.
- Invalid stock/coupon/address does not create a successful order.

## Minimal Validation Path
- Exercise OrderController submit path.
- Verify OrderService create path.
- Verify persisted order fields and response status.
```

如果不能证明，则生成：

```md
---
id: OPEN-ORDER-VALIDATION
type: OPEN
status: open-question
---

# OPEN-ORDER-VALIDATION

## Unknown
No executable validation anchor was found for order creation.

## Blocked Decisions
- Cannot claim implementation is ready.
- Cannot define acceptance without checking controller/service behavior.

## Minimal Next Evidence
- Inspect src/test for OrderController or OrderService tests.
- If absent, add or manually execute an order submit path against a test database.
```

### OPEN 行为

All `OPEN` objects must:

- use `status: open-question`
- include `blocked_decisions`
- include `minimalNextEvidence`
- be shown in capability view under `Unknowns and Escalation`
- not be counted as validation readiness unless it is specifically validation-related

### TERM 行为

For `TERM`:

- Prefer LLM-generated business definition.
- Reject skeleton-only terms from stable output unless they contain useful business definition and `not_equal_to`.
- `TERM-ORDER` must explain order domain meaning in this repository.

### MOD 行为

For `MOD`:

- `touchWhen` and `doNotTouchWhen` must be evidence-grounded.
- If boundary cannot be proven, generate `OPEN-MODULE-BOUNDARY-*`.
- Generic architecture advice is not enough.

### Evidence Scope 行为

The LLM prompt should include only high-relevance order evidence:

- target-relevant entry points
- target-relevant behavior slices
- target-relevant contracts
- target-relevant module surfaces
- validation anchors if present
- negative evidence
- open question seeds

It should not include broad unrelated repository evidence with low target relevance.

## 验收标准

Only generated Markdown docs count.

The final run must satisfy:

1. `views/capabilities/*.md` exists and has non-empty `Validation`.
2. `objects/validation/VER-*.md` exists, or `objects/open/OPEN-*-VALIDATION*.md` exists and is referenced in `Validation`.
3. No `OPEN` object has `status: fact`.
4. `TERM-ORDER.md` contains a real business definition, not `Definition: order`.
5. `MOD` docs do not contain unsupported generic boundary statements.
6. `reports/generation.json` records `knowledge=capability`, `target.value=order`, `llmCalled=true`, `llmSucceeded=true`.
7. Reading the generated docs is enough to answer:
   - What does order capability do?
   - Which files should AI consider changing?
   - Which contracts or data shapes are affected?
   - How should the change be validated?
   - What must not be guessed?

## Explicit Non-Goals

- Do not add unit tests.
- Do not add integration tests.
- Do not use mock LLM output as success evidence.
- Do not broaden this task to full multi-capability generation.
- Do not solve DB knowledge generation in this round.

## Completion Report Required From Implementer

The implementer must report:

```text
Real command:
Generated docs root:
Capability view path:
Generated object files:
Validation section content:
VER or validation OPEN path:
TERM-ORDER quality:
MOD boundary quality:
OPEN status check:
Evidence scope notes:
Remaining gaps:
```
