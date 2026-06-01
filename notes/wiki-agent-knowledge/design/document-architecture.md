# 文档架构与检索协议

## 0. 与当前项目的目录映射

本文最初使用 `wiki/` 描述目标知识层，这是设计阶段的通用名称。

在当前 `ai-wiki` 项目中，实际落盘目录是目标仓库下的 `bootstrap-knowledge/`：

- `wiki/catalog.yaml` 对应 `bootstrap-knowledge/catalog.yaml`
- `wiki/objects/` 对应 `bootstrap-knowledge/objects/`
- `wiki/pages/` 对应 `bootstrap-knowledge/pages/` 或当前实现中的 `bootstrap-knowledge/views/`

无论目录名是 `pages/` 还是 `views/`，语义都相同：它们是组合页，只能编排对象，不能新增权威事实。

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

## 3. 业务能力粒度

`CAP` 的粒度是业务需求归因单元，不是代码入口单元。

生成器必须先聚合入口、模块、表、术语和行为证据，再决定是否生成 `CAP`。Controller 方法、Service 方法、Mapper SQL、Job handler、Consumer handler 默认只能作为 evidence、entrypoint、maps 或 `MOD` 锚点，不能直接提升为业务能力。

推荐层级：

```text
Domain
└── Capability
    └── Scenario
        └── Entry
            └── Code Anchor
```

示例：

```text
商城
└── 商品浏览与搜索
    ├── 商品列表查询
    │   └── POST /goods/list
    ├── 商品详情查询
    │   └── POST /goods/getDetail
    ├── 推荐商品
    │   └── POST /goods/getRecommendGoods
    └── 搜索历史写入
        └── GoodsService.queryPageGoods -> SearchHistoryService.save
```

判断候选功能是否能提升为独立 `CAP`，至少应满足以下条件中的多项：

- 真实需求会独立提到该能力。
- 有独立业务目标，而不是某个接口的普通副作用。
- 涉及多个模块、数据表、外部系统或状态流转。
- 有独立验收 oracle。
- 有容易误判的边界、source of truth、权限、幂等、失败语义或补偿逻辑。
- 历史需求、review、bug 或 incident 中反复出现。
- 不沉淀会导致 Agent 改错位置、漏掉约束或漏掉验证。

以下内容默认不生成独立 `CAP`：

- 薄 Controller 方法。
- 单表简单 CRUD。
- 私有 helper 方法。
- Mapper 中单条 SQL。
- 读代码很快可得且没有业务决策价值的实现细节。

这些内容应进入：

- `maps/entrypoints.yaml`
- `maps/module-map.yaml`
- `evidence/index.jsonl`
- 或被已有 `MOD`、`FLOW`、`CON` 引用。

## 4. 生成预算与合并规则

复杂项目不能无限生成业务功能文档。生成器应有明确预算：

```yaml
generation_budget:
  max_capabilities: 30
  max_objects_per_capability: 8
  max_total_objects: 180
  min_capability_score: 0.65
  merge_if_shared_modules_above: 0.60
  merge_if_shared_terms_above: 0.70
```

候选能力评分建议包含：

```yaml
capability_score:
  requirement_likelihood:
  business_semantics:
  change_surface_size:
  risk_level:
  validation_value:
  ambiguity_risk:
```

评分语义：

- `requirement_likelihood`
  - 未来真实需求是否会自然提到该能力。
- `business_semantics`
  - 是否承载业务目标，而不是纯技术入口。
- `change_surface_size`
  - 是否跨 Controller、Service、Mapper、表、配置、外部系统。
- `risk_level`
  - 是否涉及权限、支付、状态、数据一致性、隐私、审计等高风险区域。
- `validation_value`
  - 是否能提供明确验收 oracle。
- `ambiguity_risk`
  - Agent 是否容易误解术语、边界或改动面。

合并规则：

- 多个入口共享相同业务目标、核心术语、主要模块和验证方式时，应合并为一个 `CAP`，入口作为 scenarios。
- 一个入口只是另一个能力的副作用时，应作为 `FLOW` 或 `CON` 的步骤，不应独立成 `CAP`。
- 如果两个候选能力有不同 source of truth、状态机、外部系统、验收 oracle 或风险边界，可以拆分。

示例：

```text
CAP-GOODS-LIST
CAP-GOODS-DETAIL
CAP-GOODS-RECOMMEND
```

通常应合并为：

```text
CAP-GOODS-BROWSE-SEARCH
```

并在 view 中表达：

```yaml
scenarios:
  - goods_list_query
  - goods_detail_query
  - recommended_goods_query
  - search_history_write_side_effect
```

而下面这些通常可以拆分：

