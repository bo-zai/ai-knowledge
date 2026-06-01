# 知识有效性评测与验证

## 核心问题

判断一条知识是否值得沉淀，不能靠“看起来有用”，必须回答：

- 没有它时，Agent 是否更容易犯某类错误
- 只有它变化时，结果是否显著变化
- 它是否真的改变了 Agent 的决策，而不是只是被检索到

## 1. 先做两本台账

### Need Ledger

记录“哪里真的存在知识缺口”。

候选来源：

- AI 连续两次犯同类错误
- code review 反复指出同类上下文缺失
- 新人 onboarding 反复问同一问题
- 同类 bug / incident 反复出现
- PR 经常因业务语义不清返工
- 跨系统需求经常漏边界或漏验证

建议字段：

```yaml
need_id:
date:
source_type:
source_ref:
problem_summary:
error_type:
task_type:
frequency:
severity:
candidate_object_types:
```

### Evidence Ledger

记录“这条知识是否有一手证据”。

证据分层：

- `Tier 1`
  - 源码
  - 测试
  - schema / migration
  - 配置
  - 契约定义
  - IaC
- `Tier 2`
  - ADR / RFC
  - PR / review
  - incident / postmortem
  - 日志 / trace / metrics
- `Tier 3`
  - 口头经验
  - 聊天记录
  - 个人记忆

规则：

- `Tier 3` 只能当线索，不能单独进入稳定 wiki
- 稳定知识至少需要 `Tier 1` 或强 `Tier 2` 组合

建议字段：

```yaml
evidence_id:
claim_candidate:
tier:
source_ref:
source_kind:
supports:
conflicts_with:
freshness_signal:
confidence:
```

## 2. Candidate Claim 流程

候选知识不是直接写成文档，而是先写成待评估的 `claim`。

建议字段：

```yaml
claim_id:
proposed_object_type:
claim_text:
need_refs:
evidence_refs:
decision_points:
expected_failure_if_missing:
expected_failure_if_stale:
target_tasks:
target_metrics:
keep_if:
drop_if:
```

## 3. 评测输入与输出

评测输入是一份真实需求文档，而不是随意问题。

Agent 必须产出固定结构：

```yaml
business_summary:
term_mapping:
boundary_decision:
impacted_systems:
source_of_truth:
affected_flows:
affected_contracts:
constraints:
change_surface:
unknowns:
verification_plan:
```

## 4. 核心指标

建议固定两组指标。

第一组评估最终计划质量：

- `term_grounding_accuracy`
- `boundary_accuracy`
- `source_of_truth_accuracy`
- `external_system_recall`
- `constraint_recall`
- `change_surface_precision`
- `verification_completeness`
- `unsupported_assumption_rate`

第二组评估上下文检索质量：

- `context_recall`
  - gold case 要求读取的对象中，Agent 实际读取了多少
- `context_precision`
  - Agent 读取的对象中，有多少与任务相关
- `context_efficiency`
  - 完成任务理解所消耗的对象数、token 数和读取轮次是否合理
- `used_context_ratio`
  - Agent 读取的对象中，有多少最终进入关键判断
- `unsupported_context_usage`
  - Agent 是否使用了未引用对象、过期对象或低可信对象做关键判断
- `stale_object_reliance`
  - Agent 是否依赖 stale 对象输出当前事实

最终计划质量回答“计划对不对”。

上下文检索质量回答“Agent 是不是用正确方式得到这个计划”。

## 5. 一票否决项

以下错误可直接判定任务理解失败：

1. 错认 source of truth
2. 漏掉关键外部系统
3. 漏掉关键不变量
4. 没证据却把猜测当事实

## 6. 三组实验

每条知识对象都做三组实验：

### With

正常提供该知识对象。

### Without

只移除这一条知识，其他保持不变。

### Stale

用过期或错误近似版本替换该知识。

如果三组结果没有明显差异，这条知识大概率是：

- 冗余
- 不可检索
- 不改变决策
- 或者只是装饰性信息

## 7. 检索过程记录

每次评测不仅记录最终答案，还要记录 Agent 的上下文使用过程。

建议输出：

```yaml
context_trace:
  retrieved_objects:
    - id:
      reason:
      trigger:
      token_estimate:
  used_objects:
    - id:
      used_for:
      decision_field:
  skipped_required_objects:
    - id:
      expected_reason:
  unsupported_claims:
    - claim:
      decision_field:
      why_unsupported:
  stale_objects_used:
    - id:
      used_for:
      risk:
```

记录规则：

- `retrieved_objects` 表示 Agent 读取过，不代表有效。
- `used_objects` 表示对象实际影响了最终判断。
- 如果对象被读取但没有影响判断，应计入上下文效率成本。
- 如果最终判断没有对象 ID 或证据引用，应计入 unsupported assumption。
- 如果使用 stale 对象支撑当前事实，应按风险等级扣分。

## 8. 对象类型与指标映射

- `TERM`
  - 重点看 `term_grounding_accuracy`
- `SYS`
  - 重点看 `external_system_recall`
- `OWN`
  - 重点看 `source_of_truth_accuracy`
- `CON`
  - 重点看是否漏掉幂等、顺序、超时、错误语义
- `MOD`
  - 重点看 `change_surface_precision`
- `VER`
  - 重点看 `verification_completeness`
- `OPEN`
  - 重点看 `unsupported_assumption_rate`

## 9. 稳定层保留标准

建议一条知识进入稳定层，至少满足以下之一：

- 改善一个核心指标
- 避免一次 veto 级错误
- 稳定触发正确的升级提问，显著降低瞎猜

建议量化阈值初稿：

- `boundary_accuracy` 提升 `>= 10pp`
- 或 `source_of_truth_accuracy` 提升 `>= 10pp`
- 或 `change_surface_precision` 提升 `>= 15pp`
- 或 `unsupported_assumption_rate` 下降 `>= 30%`
- 或 `context_recall` 提升 `>= 15pp`
- 或 `context_precision` 提升 `>= 15pp`
- 或 `used_context_ratio` 提升 `>= 20%`

## 10. 删除 / 降级标准

以下情况建议降级或删除：

- 连续多次被检索但未改变任何决策
- 与代码或契约事实冲突
- 只对一次性任务有用
- 只是显性代码事实，读代码很快可得
- 被组合页重复覆盖且没有独立作用
- 经常被读取但没有进入 `used_objects`
- 经常引发错误自信或 stale reliance
- token 成本明显高于它带来的决策收益

## 11. Freshness 机制

每条对象都应声明 `stale_if`，并能映射到：

- 契约文件变化
- 关键模块变化
- 状态机变化
- 发布流程变化
- 第三方版本变化

一旦触发，应进入待复核列表。

Freshness 评测应覆盖两类失败：

- stale 对象继续被当作当前事实使用
- 代码已经变化但对象没有被标记待复核

建议记录：

```yaml
freshness_check:
  changed_anchors:
    - path:
    - symbol:
    - table:
    - endpoint:
  affected_objects:
    - id:
      stale_reason:
      risk_if_wrong:
      required_action: review | regenerate | block_usage
```

## 12. 推荐评测目录

```text
evaluation/
├── cases/
│   ├── CASE-001-.../
│   │   ├── request.md
│   │   ├── gold.yaml
│   │   ├── evidence.md
│   │   └── scoring.yaml
├── knowledge-matrix.yaml
└── experiment-runs/
```

## 13. 评测哲学

不是问：

- “这篇文档是不是写得完整”

而是问：

- “Agent 因为它而更少犯错了吗”
- “Agent 是否用更少、更相关、更可追溯的上下文完成判断”

这点是整个设计最重要的收口。
