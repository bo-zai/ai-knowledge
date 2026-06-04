# 知识库目录结构

本文定义 `ai-knowledge/` 知识库的文件组织方式、命名规则、索引结构和文件间引用机制。

## 总体结构

知识库采用统一的目录结构，所有项目使用相同的组织方式，不按项目规模做自适应。

```
ai-knowledge/
├── index.md                        # 总索引
│
├── capabilities/                   # 能力目录知识
│   ├── _index.md
│   └── {domain}.md                 # 每个能力域一个文件
│
├── concepts/                       # 概念知识
│   ├── _index.md
│   ├── _glossary.md                # 术语速查表
│   └── {concept}.md                # 每个业务概念一个文件
│
├── boundaries/                     # 边界知识
│   ├── _index.md
│   └── {boundary}.md               # 每条边界一个文件
│
├── external-systems/               # 外部系统交互知识
│   ├── _index.md
│   └── {system}.md                 # 每个外部系统一个文件
│
├── constraints/                    # 约束知识
│   ├── _index.md
│   └── {constraint}.md             # 每条约束一个文件
│
├── relations/                      # 能力关系知识
│   ├── _index.md
│   └── {relation}.md               # 每条关系一个文件
│
├── data-model/                     # 数据模型知识
│   ├── _index.md
│   └── {aggregate}.md              # 每个业务聚合一个文件
│
└── workflows/                      # 跨域业务流程知识
    ├── _index.md
    └── {workflow}.md               # 每条跨域流程一个文件
```

共 9 个目录（含根目录），每个目录一个 `_index.md`，`concepts/` 额外有一个 `_glossary.md`，加上一个全局 `index.md`。

## 文件命名规则

### 文件名

- 使用 `kebab-case`（如 `order-status.md`、`student-bind-limit.md`）
- 文件名应能反映条目内容，便于 Agent 从文件名判断是否需要读取
- 不使用数字前缀、不使用空格、不使用非 ASCII 字符
- 同一目录内文件名不重复

### 特殊文件

- `index.md`：全局总索引，位于 `ai-knowledge/` 根目录
- `_index.md`：各知识类型目录的内部索引，以 `_` 前缀区分
- `_glossary.md`：概念知识的术语速查表，仅位于 `concepts/` 目录

## 索引体系

知识库有两层索引：全局索引（`index.md`）和类型索引（`_index.md`）。

### index.md：全局总索引

Agent 读取知识库时第一个打开的文件。它列出所有 8 类知识的概要，使 Agent 能判断哪些知识与当前需求相关，按需读取详情文件。

index.md 的结构：

```markdown
# {项目名称} - 知识库索引

## 能力目录
| 域名 | 描述 | 文件 |
|------|------|------|
| 订单管理 | 商品购买的订单全生命周期管理 | [capabilities/order.md](capabilities/order.md) |
| 教学管理 | 课表制定、课件练习、打分评价 | [capabilities/teach.md](capabilities/teach.md) |

## 概念知识
| 概念 | 简要说明 | 文件 |
|------|---------|------|
| 用户角色 | 学生、教师、高级教师等六种角色 | [concepts/user-role.md](concepts/user-role.md) |
| 课件类型 | 曲目课件和教学内容课件的区分 | [concepts/courseware-type.md](concepts/courseware-type.md) |

## 边界知识
| 边界 | 类型 | 文件 |
|------|------|------|
| 支付渠道局限 | 局限性 | [boundaries/payment-channels.md](boundaries/payment-channels.md) |

## 外部系统交互
| 外部系统 | 交互目的 | 文件 |
|---------|---------|------|
| 微信支付 | 在线支付 | [external-systems/wechat-pay.md](external-systems/wechat-pay.md) |

## 约束知识
| 约束 | 类型 | 文件 |
|------|------|------|
| 学生绑定频率限制 | 业务规则 | [constraints/student-bind-limit.md](constraints/student-bind-limit.md) |

## 能力关系
| 关系 | 类型 | 文件 |
|------|------|------|
| 课表制定触发积分 | 触发链 | [relations/timetable-integral.md](relations/timetable-integral.md) |

## 数据模型
| 聚合 | 描述 | 文件 |
|------|------|------|
| 课表 | 周学习计划，含课程和课件 | [data-model/course.md](data-model/course.md) |

## 跨域业务流程
| 流程 | 业务目标 | 文件 |
|------|---------|------|
| 商品购买全流程 | 从浏览商品到完成支付的购买路径 | [workflows/purchase-flow.md](workflows/purchase-flow.md) |
```

index.md 的生成约束：

- 每条概要不超过一句话
- 文件链接使用相对路径，确保 Agent 可以直接拼接路径读取
- 总 token 量应控制在 1500 以内

### _index.md：类型内部索引

各知识类型目录下的 `_index.md` 列出该类型下所有条目的名称、简要说明和文件路径。

当 Agent 需要扫描某个类型下的全部条目时使用。

_index.md 的结构以 capabilities 为例：

```markdown
# 能力目录索引

| 域名 | 描述 | 操作数 | 标签 | 文件 |
|------|------|--------|------|------|
| 订单管理 | 商品购买的订单全生命周期管理 | 5 | 订单、交易、购买 | [order.md](order.md) |
| 教学管理 | 课表制定、课件练习、打分评价 | 8 | 课表、课件、教学 | [teach.md](teach.md) |
| 用户管理 | 登录、注册、师徒绑定、会员管理 | 6 | 用户、登录、会员 | [user.md](user.md) |
```

