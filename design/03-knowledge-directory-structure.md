# 知识库目录结构

本文定义 `ai-knowledge/` 知识库的文件组织方式、命名规则、索引结构和文件间引用机制。

## 总体结构

知识库采用统一的目录结构，所有项目使用相同的组织方式，不按项目规模做自适应。

```
ai-knowledge/
├── index.md                        # 总索引
├── architecture.md                 # 架构概览知识（包级元知识）
├── project-context.json            # 项目类型上下文（供 Agent 和生成程序读取）
├── .meta                           # 生成元信息（commit hash、时间戳、版本号）
│
├── reports/                        # 生成报告目录
│   └── generation.json             # 最后一次生成的详细报告
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

共 8 个知识类型目录，加上根目录的 `index.md`、`architecture.md`、`project-context.json`、`.meta` 和 `reports/` 目录。每个知识类型目录包含一个 `_index.md`，`concepts/` 额外有一个 `_glossary.md`。

## 文件命名规则

### 文件名

- 使用 `kebab-case`（如 `order-status.md`、`student-bind-limit.md`）
- 文件名应能反映条目内容，便于 Agent 从文件名判断是否需要读取
- 不使用数字前缀、不使用空格、不使用非 ASCII 字符
- 同一目录内文件名不重复

### 特殊文件

- `index.md`：全局总索引，位于 `ai-knowledge/` 根目录
- `architecture.md`：架构概览知识，位于 `ai-knowledge/` 根目录，描述项目整体结构
- `project-context.json`：项目类型上下文，位于 `ai-knowledge/` 根目录，存储项目类型、技术栈等元信息
- `.meta`：生成元信息，位于 `ai-knowledge/` 根目录，存储上次生成的 commit hash、时间戳、版本号和项目类型识别时间，供增量更新作为基线
- `reports/generation.json`：生成报告，位于 `reports/` 目录，记录最后一次生成的详细统计和失败信息
- `_index.md`：各知识类型目录的内部索引，以 `_` 前缀区分
- `_glossary.md`：概念知识的术语速查表，仅位于 `concepts/` 目录

`.meta` 文件结构：

```json
{
  "lastCommitHash": "abc123def456",
  "lastGeneratedAt": "2026-06-05T14:30:00Z",
  "version": "1.0.0",
  "projectTypeIdentifiedAt": "2026-06-05T14:25:00Z"
}
```

`.meta` 文件的作用：
- 增量更新时，通过 `lastCommitHash` 与当前分支 HEAD 对比，计算变更范围
- `projectTypeIdentifiedAt` 记录项目类型识别时间，增量更新时判断是否需要重新识别（目录结构变更时重新识别）

## 索引体系

知识库有两层索引：全局索引（`index.md`）和类型索引（`_index.md`）。架构概览（`architecture.md`）作为包级元知识，在 index.md 顶部优先展示。

### index.md：全局总索引

Agent 读取知识库时第一个打开的文件。它首先展示架构概览链接，然后列出所有 8 类知识的概要，使 Agent 能判断哪些知识与当前需求相关，按需读取详情文件。

index.md 的结构：

```markdown
# {项目名称} - 知识库索引

## 架构概览

[查看项目架构概览](architecture.md) — 了解项目整体结构、技术栈和入口导航

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

### architecture.md：架构概览

架构概览是包级元知识，帮助 Agent 快速建立对项目的全局认知，并指导编码时的代码组织。它描述项目类型、技术栈、目录组织方式、编码约定和忽略目录，使 Agent 在进入具体业务知识之前先理解项目的整体形态。

architecture.md 的结构（后端服务示例）：

```markdown
# 音乐教育应用架构概览

> 类型：ARCHITECTURE
> 生成时间：2026-06-05T14:30:00Z

## 一句话定位

Spring Boot 后端服务，提供课程管理、用户管理、学习记录等功能

## 项目类型

backend-service

## 技术栈

Spring Boot 2.7、MyBatis、MySQL

## 目录结构

| 目录 | 用途 | 编码时 |
|------|------|--------|
| src/main/java/ | Java 源代码 | 新功能创建 `com.musicedu.<domain>` 包 |
| src/main/resources/ | 配置文件 | application.yml 配置数据库、Redis 等 |
| src/test/java/ | 测试代码 | 单元测试、集成测试 |

## 忽略目录

以下目录不包含业务逻辑，浏览代码时跳过：

- `target/` — Maven 构建产物
- `ai-knowledge/` — 知识库生成产物
- `.codegraph/` — 代码索引文件

## 编码约定

采用分层架构，按业务领域分包：

- 每个领域独立包：`com.musicedu.<domain>`
- Controller 放 `<domain>.controller` 子包
- Service 放 `<domain>.service` 子包
- 实体类放 `<domain>.entity` 子包

## 业务领域导航

参见 [能力目录](capabilities/_index.md)：

- 课程管理：课程 CRUD、课程发布
- 用户管理：用户认证、权限管理
- 学习记录：学习进度、打卡记录

## 调试入口

- 启动类：`MusicEducationApplication.java`
- 主要 API 入口参见各能力的 Controller（能力目录中列出）

## 证据

pom.xml、application.yml、src/main/java/ 目录结构
```

