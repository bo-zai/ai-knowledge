# Knowledge Object Model v1

## 总体思路

知识系统的最小单元是 `知识对象（object）`。每个对象代表一个稳定的、可引用的知识断言集合，必须能够被：

- 检索
- 引用
- 验证
- 标记过期
- 在评测中做 `with / without / stale` 对比

## 公共字段

所有知识对象先共享一层公共字段：

```yaml
id:
type:
status: fact | derived | decision | open-question
claim:
scope:
task_triggers:
decision_points:
evidence_primary:
evidence_secondary:
exceptions:
stale_if:
owner:
last_verified:
links:
target_tasks:
expected_failure_if_missing:
expected_failure_if_stale:
target_metrics:
confidence:
risk_if_wrong:
usage_policy:
```

## 公共字段说明

- `id`
  - 全局唯一 ID，例如 `TERM-REFUND`
- `type`
  - 对象类型，例如 `TERM`、`OWN`
- `status`
  - 明确是事实、推导、决策还是未解决问题
- `claim`
  - 一句可证伪的话，禁止写“大概”“通常”“一般”
- `scope`
  - 适用范围，必须能定位到域、系统、模块或实体
- `task_triggers`
  - 哪类需求或任务会触发读取这条知识
- `decision_points`
  - 这条知识影响 Agent 的哪个判断
- `evidence_primary`
  - 一手证据，优先代码、测试、schema、契约、配置、IaC
- `evidence_secondary`
  - 二手证据，例如 ADR、事故、PR、指标
- `exceptions`
  - 已知例外
- `stale_if`
  - 哪些变化发生后这条知识需要复核
- `target_tasks`
  - 这条知识预计服务的真实任务集
- `expected_failure_if_missing`
  - 如果缺失，Agent 典型会犯什么错
- `expected_failure_if_stale`
  - 如果过期，Agent 典型会被误导成什么错
- `target_metrics`
  - 这条知识被保留后希望改善哪些指标
- `confidence`
  - 该对象当前可信度，建议分为 `high`、`medium`、`low`
- `risk_if_wrong`
  - 如果 Agent 错用这条知识，可能造成的风险，建议分为 `low`、`medium`、`high`、`critical`
- `usage_policy`
  - Agent 在不同可信度和风险下如何使用该对象，例如可直接规划、只能提示、必须先验证或必须提问

## 可信度、风险与使用策略

知识对象不能只表达“是什么”，还必须表达“能不能直接用来做计划”。

建议规范：

```yaml
confidence:
  level: high | medium | low
  reason:
  evidence_tier: tier1 | tier2 | tier3

risk_if_wrong: low | medium | high | critical

usage_policy:
  can_plan_with: true | false
  must_verify_before_use: true | false
  must_ask_if_conflict: true | false
  must_not_override:
    - OWN
    - INV
    - CON
```

使用规则：

- `high confidence` 且风险不高的对象，可以作为 change plan 的直接依据。
- `medium confidence` 对象可以用于缩小搜索范围，但关键结论仍需补充证据。
- `low confidence` 对象只能用于提示和提问，不能独立支撑改动计划。
- `risk_if_wrong` 为 `high` 或 `critical` 的对象，即使可信度高，也必须在计划中显式引用证据和验证项。
- `Tier 3` 证据不能单独支撑稳定事实，只能进入 `OPEN`、candidate claim 或低可信对象。

高风险对象通常包括：

- source of truth
- 外部系统契约
- 支付、资金、权限、审计、合规相关边界
- 数据一致性和幂等语义
- 删除、回滚、补偿和不可逆状态变更

## stale_if 机器可解析约束

`stale_if` 不应只写自然语言。它应尽量绑定到可检测的代码或契约锚点。

建议结构：

```yaml
stale_if:
  paths:
    - src/order/**
    - src/main/resources/mappers/OrderMapper.xml
  symbols:
    - OrderService.createOrder
    - RefundService.applyRefund
  tables:
    - orders
    - refund_records
  endpoints:
    - POST /api/orders
  contracts:
    - pay.refund.callback.v1
  tests:
    - OrderServiceTest
  configs:
    - application-payment.yml
```

使用规则：

- 命中 `stale_if` 的对象应进入待复核状态。
- stale 对象可以保留，但 `catalog.yaml` 应标记其状态。
- Agent 可以读取 stale 对象理解历史上下文，但不能把它作为当前事实直接规划。
- 如果 stale 对象涉及高风险边界，Agent 必须停下并要求新证据。

## 13 类核心对象

### TERM

作用：帮助 Agent 正确理解需求中的业务词。

专属字段：