其他类型的 `_index.md` 结构相同，只是第一列名称和辅助信息列不同。以约束知识为例：

```markdown
# 约束知识索引

| 约束 | 类型 | 描述 | 标签 | 文件 |
|------|------|------|------|------|
| 学生绑定频率限制 | 业务规则 | 同一学生一年只能绑定一次老师 | 师徒、绑定、频率限制 | [student-bind-limit.md](student-bind-limit.md) |
| 实物商品地址要求 | 业务规则 | 实物商品订单必须提供收货地址 | 订单、地址、实物商品 | [physical-goods-address.md](physical-goods-address.md) |
```

_index.md 的生成约束：

- 每条简要说明不超过一句话
- 包含条目数量等辅助信息（如能力域的操作数、聚合的实体数）
- 标签列列出该条目的 1~3 个关键词标签，用于 Agent 快速匹配

### _glossary.md：术语速查表

`concepts/` 目录下额外生成一个 `_glossary.md` 文件，是概念知识条目的术语投影。Agent 在需求澄清阶段需要快速确认"需求文档中的某个术语在当前仓库中是什么意思"时，可以一次加载该文件完成术语匹配，无需逐条扫描概念知识详情。

_glossary.md 的结构：

```markdown
# 术语速查

| 术语 | 定义 | 别名 | 详情 |
|------|------|------|------|
| 课表 | 按周组织的学习计划，包含课程和关联课件 | 课程表、Timetable | [timetable.md](timetable.md) |
| 师徒关系 | 学生与教师之间的绑定指导关系 | 绑定、bind | [teacher-student-bind.md](teacher-student-bind.md) |
| 课件类型 | 课件的分类标识，决定数据来源和属性结构 | 课件分类、CoursewareType | [courseware-type.md](courseware-type.md) |
```

_glossary.md 的生成约束：

- 每行对应概念知识中的一个条目，术语和定义从概念知识中直接提取
- 别名来自概念知识条目的"别名"字段
- 详情链接指向对应的概念知识详情文件
- 术语按业务领域分组排列，不做字母排序
- 当 Agent 在术语速查中未命中某个术语时，应回退到 `index.md` 全局索引中按名称或描述搜索该术语可能对应的能力域、数据聚合或其他知识条目

## 跨文件引用

知识条目之间可以互相引用。引用时使用相对路径链接到目标文件。

### 引用规则

- 引用另一个知识条目：使用 `[条目名称](相对路径)` 格式
- 引用代码位置：使用 `[文件名#方法名](相对路径)` 格式，路径指向仓库源码
- 同类型内的引用和跨类型的引用使用相同的链接格式

### 引用示例

在 `capabilities/order.md` 中引用概念知识和约束知识：

```markdown
## 订单管理

域描述：商品购买的订单全生命周期管理，包括创建、支付、取消、查询和再次购买。
适用范围：仅适用于实物商品和虚拟商品的购买订单，不适用于退款流程。
入口类：OrderController

| 操作名称 | 访问方式 | 方法位置 | 描述 | 标签 |
|---------|---------|---------|------|------|
| 创建订单 | POST /order/submit | OrderController.submit() | 提交商品购买订单，完成商品校验、库存扣减和优惠券核销。仅支持 [支付宝](../external-systems/alipay.md) 和 [微信支付](../external-systems/wechat-pay.md)。实物商品必须提供收货地址，见 [实物商品地址要求](../constraints/physical-goods-address.md)。涉及 [订单聚合](../data-model/order.md) 中的 OrderDO 和 OrderGoodsDO | 订单、创建、购买 |

域标签：订单、交易、购买
```

### 引用一致性

- 被引用的条目名称应与目标文件的一级标题一致
- 引用路径使用相对路径，不使用绝对路径
- 引用只出现在正文中，不出现在条目的结构化字段中（如"关联能力"字段只写名称，不写链接）

## 详情文件结构

每种知识类型的详情文件有统一的头部格式：

```markdown
# {条目名称}

> 类型：{知识类型}
> 生成时间：{时间戳}
> 来源文件：{生成该条目的主要代码文件列表}
> 标签：{tag1}, {tag2}, {tag3}

{该类型特有的正文内容，按 02-knowledge-type-spec.md 中定义的结构组织}
```

头部格式的统一约束：

- 一级标题必须是条目名称，与 `_index.md` 中的名称一致
- 生成时间用于后续增量更新时判断知识是否过期
- 来源文件列出主要代码证据的文件路径，便于快速定位

## 设计决策

### 为什么每种类型都拆分为目录

不区分项目规模，统一使用目录结构，原因：

- 生成程序和 Skill 不需要分支判断，逻辑简单
- 小项目目录中文件少，不影响使用
- 大项目不会因文件过大导致 Agent 加载成本高
- 增量更新时只重写单个文件，不影响其他文件

### 为什么 index.md 和 _index.md 分开

- `index.md` 是给 Agent 用的"地图"，Agent 只需要读一个文件就能了解全局
- `_index.md` 是给生成程序维护的"目录"，当某个类型下的条目增删时，只需要更新对应的 `_index.md`
- 两者职责不同，分开维护避免单文件过大

### 为什么用相对路径引用

- 知识库作为仓库的一部分被 git 管理，相对路径在仓库迁移、fork、clone 后仍然有效
- Agent 读取文件时可以直接拼接相对路径，不需要额外解析
- 不依赖外部索引服务或绝对路径
