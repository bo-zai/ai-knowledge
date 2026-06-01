# Agent 执行协议

## 协议目标

Agent 接到新需求后，应按以下步骤使用知识系统。目标是在最少的读取次数内，完成最准确的需求理解。

## 执行步骤

### Step 1. 需求解析

把需求拆成语义单元，标记每个单元的类型：

- `goal`：要做什么
- `constraint`：不能做什么
- `boundary`：边界在哪里
- `validation`：怎么证明做对了
- `unknown`：哪些地方信息不足

### Step 2. 目录激活

读 `catalog.yaml`，根据 activation 规则加载相关能力文档：

- `term_match` 命中 → 读取对应能力文档
- `path_match` 命中 → 读取对应能力文档
- `system_match` 命中 → 读取对应能力文档
- 多条规则同时命中 → 取并集

这一步只决定读取范围，不输出改动建议。

### Step 3. 术语锚定

从需求中提取核心名词和动词。

规则：

- 每个核心词必须在已加载的能力文档中找到对应术语
- 找不到时必须进入"已知未知"
- 禁止静默猜测

### Step 4. 边界锁定

从能力文档的"边界"段中读取：

- 本系统职责
- 外部系统职责
- source of truth
- 读写边界

在这一步完成前，禁止输出代码改动建议。

### Step 5. 当前行为重建

从能力文档的"流程"段中读取：

- 主路径
- 分支路径
- 失败语义
- 受影响契约

如果需要了解跨能力的状态流转，读取相关共享对象。

### Step 6. 约束提取

从能力文档的"约束"段中提取不可破坏清单。

每条约束必须记录：

- 约束内容
- 在哪里执行
- 违反后果

### Step 7. 改动面定位

从能力文档的"代码改动面"段中读取：

- 模块路径
- 入口点
- 什么时候该改
- 什么时候不该改

每个计划中的改动点必须绑定知识 ID。

### Step 8. 验证规划

从能力文档的"验证"段中读取：

- 验收目标
- 验收标准
- 关键验证路径

没有验证段的能力，任务不算 ready。

### Step 9. 未知升级

检查能力文档的"已知未知"段和 catalog 的全局门禁。

以下情况必须停下并提问：

- 核心术语无命中
- source of truth 冲突
- 外部系统存在但无契约描述
- 需求要求违反约束
- 没有可用验证方法
- 关键知识过期且没有替代证据
- 风险等级高但可信度不足

### Step 10. 计划输出

最终输出固定为以下结构：

```yaml
business_summary: "..."
term_mapping:
  退款: CAP-REFUND.terms.退款
boundary_decision:
  本系统: OrderService
  外部系统: PaymentGateway（只执行指令）
source_of_truth: OrderService 负责退款金额计算
affected_flows:
  - 退款申请流程
  - 退款回调处理
affected_contracts:
  - pay.refund.callback.v1
constraints:
  - 退款金额不超过实付金额
change_surface:
  - id: CAP-REFUND
    files: [src/refund/service/RefundService.java]
validation_plan:
  - goal: 退款金额计算正确
    oracle: RefundServiceTest#testPartialRefund
unknowns:
  - 部分退款精度未确认
knowledge_refs:
  - CAP-REFUND
  - SYS-PAY-GATEWAY
retrieved_objects:
  - CAP-REFUND
  - SYS-PAY-GATEWAY
  - STATE-ORDER
used_objects:
  - CAP-REFUND
  - SYS-PAY-GATEWAY
```

### Step 11. 证据检查

所有关键判断都必须引用知识 ID（`knowledge_refs`）。

没有引用的判断视为推测，必须显式标记。

### Step 12. 上下文使用检查

区分：

- `retrieved_objects`：任务过程中读取过的对象
- `used_objects`：最终判断中真正引用的对象

判断标准：

- 读取但未使用 → 上下文效率问题
- 最终判断无引用 → unsupported assumption
- 使用过期对象 → stale reliance

## 升级门禁汇总

| 触发条件 | 来源 | 行为 |
|---|---|---|
| 核心词无法命中任何能力 | catalog escalation | stop_and_ask |
| 核心术语未在能力文档中定义 | Step 3 | 进入已知未知 |
| source of truth 冲突 | Step 4 | stop_and_ask |
| 外部系统无契约描述 | Step 5 | warn_and_continue |
| 需求违反约束 | Step 6 | stop_and_ask |
| 无验证方法 | Step 8 | stop_before_implementation |
| 知识过期且无替代 | 能力文档 unknowns | stop_and_ask |
| 高风险 + 低可信 | 能力文档 unknowns | stop_and_ask |