architecture.md 的生成约束：

- **一句话定位**必须包含项目类型、技术栈和主要用途
- **目录结构**采用表格形式，必须包含"编码时"列，指导 Agent 新代码放哪
- **忽略目录**必须列出构建产物（target/、dist/）、生成产物（ai-knowledge/、.codegraph/）、依赖目录（node_modules/）
- **编码约定**聚焦通用约定（分层结构、分包约定），不包含业务特定约定（业务约定属于约束知识）
- **业务领域导航**链接到能力目录，不在此列出具体业务模块的包路径和类名
- 不使用过于泛化的描述（如"Java 源代码目录，包含业务代码"）

### architecture.md 与能力目录的分工

| 架构概览 | 能力目录 |
|---------|---------|
| 提供全局技术视图：技术栈、顶层目录用途 | 提供业务领域导航：具体业务模块、包路径 |
| 描述通用编码约定：分层结构、分包约定 | 描述具体业务入口：核心类名、方法位置 |
| 列出忽略目录：哪些目录不包含业务代码 | 列出业务操作：每个领域的具体功能 |
| 链接到能力目录获取详细信息 | 包含业务模块的完整描述 |

Agent 使用场景：

1. Agent 接到"修改课程管理模块"任务 → 先读架构概览了解项目类型和分层约定 → 再读能力目录定位课程管理的具体代码
2. Agent 接到"添加新功能"任务 → 读架构概览的"编码约定"知道新代码放哪 → 读能力目录了解现有业务领域命名参考

### project-context.json：项目类型上下文

项目类型上下文是供 Agent 和生成程序读取的结构化元信息，包含项目类型、技术栈、主语言等。

project-context.json 的结构：

```json
{
  "projectType": "backend-service",
  "techStack": ["Spring Boot 2.7", "MyBatis", "RocketMQ"],
  "primaryLanguage": "java",
  "framework": "spring-boot",
  "confidence": 0.95,
  "identifiedAt": "2026-06-05T14:30:00Z",
  "identificationEvidence": [
    "pom.xml 显示 Spring Boot 依赖",
    "目录结构包含 controller/service/repository 分层",
    "README 描述为订单管理系统"
  ],
  "packages": null
}
```

对于复合类型（monorepo、fullstack），`packages` 字段记录各子包的类型信息：

```json
{
  "projectType": "monorepo",
  "packages": [
    {"name": "web", "path": "packages/web", "type": "frontend-app"},
    {"name": "server", "path": "packages/server", "type": "backend-service"}
  ]
}
```

project-context.json 的使用场景：

- Agent 读取架构概览前，可先读取此文件快速了解项目类型
- 生成程序在后续知识生成阶段读取此文件，调整生成策略
- 增量更新时复用已识别的项目类型，避免重复识别

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

### 为什么架构概览放在根目录而非独立目录

架构概览是**包级元知识**，描述项目整体而非某个业务领域。它与其他 8 类业务知识性质不同：

- 业务知识（概念、能力、约束等）描述"代码承载了什么业务含义"
- 架构概览描述"代码是怎么组织的"

放在根目录的好处：
- Agent 进入知识包时，首先看到架构概览链接，建立全局认知后再深入业务知识
- 与 index.md 平级，定位为"入口级"文档
- 单文件，不像其他类型有多个对象需要目录组织

### 为什么需要 project-context.json

项目类型识别结果需要持久化存储，供后续阶段和 Agent 复用：

- 避免重复识别：项目类型识别调用 LLM，成本应控制
- 后续生成策略适配：能力目录、概念知识等生成策略依赖项目类型
- Agent 快速获取项目元信息：读取此文件比解析 architecture.md 更高效
- 增量更新复用：增量生成时无需重新识别项目类型
