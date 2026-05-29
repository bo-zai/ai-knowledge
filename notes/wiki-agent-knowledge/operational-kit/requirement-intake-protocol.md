# Requirement Intake Protocol

这个协议定义了：当 Agent 收到一份新的需求文档时，必须按什么顺序读取知识、输出什么结果、在什么情况下停止猜测并升级提问。

## 目标

把“读需求”这件事从随意行为变成可验证流程。

## 输入

- 一份真实需求文档
- `catalog.yaml`
- 相关对象文件
- 相关组合页

## 输出

固定输出结构：

```yaml
business_summary:
term_mapping:
boundary_decision:
systems_involved:
source_of_truth:
affected_flows:
affected_contracts:
constraints:
change_surface:
validation_plan:
unknowns:
```

## 协议步骤

### Step 1. Parse Requirement

把需求拆成原子句，并按下列标签分类：

- `goal`
- `constraint`
- `boundary`
- `acceptance`
- `unknown`

禁止在这一步输出实现建议。

### Step 2. Ground Terms

对需求中的核心名词和动作逐项查找：

- `TERM`
- `CAP`

要求：

- 每个核心词必须命中对象，或被记为 `unknown`
- 若核心业务词无命中，必须进入升级提问

### Step 3. Lock Boundary

读取：

- `SYS`
- `OWN`
- `CON`

必须先回答：

- 本系统负责什么
- 外部系统负责什么
- 谁是 source of truth
- 哪些状态或字段不能直接写

在边界未锁定前，禁止输出代码改动点。

### Step 4. Reconstruct Current Behavior

读取：

- `FLOW`
- `STATE`
- `CON`
- 或 capability 组合页

产出：

- 当前主路径
- 当前分支路径
- 当前失败语义
- 当前副作用和补偿点

### Step 5. Extract Constraints

读取：

- `INV`
- `DEC`
- `OWN`

产出：

- 不可破坏的不变量
- 不能违背的历史决策
- 边界禁区

### Step 6. Localize Change Surface

读取：

- `MOD`

要求：

- 每一个改动建议都必须绑定至少一个 `MOD-*`
- 找不到代码落点时，必须进入 `unknowns`

### Step 7. Build Validation Plan

读取：

- `VER`

要求：

- 每个主要改动都要有验证方式
- 验证至少覆盖：单测、集成、观测、必要时回滚信号
- 若缺失验证对象，任务不算 ready

### Step 8. Escalate Unknowns

以下任一情况，必须升级提问：

- 核心术语没有对象
- source of truth 冲突
- 外部系统存在但无契约对象
- 需求要求与 `OWN` / `INV` 冲突
- 没有验证对象
- 现有对象之间存在冲突

### Step 9. Emit Structured Plan

最终只能输出结构化结果，不允许只给自由文本摘要。

## 执行纪律

1. 没有对象引用的关键判断视为推测
2. 没有验证计划的 change plan 不算完成
3. `unknowns` 不是失败，而是防止幻觉的正常产物
4. 如果发现对象 stale，应优先标记风险，而不是忽略

## 最小合格标准

一次需求 intake 至少满足：

- 所有核心术语已映射或显式未知
- 边界和 source of truth 已明确
- 改动点已绑定代码对象
- 验证计划已落到 `VER`
- 未知项已显式升级