```text
CAP-ORDER-CREATE
CAP-ORDER-PAYMENT
CAP-ORDER-CANCEL
```

因为它们往往有不同状态、契约、验证方式和风险边界。

## 5. 知识晋升机制

不是所有证据都应该变成对象。

推荐晋升链路：

```text
raw evidence
-> candidate claim
-> knowledge object
-> capability view
```

晋升规则：

- `raw evidence`
  - 代码、SQL、配置、测试、日志、接口文档、图谱边。
  - 默认只进入 `evidence/` 或 `maps/`。
- `candidate claim`
  - 从证据中抽出的候选断言。
  - 需要经过证据、风险和任务价值判断。
- `knowledge object`
  - 通过校验、可引用、可过期判断、能影响 Agent 决策的稳定断言。
- `capability view`
  - 面向任务把对象编排成需求理解视图，不新增权威事实。

只有能改变 Agent 判断的内容才进入稳定对象层。

单纯重复代码事实、低频实现细节、一次性需求背景和无法验证的猜测，不应进入稳定对象层。

## 6. 组合页正文结构

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

## 7. catalog.yaml

知识系统需要一份机器可读索引。它不是简单目录，而是 `Agent 检索路由表`。

它至少负责：

1. 告诉 Agent 先读什么类型
2. 告诉 Agent 对象在哪个路径
3. 告诉 Agent 哪些对象与哪些 capability 相关
4. 告诉系统哪些变更会让对象可能过期
5. 定义未知升级规则
6. 定义对象触发条件、加载优先级和依赖顺序
7. 区分必须常驻的入口上下文与按需读取的冷知识
8. 定义对象过期、低可信或高风险时的使用策略

建议结构：

```yaml
version:
retrieval_order:
activation:
capabilities:
objects:
maps:
unknown_escalation_rules:
usage_policy:
```

建议语义：

```yaml
version: 1

entry:
  summary: bootstrap-knowledge is cold knowledge for coding agents.
  agent_must:
    - read catalog.yaml before planning non-trivial changes
    - cite object ids for key judgments
    - stop when an OPEN gate is triggered

retrieval_order:
  - TERM
  - CAP
  - SYS
  - OWN
  - CON
  - FLOW
  - MOD
  - VER
  - OPEN

activation:
  always:
    - catalog.index
  term_match:
    refund:
      - TERM-REFUND
      - CAP-ORDER-REFUND
  path_match:
    src/order/**:
      - MOD-ORDER
  system_match:
    pay-gateway:
      - SYS-PAY-GATEWAY
      - CON-PAY-REFUND-CALLBACK
      - OWN-REFUND-FINALITY
  manual:
    - OPEN-REFUND-MANUAL-SUCCESS

objects:
  TERM-REFUND:
    path: objects/terms/TERM-REFUND.md
    confidence: high
    risk_if_wrong: medium
    depends_on: []
    stale_if:
      paths:
        - src/order/**
      symbols:
        - RefundService

unknown_escalation_rules:
  - id: missing-core-term
    when: no TERM or CAP matches a core noun in the request
    action: stop_and_ask
  - id: missing-verification
    when: affected capability has no VER object
    action: stop_before_implementation
```

`activation` 借鉴规则系统的触发模式，但它不表达编码规范，而是表达知识对象何时进入上下文。

`always` 只能放极少量入口和路由信息。业务事实、契约细节、模块说明和验证细节应通过 `term_match`、`path_match`、`system_match` 或 Agent 主动请求按需加载。

`manual` 用于需要人工显式确认的对象，尤其是 `OPEN`、高风险外部系统、低可信对象和安全边界。

## 8. 入口文件与上下文分层

目标仓库可以有 `AGENTS.md`、`CLAUDE.md`、Copilot instructions 或其他 Agent 入口文件，但这些入口不应复制 `bootstrap-knowledge/` 的事实内容。

推荐分层：

- `hot entry`
  - 常驻入口，只放最小路由、硬约束和读取协议
  - 例如：先读 `bootstrap-knowledge/catalog.yaml`，关键判断必须引用对象 ID，命中 `OPEN` gate 必须停下
- `warm routing`
  - `bootstrap-knowledge/catalog.yaml`
  - 负责把需求、路径、系统、风险映射到对象和视图
- `cold knowledge`
  - `objects/`、`views/`、`evidence/`、`reports/`
  - 只在任务需要时读取

入口文件建议内容：

```md
# Agent Entry

Before planning non-trivial code changes, read bootstrap-knowledge/catalog.yaml.
Use the catalog activation rules to load only relevant objects.
Key judgments must cite object IDs.
If an OPEN gate is triggered, stop and ask instead of guessing.
```

