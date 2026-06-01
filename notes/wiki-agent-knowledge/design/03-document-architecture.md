# 文档架构

## 设计原则

Agent 不浏览目录。它通过以下链路获取知识：

```text
需求 → 读 catalog.yaml → 命中 activation 规则 → 拿到文件路径 → 读取文件
```

目录结构不影响 Agent 能否找到知识（catalog 负责定位），但影响读取效率和生成器的输出逻辑。

## 目录结构

按业务域组织，不按对象类型组织。

```text
bootstrap-knowledge/
├── catalog.yaml                  # Agent 检索路由表
├── objects/
│   ├── 退款/
│   │   └── 退款语义与计算规则.md
│   ├── 商品浏览/
│   │   └── 商品浏览与搜索.md
│   ├── 订单/
│   │   └── 订单创建与支付流程.md
│   └── _共享/
│       ├── 支付网关集成边界.md
│       └── 订单状态机.md
├── evidence/                     # 证据索引，可选
└── reports/                      # 生成报告，可选
```

设计决策：

- **按业务域组织目录**：Agent 处理一个需求时，相关对象大概率属于同一个域，按域组织减少跨目录跳转
- **中文目录名**：与文件名保持一致
- **`_共享/` 目录**：存放被多个能力引用的独立对象
- **没有 views 层**：能力文档已经是完整的，包含所有知识段，不需要额外的组合页

## catalog.yaml

catalog 是 Agent 的检索路由表，只管三件事：**路由、索引、全局门禁**。

### 完整结构

```yaml
version: 1

entry:
  summary: 本仓库业务知识索引，按需加载
  agent_must:
    - 规划非平凡改动前先读 catalog.yaml
    - 关键判断必须引用知识 ID
    - 命中升级门禁时必须停下提问

activation:
  term_match:
    退款: [退款语义与计算规则]
    refund: [退款语义与计算规则]
    商品: [商品浏览与搜索]
    下单: [订单创建与支付流程]
  path_match:
    src/order/**: [订单创建与支付流程, 退款语义与计算规则]
    src/goods/**: [商品浏览与搜索]
  system_match:
    pay-gateway: [退款语义与计算规则, 订单创建与支付流程]

capabilities:
  退款语义与计算规则:
    id: CAP-REFUND
    path: objects/退款/退款语义与计算规则.md
    keywords: [退款, refund, 部分退款, 全额退款]
    shared_refs: [支付网关集成边界, 订单状态机]

  商品浏览与搜索:
    id: CAP-GOODS-BROWSE
    path: objects/商品浏览/商品浏览与搜索.md
    keywords: [商品, 列表, 详情, 推荐]
    shared_refs: []

shared:
  支付网关集成边界:
    id: SYS-PAY-GATEWAY
    path: objects/_共享/支付网关集成边界.md
    ref_by: [退款语义与计算规则, 订单创建与支付流程]
  订单状态机:
    id: STATE-ORDER
    path: objects/_共享/订单状态机.md
    ref_by: [退款语义与计算规则, 订单创建与支付流程]

escalation:
  - when: 需求核心词无法命中任何能力的 keywords
    action: stop_and_ask
```

### entry 段

告诉 Agent 如何使用这份 catalog。常驻在 Agent 上下文中。

### activation 段

定义需求特征到能力的映射规则。三种匹配维度：

- **term_match**：需求中的业务词汇命中 → 加载对应能力
- **path_match**：代码路径模式命中 → 加载对应能力
- **system_match**：外部系统名称命中 → 加载对应能力

规则可以多条同时命中，Agent 取并集。

### capabilities 段

能力索引。每个条目包含：

- `id`：机器 ID，用于跨文档引用
- `path`：文件路径
- `keywords`：关键词列表
- `shared_refs`：依赖的共享对象标题列表

Agent 通过 `keywords` 判断是否需要读取，通过 `shared_refs` 知道还需要加载哪些共享对象。

### shared 段

共享对象索引。每个条目包含：

- `id`：机器 ID
- `path`：文件路径
- `ref_by`：引用它的能力列表

### escalation 段

全局升级门禁。定义 Agent 必须停下并提问的条件。

能力级的升级门禁放在能力文档内部的"已知未知"段，不放 catalog。

## Agent 读取链路

```text
Step 1: 读 catalog.yaml（一次性）
    ↓
Step 2: 通过 activation 规则匹配相关能力
    ↓
Step 3: 读能力文档（通常 1-2 个文件）
        看到 shared_refs → 知道还需要哪些共享对象
    ↓
Step 4: 按需读共享对象（仅在需要深入某个维度时）
```

典型场景下 3-4 次读取完成一个需求的完整上下文加载。

## 上下文分层

| 层 | 内容 | 加载时机 |
|---|---|---|
| hot | 入口文件（AGENTS.md / CLAUDE.md） | 常驻 |
| warm | catalog.yaml | 接到需求后第一个读取 |
| cold | 能力文档、共享对象 | 按需读取 |

## 入口文件规范

目标仓库的 `AGENTS.md` 或 `CLAUDE.md` 是 hot 层入口，只放最小路由和硬约束。

### 应该包含

```markdown
Before planning non-trivial code changes, read bootstrap-knowledge/catalog.yaml.
Use activation rules to load relevant capability documents.
Key judgments must cite knowledge IDs.
If an escalation gate is triggered, stop and ask instead of guessing.
```

### 不应该包含

- 完整业务流程
- API 字段语义
- 数据库字段解释
- 大量模块说明
- 历史讨论和设计 rationale

这些内容属于 cold 层，保留在能力文档和共享对象中。

## 文件格式

能力文档和共享对象统一使用 YAML frontmatter + markdown body 格式。

```markdown
---
title: "退款语义与计算规则"
summary: "买家发起的订单金额返还流程，涉及金额计算、状态流转和外部支付回调"
keywords: [退款, refund, 部分退款, 全额退款]
id: CAP-REFUND
shared_refs:
  - 支付网关集成边界
  - 订单状态机
---

# 退款语义与计算规则

## 核心内容

（能力的主体描述）

## 适用范围

- 适用：需求涉及退款金额计算、退款状态流转
- 不适用：跨境退款 → 参见「跨境退款处理」

## 术语

### 退款
- 定义：...
- 不等于：退货、售后

## 边界

（外部系统和所有权边界）

## 流程

（状态流转和异步步骤）

## 约束

（不可破坏的不变量）

## 代码改动面

（代码定位信息）

## 验证

（验收方法）

## 已知未知

（需要升级的未知）
```

frontmatter 存放结构化元数据，markdown body 存放连贯的知识正文。Agent 通过 frontmatter 做结构化查询，通过 body 获取完整知识。

## 关键纪律

1. 一条稳定事实只能有一个权威文件
2. 能力文档聚合和引用共享对象，不发明新事实
3. 没有"验证"段的能力，不应视为 ready
4. 没有"已知未知"段的能力，Agent 会更倾向于瞎猜
5. 入口文件只做路由，不承载业务知识
6. catalog.yaml 必须能解释每个能力为什么被加载
7. Agent 读取一个文件不等于理解它，关键判断必须引用知识 ID
8. 能力不能按 Controller、接口、Service、Mapper、方法逐个生成
9. 复杂项目必须有能力预算和合并规则
10. 只有能改变 Agent 判断的内容才进入知识包，单纯重复代码事实的内容不应进入
