# 评测体系

## 核心问题

判断一条知识是否值得沉淀，不能靠"看起来有用"，必须回答：

- 没有它时，Agent 是否更容易犯某类错误
- 只有它变化时，结果是否显著变化
- 它是否真的改变了 Agent 的决策，而不是只被检索到

## 两本台账

### Need Ledger

记录"哪里真的存在知识缺口"。

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
```

### Evidence Ledger

记录"这条知识是否有一手证据"。

证据分层：

| 层级 | 来源 | 可信度 |
|---|---|---|
| Tier 1 | 源码、测试、schema/migration、配置、契约定义、IaC | 最高 |
| Tier 2 | ADR/RFC、PR/review、incident/postmortem、日志/trace/metrics | 中 |
| Tier 3 | 口头经验、聊天记录、个人记忆 | 最低 |

规则：

- Tier 3 只能当线索，不能单独进入稳定知识
- 稳定知识至少需要 Tier 1 或强 Tier 2 组合

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

## Candidate Claim 流程

候选知识不是直接写成文档，而是先写成待评估的 claim。

```yaml
claim_id:
proposed_type:              # capability | shared_object | knowledge_segment
claim_text:
need_refs:
evidence_refs:
expected_decision_change:   # 预期会改变 Agent 哪个判断
expected_failure_if_missing:
expected_failure_if_stale:
target_tasks:
target_metrics:
keep_if:
drop_if:
```

## 评测输入与输出

评测输入是一份真实需求文档，不是随意问题。

Agent 必须按执行协议（05-agent-protocol.md）输出固定结构。评测基于该结构的完整性和准确性打分。

## 核心指标

### 第一组：最终计划质量

| 指标 | 评估内容 |
|---|---|
| term_grounding_accuracy | 术语是否正确锚定 |
| boundary_accuracy | 边界判断是否正确 |
| source_of_truth_accuracy | 数据归属判断是否正确 |
| external_system_recall | 外部系统是否完整识别 |
| constraint_recall | 约束是否完整识别 |
| change_surface_precision | 代码改动面是否精准 |
| verification_completeness | 验证计划是否完整 |
| unsupported_assumption_rate | 无证据假设比例 |

### 第二组：上下文检索质量

| 指标 | 评估内容 |
|---|---|
| context_recall | 应该读的对象中，Agent 实际读了多少 |
| context_precision | Agent 读的对象中，多少与任务相关 |
| context_efficiency | 完成任务消耗的读取次数和 token 数是否合理 |
| used_context_ratio | 读过的对象中，多少最终进入关键判断 |
| unsupported_context_usage | 是否使用了无证据的判断做关键决策 |
| stale_object_reliance | 是否依赖过期对象输出当前事实 |

第一组回答"计划对不对"。第二组回答"Agent 是不是用正确方式得到这个计划"。

## 一票否决项

以下错误可直接判定任务理解失败：

1. 错认 source of truth
2. 漏掉关键外部系统
3. 漏掉关键不变量
4. 没证据却把猜测当事实

## 三组实验

每条知识做三组实验：

| 实验 | 操作 | 目的 |
|---|---|---|
| With | 正常提供该知识 | 基线 |
| Without | 只移除这一条知识，其他不变 | 验证它是否有独立贡献 |
| Stale | 用过期或错误版本替换 | 验证过期知识的危害 |

如果三组结果没有明显差异，该知识大概率是：

- 冗余
- 不可检索
- 不改变决策
- 只是装饰性信息

## 检索过程记录

每次评测不仅记录最终答案，还要记录 Agent 的上下文使用过程。

```yaml
context_trace:
  retrieved_objects:
    - id:
      reason:           # 为什么读取
      token_estimate:   # token 开销
  used_objects:
    - id:
      used_for:         # 用于哪个判断
      decision_field:   # 影响了输出结构的哪个字段
  skipped_required_objects:
    - id:
      expected_reason:  # 为什么应该读但没读
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

- `retrieved_objects` 表示 Agent 读取过，不代表有效
- `used_objects` 表示对象实际影响了最终判断
- 被读取但没有影响判断的，计入上下文效率成本
- 最终判断没有知识 ID 引用的，计入 unsupported assumption
- 使用过期对象支撑当前事实的，按风险等级扣分

## 知识类型与指标映射

| 知识段/对象 | 重点指标 |
|---|---|
| 术语 | term_grounding_accuracy |
| 边界 | external_system_recall, boundary_accuracy |
| 约束 | constraint_recall（是否漏掉幂等、顺序、超时、错误语义） |
| 代码改动面 | change_surface_precision |
| 验证 | verification_completeness |
| 已知未知 | unsupported_assumption_rate |

## 稳定层保留标准

一条知识进入稳定层，至少满足以下之一：

- 改善一个核心指标
- 避免一次 veto 级错误
- 稳定触发正确的升级提问，显著降低瞎猜

量化阈值初稿：

| 指标 | 最低提升 |
|---|---|
| boundary_accuracy | >= 10pp |
| source_of_truth_accuracy | >= 10pp |
| change_surface_precision | >= 15pp |
| unsupported_assumption_rate | >= 30% 下降 |
| context_recall | >= 15pp |
| context_precision | >= 15pp |
| used_context_ratio | >= 20% |

## 删除/降级标准

以下情况建议降级或删除：

- 连续多次被检索但未改变任何决策
- 与代码或契约事实冲突
- 只对一次性任务有用
- 只是显性代码事实，读代码很快可得
- 经常被读取但没有进入 `used_objects`
- 经常引发错误自信或 stale reliance
- token 成本明显高于决策收益

## Freshness 机制

每份知识文档都应声明 `stale_if`，绑定到可检测的代码或契约锚点：

```yaml
stale_if:
  paths:
    - src/order/**
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

命中 `stale_if` 后：

- 对象进入待复核状态
- catalog.yaml 应标记其状态
- Agent 可以读取过期对象理解历史上下文，但不能作为当前事实直接规划
- 如果涉及高风险边界，Agent 必须停下并要求新证据

Freshness 评测应覆盖两类失败：

- 过期对象继续被当作当前事实使用
- 代码已经变化但对象没有被标记待复核

## 评测目录

```text
evaluation/
├── cases/
│   ├── CASE-001-.../
│   │   ├── request.md          # 真实需求
│   │   ├── gold.yaml           # 标准答案
│   │   ├── evidence.md         # 评测证据
│   │   └── scoring.yaml        # 评分结果
├── knowledge-matrix.yaml       # 知识对象与评测用例的映射
└── experiment-runs/            # 实验运行记录
```

## 评测哲学

不是问"这篇文档是不是写得完整"，而是问：

- "Agent 因为它而更少犯错了吗"
- "Agent 是否用更少、更相关、更可追溯的上下文完成判断"

这是整个设计最重要的收口。知识进入知识包只是起点，不是终点。
