# 文档架构与检索协议

## 1. 权威对象文件与组合页

文档架构采用两层：

- `权威对象文件`
  - 一文件一对象
  - 是唯一事实来源
  - 可被独立检索、验证、标记过期
- `组合页`
  - 只负责为特定场景编排对象
  - 不发明新事实
  - 通过链接把对象组织成“需求理解视图”

这样做的目的：

- 避免同一条知识散落在多页中失控
- 便于做对象级 `ablation`
- 便于局部失效和复核

## 2. 组合页类型

建议保留 5 类组合页：

### Capability Page

最重要的组合页，面向“收到新需求后，Agent 是否知道要改什么”。

内容通常聚合：

- `TERM`
- `ACTOR`
- `CAP`
- `SYS`
- `OWN`
- `FLOW`
- `CON`
- `INV`
- `MOD`
- `VER`
- `OPEN`

### External System Page

专门面向外部系统边界判断。

内容通常聚合：

- `SYS`
- `OWN`
- `CON`
- `FLOW`
- `VER`
- `OPEN`

### Domain Entity Page

描述核心对象的语义、状态与不变量。

内容通常聚合：

- `TERM`
- `STATE`
- `INV`

### Module Page

连接“业务理解”和“代码落点”。

内容通常聚合：

- `MOD`
- `OWN`
- `DEC`
- `VER`

### Runbook / Failure Page

服务于失败语义、联调、发布与排障。

内容通常聚合：

- `FLOW`
- `CON`
- `VER`
- `OPEN`

## 3. 组合页正文结构

推荐的 `Capability Page` 正文结构：

```md
# CAP-XXX

## Requirement Intent
## Actors
## Boundary
## Current Behavior
## Constraints
## Code Anchors
## Validation
## Unknowns and Escalation
```

推荐的 `External System Page` 正文结构：

```md
# SYS-XXX

## System Identity
## Ownership Boundary
## Contracts
## Failure Semantics
## Code Anchors
## Verification
## Escalation
```

规则：

- `H2` 是固定语义区块
- `H3` 对应一个对象引用或一条对象级知识块
- 组合页不新增权威事实，只做引用和最小摘要

## 4. catalog.yaml

知识系统需要一份机器可读索引。它不是简单目录，而是 `Agent 检索路由表`。

它至少负责：

1. 告诉 Agent 先读什么类型
2. 告诉 Agent 对象在哪个路径
3. 告诉 Agent 哪些对象与哪些 capability 相关
4. 告诉系统哪些变更会让对象可能过期
5. 定义未知升级规则

建议结构：

```yaml
version:
retrieval_order:
capabilities:
objects:
unknown_escalation_rules:
```

## 5. Agent 接到新需求后的执行协议

### Step 1. Requirement Parse

把需求拆成句级单元，并标记为：

- `goal`
- `constraint`
- `boundary`
- `validation`
- `unknown`

### Step 2. Term Grounding

抽取需求里的核心名词和动作。

规则：

- 每个核心词必须命中 `TERM` 或 `CAP`
- 命不中时必须进入 `OPEN`
- 禁止静默猜测

### Step 3. Boundary Lock

优先读取：

- `SYS`
- `OWN`
- `CON`

在这一步完成前，禁止输出代码改动建议。

必须先回答：

- 本系统职责
- 外部系统职责
- source of truth
- 读写边界

### Step 4. Current Behavior Reconstruction

读取：

- `FLOW`
- `STATE`
- `CON`
- 或对应的 `Capability Page`

产出：

- 主路径
- 分支路径
- 失败语义
- 受影响契约

### Step 5. Constraint Extraction

读取：

- `INV`
- `DEC`
- `OWN`

产出不可破坏清单。

### Step 6. Change Surface Localization

读取：

- `MOD`

每个计划中的改动点必须绑定至少一个 `MOD-*`。

### Step 7. Validation Planning

读取：

- `VER`

每个验收点必须绑定至少一个 `VER-*`。
没有验证对象则任务不算 ready。

### Step 8. Unknown Escalation

以下情况必须停下并提问：

- 核心术语无命中
- source of truth 冲突
- 外部系统存在但无契约对象
- 需求要求违反 `OWN` / `INV`
- 没有可用验证对象

### Step 9. Plan Output

最终输出建议固定为：

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

### Step 10. Evidence Check

所有关键判断都必须引用对象 ID。
没有引用的判断视为推测。

## 6. 推荐目录结构

```text
wiki/
├── catalog.yaml
├── objects/
│   ├── terms/
│   ├── capabilities/
│   ├── systems/
│   ├── ownership/
│   ├── contracts/
│   ├── modules/
│   ├── validation/
│   ├── decisions/
│   ├── invariants/
│   ├── states/
│   └── open/
└── pages/
    ├── capabilities/
    ├── external-systems/
    ├── entities/
    ├── modules/
    └── runbooks/
```

## 7. 关键纪律

1. 一条稳定事实只能有一个权威对象文件。
2. 组合页只能聚合，不新增事实。
3. 没有 `VER` 的能力对象，不应视为 ready。
4. 没有 `OPEN` 能力的系统，Agent 会更倾向于瞎猜。
