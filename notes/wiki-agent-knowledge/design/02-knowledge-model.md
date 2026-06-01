# 知识模型

## 核心变化

从"13 类独立对象文件"变为"能力文档是主单位 + 共享对象按需独立"。

理由：

- 不是每个功能都需要 8 个文件。简单的能力一个文件就够
- 对象类型是描述能力的不同角度，不是独立的文档单位
- 只有跨域共享且自身复杂的对象才值得独立成文件

## 能力文档：主单位

每个业务能力对应一份完整文档。文档内部按需包含知识段，不强制套用 8 个固定模板。

结构概览：

```text
objects/
├── 退款/
│   └── 退款语义与计算规则.md      # 一个能力 = 一份完整文档
├── 商品浏览/
│   └── 商品浏览与搜索.md
├── 订单/
│   └── 订单创建与支付流程.md
└── _共享/                         # 跨域共享对象
    ├── 支付网关集成边界.md
    └── 订单状态机.md
```

### 能力文档的内部结构

```yaml
# ---- 元数据（必填）----
title: "退款语义与计算规则"          # 知识核心内容的凝练
summary: "买家发起的订单金额返还..."  # 一句话概括
keywords: [退款, refund, 部分退款]   # 检索关键字
id: CAP-REFUND                      # 机器 ID，catalog 引用用

# ---- 知识段（按需，有条件才生成）----
# 核心内容
# 适用范围
# 术语（有易混淆术语时）
# 边界（涉及外部系统或所有权争议时）
# 流程（有状态流转或异步步骤时）
# 约束（有不可破坏的不变量时）
# 代码改动面
# 验证（非平凡验证逻辑时）
# 已知未知（有需要升级的未知时）
```

## 五要素

每个能力文档必须包含以下五个要素：

### 1. 标题（title）

知识核心内容的凝练。让人和 Agent 一眼知道这条知识关于什么。

- 用自然语言，不是技术 ID
- 例："退款语义与计算规则"，不是 `TERM-REFUND`

### 2. 简介（summary）

核心内容的简明概括。帮助判断"我要不要继续读"。

- 一两句话
- 涵盖业务本质，不展开细节

### 3. 关键字（keywords）

触发读取的关键词。覆盖中文、英文、别名和常见误称。

### 4. 核心内容

能力的主体知识。按条件包含多个知识段（详见下文）。

### 5. 适用范围（applicability）

明确什么时候适用、什么时候不适用。

- `applies_when`：适用场景
- `not_applicable_when`：不适用场景，必须指向正确的替代能力

## 知识段定义

每个知识段都是条件性的——有触发条件，没触发就不生成。

### 核心内容（必选）

每个能力文档必须包含。描述这个能力的业务目标、主路径和关键行为。

### 适用范围（必选）

每个能力文档必须包含。

```yaml
applies_when:
  - 需求涉及退款金额计算
  - 需求涉及退款状态流转
not_applicable_when:
  - 跨境退款 → 参见「跨境退款处理」
  - 仅退款不退货 → 参见「仅退款处理」
```

### 术语（条件：有易混淆的业务术语）

```yaml
terms:
  - term: 退款
    definition: 买家发起的订单金额返还流程
    not_equal_to: [退货, 售后]
    examples: [...]
    counterexamples: [...]
```

### 边界（条件：涉及外部系统或所有权争议）

```yaml
boundary:
  owner: OrderService
  external:
    - system: PaymentGateway
      role: 执行者，只负责发起退款指令
      contract: pay.refund.callback.v1
      failure_semantics: 超时不代表失败，需等回调
```

### 流程（条件：有状态流转或异步步骤）

```yaml
flow:
  trigger: 买家申请退款
  steps:
    - step: 创建退款记录
    - step: 调用支付网关
    - step: 等待回调更新状态
  failure_branches:
    - when: 网关超时
      action: 标记待确认，不自动重试
  compensation:
    - when: 退款成功但订单状态未更新
      action: 补偿任务定时扫描
```

### 约束（条件：有不可破坏的不变量）

```yaml
constraints:
  - predicate: 退款金额不超过实付金额
    enforced_at: RefundService.createRefund
    violation_impact: 资损
```

### 代码改动面（条件：有非平凡的改动定位需求）

```yaml
change_surface:
  modules:
    - path: src/refund/service/RefundService.java
      responsibility: 退款核心逻辑
  entry_points:
    - POST /api/refund/create
  touch_when: 需求涉及退款金额计算或退款状态变更
  do_not_touch_when: 需求仅涉及退款页面展示
```

### 验证（条件：非平凡验证逻辑）

```yaml
verification:
  - goal: 退款金额计算正确
    oracle: RefundServiceTest#testPartialRefund
    rollback_signals: 退款成功率下降 > 5%
```

### 已知未知（条件：有需要升级的未知）

```yaml
unknowns:
  - statement: 部分退款的金额精度（分 vs 元）未确认
    blocked_decisions: 退款金额字段类型选择
    minimal_next_evidence: 产品确认精度要求
    action: stop_before_implementation
```

## 共享对象

只有同时满足以下条件的知识才独立成文件：

1. 被多个能力引用
2. 有独立的过期周期（变化节奏不跟着任何单一能力走）
3. 自身内容足够复杂，不适合内嵌到任何一份能力文档

### 典型共享对象

| 类型 | 示例 | 独立理由 |
|---|---|---|
| 复杂外部系统 | 支付网关集成边界 | 被多个能力引用，契约复杂，独立更新 |
| 核心状态机 | 订单状态机 | 被多个能力引用，状态转移复杂 |
| 跨域核心术语 | 货币单位定义 | 全局统一，避免各能力各写各的 |
| 历史决策 | 技术选型 ADR | 天然跨能力 |

### 不独立成文件的内容

| 类型 | 理由 |
|---|---|
| 只被一个能力使用的术语 | 内嵌到能力文档 |
| 简单接口的字段语义 | 内嵌到能力文档的边界段 |
| 单个能力内部的流程 | 内嵌到能力文档的流程段 |

### 共享对象的内部结构

与能力文档类似，但聚焦于单一维度（系统边界、状态机、术语等）。必须包含 `ref_by` 字段，标明被哪些能力引用。

```yaml
title: 支付网关集成边界
summary: 支付网关是外部系统，只负责执行支付/退款指令，不管业务语义
keywords: [支付, payment, pay-gateway, 支付网关]
id: SYS-PAY-GATEWAY
ref_by: [退款语义与计算规则, 订单创建与支付流程]

# ... 知识段 ...
```

## 对象关系

```text
能力文档（聚合根）
├── 包含 → 内嵌知识段（terms, boundary, flow, constraints, ...）
├── 引用 → 共享对象（通过显式链接）
└── 关联 → 其他能力文档（通过"参见"链接）

共享对象
├── 被引用 → 能力文档
└── 依赖 → 其他共享对象
```

关系在 catalog.yaml 中通过 `shared_refs` 和 `ref_by` 字段记录，Agent 可沿引用链追踪。