不建议放入入口文件的内容：

- 完整业务流程
- API 字段语义
- 数据库字段解释
- 大量模块说明
- 历史讨论和设计 rationale

这些内容应保留在 `bootstrap-knowledge/` 的对象、视图、证据和报告中。

## 9. 代码地图层

业务知识对象解决“需求是什么意思”和“边界在哪里”，但 Agent 还需要快速获得代码结构地图。

建议在 `bootstrap-knowledge/` 中保留轻量 `maps/` 层：

```text
bootstrap-knowledge/
├── maps/
│   ├── repo-map.md
│   ├── module-map.yaml
│   └── entrypoints.yaml
```

职责划分：

- `repo-map.md`
  - 给出目标仓库的紧凑结构图，只保留主要目录、关键文件、主要类/函数/接口和重要调用关系
- `module-map.yaml`
  - 把目录、模块、包名、测试位置和对象 ID 关联起来
- `entrypoints.yaml`
  - 记录 Controller、CLI、Job、Consumer、Webhook、Mapper 等入口

`maps/` 不替代 `MOD` 对象。

- `maps/` 负责快速定位和减少上下文搜索成本
- `MOD` 负责表达模块职责、什么时候该改、什么时候不该改、验证锚点和边界风险

## 10. Agent 接到新需求后的执行协议

### Step 1. Requirement Parse

把需求拆成句级单元，并标记为：

- `goal`
- `constraint`
- `boundary`
- `validation`
- `unknown`

### Step 2. Catalog Activation

根据 `catalog.yaml` 的触发规则加载最小上下文：

- 命中 `term_match` 时读取相关 `TERM`、`CAP`
- 命中 `path_match` 时读取相关 `MOD`
- 命中 `system_match` 时读取相关 `SYS`、`OWN`、`CON`
- 命中 `OPEN` gate 时停止计划并提出问题

这一步只决定读取范围，不输出改动建议。

### Step 3. Term Grounding

抽取需求里的核心名词和动作。

规则：

- 每个核心词必须命中 `TERM` 或 `CAP`
- 命不中时必须进入 `OPEN`
- 禁止静默猜测

### Step 4. Boundary Lock

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

### Step 5. Current Behavior Reconstruction

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

### Step 6. Constraint Extraction

读取：

- `INV`
- `DEC`
- `OWN`

产出不可破坏清单。

### Step 7. Change Surface Localization

读取：

- `MOD`
- `maps/module-map.yaml`
- `maps/entrypoints.yaml`

每个计划中的改动点必须绑定至少一个 `MOD-*`。

### Step 8. Validation Planning

读取：

- `VER`

每个验收点必须绑定至少一个 `VER-*`。
没有验证对象则任务不算 ready。

### Step 9. Unknown Escalation

以下情况必须停下并提问：

- 核心术语无命中
- source of truth 冲突
- 外部系统存在但无契约对象
- 需求要求违反 `OWN` / `INV`
- 没有可用验证对象
- 关键对象过期且没有替代证据
- 对象风险等级为 `high` / `critical` 但可信度不足

### Step 10. Plan Output

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
knowledge_refs:
retrieved_objects:
used_objects:
```

### Step 11. Evidence Check

所有关键判断都必须引用对象 ID。
没有引用的判断视为推测。

### Step 12. Context Use Check

Agent 应区分：

- `retrieved_objects`
  - 任务过程中读取过的对象
- `used_objects`
  - 最终判断中真正引用或改变决策的对象

如果读取对象很多但最终没有使用，应视为上下文效率问题。

如果最终判断没有对象引用，应视为 unsupported assumption。

## 11. 推荐目录结构

```text
bootstrap-knowledge/
├── catalog.yaml
├── maps/
│   ├── repo-map.md
│   ├── module-map.yaml
│   └── entrypoints.yaml
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
└── views/
    ├── capabilities/
    ├── external-systems/
    ├── entities/
    ├── modules/
    └── runbooks/
```

## 12. 关键纪律

1. 一条稳定事实只能有一个权威对象文件。
2. 组合页只能聚合，不新增事实。
3. 没有 `VER` 的能力对象，不应视为 ready。
4. 没有 `OPEN` 能力的系统，Agent 会更倾向于瞎猜。
5. 常驻入口只做路由，不承载百科事实。
6. `catalog.yaml` 必须能解释对象为什么被加载。
7. 对象被读取不等于对象有效，最终判断必须引用对象 ID。
8. `CAP` 不能按 Controller、接口、Service、Mapper、方法逐个生成。
9. 复杂项目必须有能力预算和合并规则。
10. 证据默认停留在 evidence 或 maps，只有能改变 Agent 决策的断言才提升为知识对象。
