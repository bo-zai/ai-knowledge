# 业务域知识提取规则

## 定义

CONCEPT 在本项目中表示**业务域主文档**，不是零散术语卡片。它回答的是：

- 这是哪个业务域
- 这个业务域解决什么问题
- 这个业务域里有哪些核心业务对象和术语
- 后续 capability 应该归属到哪个业务域

**核心定位**：生成业务域级知识，而不是翻译代码名称。Agent 自己能读代码，知识库的价值是提供代码无法直接告诉它的业务结构理解。

## 知识边界（不属于概念知识的）

以下内容不属于 CONCEPT 业务域知识，不要生成：

- **API 入口**：Controller 类、HTTP 端点 → 属于能力目录
- **单个用户动作**：创建、删除、提交、审核等具体动作 → 属于 capability
- **实体结构**：Entity/DO 的字段列表 → 属于数据模型
- **外部交互**：SDK 使用方式 → 属于外部系统交互

## 提取重点

1. **业务域本身**：购物车、优惠券、班级、课程、支付等可独立讨论的业务区域
2. **域内核心对象**：该业务域反复出现的业务对象、状态、标识、规则
3. **域边界**：该业务域负责什么，不负责什么
4. **域内术语**：支撑理解该业务域的关键术语、状态、类型

## 过滤规则

**必须排除**：

- 只解释单个枚举值、单个字段含义、单个状态码的碎片化知识
- 值少于 3 个且命名自解释的简单枚举（如 GenderEnum: MALE, FEMALE）
- Controller 类（以 Controller 结尾）
- Service 类（以 Service 结尾，除非其中包含业务规则方法）
- 纯技术配置类（只包含 host、port 等技术参数）
- DTO/VO/Request/Response 传输类（字段含义显而易见）

## 产物示例

```json
{
  "concept_name": "订单域",
  "domain_name": "订单域",
  "domain_key": "order",
  "summary_zh": "负责商品购买订单生命周期管理的业务域，覆盖下单、支付、取消、履约跟踪等订单相关能力。",
  "business_meaning_zh": "订单域负责把商品购买请求转成可跟踪的订单，并协调支付、库存、优惠、履约等环节。它关注的是订单从创建到完成的业务闭环，而不是某一个接口或某一个状态码。",
  "aliases": ["order", "Order", "订单管理", "订单域"],
  "capability_refs": [],
  "value_explanation": [
    { "value": "待支付", "business_meaning_zh": "订单已创建但尚未完成支付" },
    { "value": "已支付", "business_meaning_zh": "订单支付完成，进入履约环节" }
  ],
  "key_differentiation": "订单域 ≠ 支付域，订单域负责订单主体与生命周期，支付域负责资金扣款与支付结果确认。",
  "related_concepts": ["支付域", "优惠券域", "库存域"],
  "code_manifestation": [
    {
      "kind": "controller",
      "name": "OrderController",
      "location": "src/main/java/.../OrderController.java"
    },
    {
      "kind": "service",
      "name": "OrderService",
      "location": "src/main/java/.../OrderService.java"
    }
  ],
  "evidence": ["OrderController.java", "OrderService.java", "OrderDO.java"],
  "applicable_scope": "适用于订单主流程，不覆盖退款争议等售后子域",
  "tags": ["订单", "交易", "履约"]
}
```

## 字段填写要求

### concept_name / domain_name（业务域名称）

- 使用业务域术语，不使用代码类名
- 示例：`订单域`、`购物车域`

### domain_key（业务域主键）

- 必填。稳定英文 key，使用 kebab-case
- 示例：`order`、`cart`、`coupon`
- 后续 capability 会用它挂接到该业务域

### summary_zh（一句话定位）

- 必填。格式：`这个业务域负责什么业务闭环/问题空间`
- 反面示例：`订单相关概念定义`（没有说清业务域职责）

### business_meaning_zh（业务含义）

- 必填。说明该业务域负责什么、和哪些相邻域有边界
- 提供需要跨文件综合理解才能得出的信息
- 不要翻译代码名称，不要罗列 Agent 可以直接 grep 到的信息

### aliases（别名）

- 必填。必须包含：
  - **业务英文别名**：业务域的英文 key（如 `order`、`cart`），用于生成文件名
  - 代码中的英文命名
  - 业务术语中的其他叫法
- **重要**：业务英文别名必须是 kebab-case 格式，不能是代码类名
- 示例：`["order", "OrderController", "订单管理", "order-domain"]`

### capability_refs（域内能力）

- 必填。首次生成时通常为空数组：`[]`
- 该字段后续由打包器回填，不要虚构 capability 名称

### value_explanation（值说明）

- 适用枚举/状态类概念
- 5 个值以内：逐值解释业务含义
- 6~15 个值：列出所有值名，只解释非显而易见的值
- 15 个值以上：描述整体分类逻辑，不逐值展开

### key_differentiation（关键区分）

- 适用场景：存在容易混淆的近似概念
- 说明区别，帮助 Agent 避免误解

### related_concepts（关联业务域）

- 引用相邻业务域名称，不复制内容
- 格式：业务域名称列表

### code_manifestation（代码体现）

- 必填。说明该业务域在代码中的主要落点
- 格式：
  - `{ "kind": "enum", "name": "OrderStatusEnum", "location": "OrderDO.status" }`
  - `{ "kind": "field", "name": "coursewareType", "location": "CoursewareDO.coursewareType" }`

### evidence（证据）

- 必填。列出生成该知识的代码证据路径
- 格式：文件路径或文件路径#方法名/字段名
- 示例：`["OrderStatusEnum.java", "OrderDO.java#status"]`

### applicable_scope（适用范围）

- 必填。说明适用场景和不适用场景
- 示例：`仅适用于主订单流程，退款流程有独立状态机`

### tags（标签）

- 必填。1~3 个标签，用于分类和检索
- 使用业务术语，不使用代码类名

## 生成约束

1. **禁止把 CONCEPT 生成为术语碎片**：优先生成业务域，而不是单个状态码解释
2. **禁止翻译代码名称**：如果一条描述的内容，Agent 读代码 5 分钟内能自己得出相同结论，不要生成
3. **禁止推断业务背景**：只记录代码证据支撑的业务含义，不推断产品意图、未来规划
4. **禁止遗漏 aliases**：英文别名必须提供，用于生成文件名
5. **禁止遗漏 evidence**：证据字段帮助 Agent 定位代码
6. **禁止使用代码类名作为概念名称**：`concept_name` / `domain_name` 必须是业务术语
7. **禁止跨出当前 evidence group 边界**：如果 evidence 中提供的是分区级业务域，只能描述该分区的 entryPoints、dataContracts、docs 明确支持的内容；同一个 Controller、Service 或表中出现的其他方法/字段，除非在当前 evidence 中列出，否则不能写入 `business_meaning_zh`、`code_manifestation` 或 `evidence`
8. **禁止把邻近能力并入当前域**：例如当前 evidence 只包含 `sign/querySign`，即使同一文件中还有 `lottery/bind/propList`，也只能把当前域描述为签到相关业务域，不能扩展成抽奖、绑定或道具全量业务域