```yaml
canonical_term:
aliases:
business_definition:
not_equal_to:
maps_to_entities:
examples:
counterexamples:
ambiguity_notes:
```

硬规则：

- 没有 `not_equal_to` 时，术语容易被误映射
- 没有 `counterexamples` 时，边界理解不稳

### ACTOR

作用：识别角色、审批主体、权限边界。

专属字段：

```yaml
actor_kind:
responsibilities:
permissions:
forbidden_actions:
approval_required_for:
```

### CAP

作用：把需求归因到具体业务能力。

专属字段：

```yaml
goal:
success_criteria:
non_goals:
entry_conditions:
exit_conditions:
```

### SYS

作用：表达参与系统，尤其外部系统。

专属字段：

```yaml
system_kind:
role:
interfaces:
dependency_direction:
owned_data:
trust_level:
```

### OWN

作用：表达 source of truth 与读写边界。

专属字段：

```yaml
subject:
authority_type:
source_of_truth:
writable_fields:
read_only_fields:
derived_fields:
forbidden_updates:
precedence_rule:
```

硬规则：

- 没有 `forbidden_updates` 时，Agent 容易越权
- 没有 `precedence_rule` 时，边界冲突无法收敛

### FLOW

作用：描述业务链路、异步边界、失败分支与补偿。

专属字段：

```yaml
trigger:
preconditions:
ordered_steps:
async_boundaries:
side_effects:
failure_branches:
compensation:
```

硬规则：

- 没有 `failure_branches` 和 `compensation`，就只是 happy path 文档

### STATE

作用：表达状态机与转移。

专属字段：

```yaml
subject:
states:
allowed_transitions:
forbidden_transitions:
transition_triggers:
terminal_states:
```

### CON

作用：表达 API / Event / Batch / File / Webhook 等边界契约。

专属字段：

```yaml
interface_type:
producer:
consumer:
schema_ref:
field_semantics:
validation_rules:
idempotency_key:
ordering:
timeout:
retry:
error_map:
versioning:
```

硬规则：

- 没有 `error_map` 时，失败语义会失真
- 没有 `idempotency_key` / `ordering` 时，对异步需求支持不足

### INV

作用：表达不可破坏的不变量。

专属字段：

```yaml
predicate:
applies_when:
enforced_at:
violation_impact:
negative_examples:
```

硬规则：

- 没有 `enforced_at`，大概率只是口号

### MOD

作用：把业务问题映射到代码改动面。

专属字段：

```yaml
repo_paths:
entry_points:
owned_responsibility:
depends_on:
extension_points:
test_anchors:
touch_when:
do_not_touch_when:
```

硬规则：

- 没有 `touch_when` 和 `do_not_touch_when`，就无法真正提升改动定位精度

### DEC

作用：记录已经生效的历史决策。

专属字段：

```yaml
context:
chosen_option:
rejected_options:
consequences:
revisit_triggers:
```

### VER

作用：表达如何证明改动成立。

专属字段：

```yaml
verification_goal:
unit_checks:
integration_paths:
observability_signals:
acceptance_oracles:
rollback_signals:
```

硬规则：

- 没有 `acceptance_oracles` 时，只能证明“跑过了”，不能证明“做对了”

### OPEN

作用：显式记录不能猜的未知。

专属字段：

```yaml
unknown_statement:
blocked_decisions:
minimal_next_evidence:
owner_to_ask:
escalation_gate:
```

硬规则：

- 没有 `minimal_next_evidence`，就只是把问题堆起来

## 对象之间的关系

最重要的依赖关系如下：

- `CAP` 聚合 `TERM`、`ACTOR`、`SYS`、`OWN`、`FLOW`、`CON`、`INV`、`MOD`、`VER`、`OPEN`
- `SYS` 通常关联 `OWN`、`CON`
- `FLOW` 通常关联 `STATE`、`CON`、`INV`
- `MOD` 通常承载 `CAP` 的实现
- `DEC` 会约束 `CAP`、`OWN`、`MOD`
- `VER` 会回指 `FLOW`、`CON`、`INV`、`MOD`

## 推荐首批对象范围

为了尽快支撑“新需求理解 -> change plan”，建议第一批只做：

- `TERM`
- `CAP`
- `SYS`
- `OWN`
- `CON`
- `MOD`
- `VER`

第二批再补：

- `FLOW`
- `STATE`
- `INV`
- `DEC`
- `OPEN`
- `ACTOR`

## 对象保留原则

一个对象进入稳定层前，至少满足：

1. 有一手证据或强二手证据组合
2. 能明确说明影响哪个决策点
3. 能明确说明缺失时的典型错误
4. 在真实任务评测中带来可观测提升或避免 veto 错误
