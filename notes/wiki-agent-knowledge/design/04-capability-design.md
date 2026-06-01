# 业务能力设计

## 能力发现

生成器如何从代码仓库发现候选业务能力，是整个管线最关键的一步。

### 候选能力来源

1. **Controller / API 入口**
   - HTTP 接口暴露了业务能力的外边界
   - 但不是每个 Controller 方法都是一个业务能力——需要过滤薄包装和纯 CRUD

2. **执行流（execution flow）**
   - 通过代码图谱追踪从入口到数据库的完整调用链
   - 多个入口可能共享同一条执行流，聚合后形成能力

3. **数据表聚类**
   - 同一张核心表被多个入口操作，暗示它们属于同一个业务能力
   - 例：`orders` 表被创建、支付、取消、退款多个入口操作

4. **配置与 Job**
   - 定时任务、批处理、消息消费者等异步入口
   - 它们代表的行为也是业务能力

### 发现流程

```text
原始入口（Controller、Job、Consumer）
    ↓ 执行流追踪
入口聚类（按共享表、共享 Service、共享术语）
    ↓ 业务语义评分
候选能力列表
    ↓ 合并/拆分规则
最终能力列表
```

## 能力粒度

能力的粒度是**业务需求归因单元**，不是代码入口单元。

推荐层级：

```text
Domain（域）
└── Capability（能力）
    └── Scenario（场景）
        └── Entry（入口）
            └── Code Anchor（代码锚点）
```

示例：

```text
商品
└── 商品浏览与搜索
    ├── 商品列表查询 → POST /goods/list
    ├── 商品详情查询 → POST /goods/getDetail
    ├── 推荐商品 → POST /goods/getRecommendGoods
    └── 搜索历史写入 → GoodsService.queryPageGoods -> SearchHistoryService.save
```

### 判断标准

候选能否提升为独立能力，至少满足多项：

- 真实需求会独立提到该能力
- 有独立业务目标，不是某个接口的普通副作用
- 涉及多个模块、数据表、外部系统或状态流转
- 有独立验收标准
- 有容易误判的边界、source of truth、权限、幂等、失败语义或补偿逻辑
- 历史需求、review、bug 或 incident 中反复出现
- 不沉淀会导致 Agent 改错位置、漏掉约束或漏掉验证

### 不应成为独立能力的内容

- 薄 Controller 方法
- 单表简单 CRUD
- 私有 helper 方法
- Mapper 中单条 SQL
- 读代码很快可得且没有业务决策价值的实现细节

这些应进入能力文档的"代码改动面"段，或被已有 FLOW、CON 引用。

## 能力评分

生成器对候选能力评分，筛选出真正的业务能力。

```yaml
capability_score:
  requirement_likelihood: 0.8    # 未来需求是否会提到
  business_semantics: 0.9        # 是否承载业务目标
  change_surface_size: 0.7       # 是否跨多个模块/表/系统
  risk_level: 0.6                # 是否涉及高风险区域
  validation_value: 0.8          # 能否提供明确验收标准
  ambiguity_risk: 0.7            # Agent 是否容易误解
```

评分语义：

| 维度 | 含义 |
|---|---|
| requirement_likelihood | 未来真实需求是否会自然提到该能力 |
| business_semantics | 是否承载业务目标，而不是纯技术入口 |
| change_surface_size | 是否跨 Controller、Service、Mapper、表、配置、外部系统 |
| risk_level | 是否涉及权限、支付、状态、数据一致性、隐私、审计 |
| validation_value | 是否能提供明确验收标准 |
| ambiguity_risk | Agent 是否容易误解术语、边界或改动面 |

## 合并规则

多个入口满足以下条件时应合并为一个能力：

- 共享相同业务目标
- 共享核心术语
- 共享主要模块和验证方式

合并后，入口作为能力文档内的 `scenarios` 字段表达。

如果一个入口只是另一个能力的副作用，应作为流程段中的步骤，不应独立成能力。

## 拆分规则

如果两个候选有以下差异，可以拆分：

- 不同 source of truth
- 不同状态机
- 不同外部系统
- 不同验收标准
- 不同风险边界

## 合并/拆分示例

通常应合并：

```text
CAP-GOODS-LIST      ─┐
CAP-GOODS-DETAIL     ├─→ 商品浏览与搜索
CAP-GOODS-RECOMMEND ─┘
```

理由：共享核心术语（商品）、核心模块（GoodsService）和验证方式（查询返回正确结果）。

通常应拆分：

```text
订单创建与支付流程
退款语义与计算规则
订单取消处理
```

理由：有不同状态、契约、验证方式和风险边界。

## 生成预算

复杂项目不能无限生成能力文档。生成器应有明确预算：

```yaml
generation_budget:
  max_capabilities: 30
  min_capability_score: 0.65
  merge_if_shared_modules_above: 0.60
  merge_if_shared_terms_above: 0.70
```

## 知识晋升

不是所有证据都应该变成知识。推荐晋升链路：

```text
原始证据（代码、SQL、配置、测试、日志、接口文档、图谱边）
    ↓
候选断言（从证据中抽出的待评估知识）
    ↓
知识段 / 共享对象（通过校验、可引用、可过期的稳定知识）
```

晋升规则：

- **原始证据**：默认只进入 `evidence/` 或内嵌在知识段中作为引用
- **候选断言**：需要经过证据、风险和任务价值判断
- **知识段/共享对象**：可引用、可过期、能影响 Agent 决策的稳定知识

只有能改变 Agent 判断的内容才进入稳定知识层。单纯重复代码事实、低频实现细节、一次性需求背景和无法验证的猜测，不应进入。
