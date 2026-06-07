# 概念知识提取规则

## 定义

概念知识记录仓库中可见的业务概念的定义和业务含义。它回答"这个术语/状态/枚举/字段在业务上是什么意思"。

**核心定位**：概念知识提供信息增量，而不是翻译代码名称。Agent 自己能读代码，知识库的价值是提供代码无法直接告诉它的业务理解。

## 知识边界（不属于概念知识的）

以下内容不属于概念知识，不要生成：
- **API 入口**：Controller 类、HTTP 端点 → 属于能力目录
- **业务逻辑入口**：Service 类 → 属于能力目录的域级上下文
- **实体结构**：Entity/DO 的字段列表 → 属于数据模型
- **外部交互**：SDK 使用方式 → 属于外部系统交互

## 提取重点

1. **业务状态枚举**：值含义非显而易见的枚举（如状态码 101/201）
2. **业务类型标识**：决定不同处理路径的类型字段（如 coursewareType=3 走特殊分支）
3. **业务标识概念**：跨层复用的业务术语（如 openid、memberLevel）
4. **状态组合规则**：多个字段组合表达的业务状态

## 过滤规则

**必须排除**：
- 值少于 3 个且命名自解释的简单枚举（如 GenderEnum: MALE, FEMALE）
- Controller 类（以 Controller 结尾）
- Service 类（以 Service 结尾，除非其中包含业务规则方法）
- 纯技术配置类（只包含 host、port 等技术参数）
- DTO/VO/Request/Response 传输类（字段含义显而易见）

## 产物示例

```json
{
  "concept_name": "订单状态",
  "summary_zh": "订单从创建到完成的流转状态标识，控制订单可执行的操作（取消、发货、确认等）",
  "business_meaning_zh": "订单状态由状态码驱动，不同状态控制可执行的操作集合：\n- 101（待支付）：用户可取消订单，系统等待支付\n- 201（已支付）：等待商家发货，用户不可取消\n- 301（已发货）：等待用户确认收货\n- 402（已完成）：订单结束，可再次购买\n注意：超时未支付的订单会被定时任务自动取消（状态变为 401）",
  "aliases": ["OrderStatus", "订单状态码", "orderStatus", "OrderStatusEnum"],
  "value_explanation": [
    { "value": "101", "business_meaning_zh": "待支付，用户可取消，超时自动取消" },
    { "value": "201", "business_meaning_zh": "已支付，等待发货，不可取消" },
    { "value": "301", "business_meaning_zh": "已发货，等待用户确认收货" },
    { "value": "402", "business_meaning_zh": "已完成，订单结束" },
    { "value": "401", "business_meaning_zh": "已取消，库存和优惠券已回滚" }
  ],
  "key_differentiation": "订单状态 ≠ 支付状态，订单状态控制订单操作，支付状态反映支付结果。支付成功后订单状态变为 201",
  "related_concepts": ["支付渠道", "退款状态"],
  "code_manifestation": [
    { "kind": "enum", "name": "OrderStatusEnum", "location": "OrderDO.status" }
  ],
  "evidence": ["OrderStatusEnum.java", "OrderDO.java#status", "OrderService.java#submit"],
  "applicable_scope": "仅适用于主订单流程，退款流程有独立状态机",
  "tags": ["订单", "状态", "流转"]
}
```

```json
{
  "concept_name": "课件类型",
  "summary_zh": "课表中每个练习任务的分类标识，决定了数据来源和属性结构的不同处理路径",
  "business_meaning_zh": "课表中的课件分为两种类型，它们走不同的数据来源和属性结构：\n- type=3（PRACTICE_MUSIC）：曲目课件，数据来自 TeachCategoryCourse，包含节拍（beat）、和弦（chord）属性\n- 其他类型：教学内容课件，数据来自 TeachCategoryContentCourse，额外包含节奏（rhythm）、列表类型（listType）属性\n两种课件在课表展示、学习统计和打分流程中走不同的处理路径。",
  "aliases": ["课件分类", "CoursewareType", "coursewareType", "CoursewareTypeEnum"],
  "value_explanation": [
    { "value": "3", "business_meaning_zh": "曲目课件（PRACTICE_MUSIC），来自曲库，包含节拍和弦" },
    { "value": "其他", "business_meaning_zh": "教学内容课件，来自教学内容库，包含节奏和列表类型" }
  ],
  "key_differentiation": "课件类型 ≠ 教学分类，教学分类是课程所属的分类目录，课件类型是具体练习任务的数据来源类型",
  "related_concepts": ["教学分类", "课表"],
  "code_manifestation": [
    { "kind": "field", "name": "coursewareType", "location": "CoursewareDO.coursewareType" },
    { "kind": "enum", "name": "CoursewareTypeEnum", "location": "CoursewareTypeEnum.java" }
  ],
  "evidence": ["CoursewareDO.java#coursewareType", "CoursewareTypeEnum.java", "CourseService.java#processCourseware"],
  "applicable_scope": "仅适用于课表中的课件任务，不适用于学生自主练习场景",
  "tags": ["课件", "教学", "课表"]
}
```

## 字段填写要求

### concept_name（概念名称）
- 使用业务术语，不使用代码类名
- 示例：`订单状态`（正确）vs `OrderStatusEnum`（错误）

### summary_zh（一句话定位）
- 必填。格式：`概念在什么业务场景下的什么作用`
- 示例：`订单从创建到完成的流转状态标识，控制订单可执行的操作（取消、发货、确认等）`
- 反面示例：`订单状态枚举，定义了订单的状态值`（只翻译了代码名称，无信息增量）

### business_meaning_zh（业务含义）
- 必填。说明"这个概念在什么场景下起作用、它影响什么"
- 提供需要跨文件综合理解才能得出的信息
- 不要翻译代码名称，不要罗列 Agent 可以直接 grep 到的信息

### aliases（别名）
- 必填。必须包含：
  - **业务英文别名**：业务术语的英文翻译（如 `order-status`、`courseware-type`），用于生成文件名
  - 代码中的英文命名（如 OrderStatusEnum、coursewareType）
  - 业务术语中的其他叫法（如"订单状态码"、"课件分类")
- **重要**：业务英文别名必须是 kebab-case 格式，不能是代码类名
- 示例：`["order-status", "OrderStatusEnum", "订单状态码", "orderStatus"]`

### value_explanation（值说明）
- 适用枚举/状态类概念
- 5 个值以内：逐值解释业务含义
- 6~15 个值：列出所有值名，只解释非显而易见的值
- 15 个值以上：描述整体分类逻辑，不逐值展开

### key_differentiation（关键区分）
- 适用场景：存在容易混淆的近似概念
- 说明区别，帮助 Agent 避免误解

### related_concepts（关联概念）
- 引用相关概念名称，不复制内容
- 格式：概念名称列表

### code_manifestation（代码体现）
- 必填。说明该概念在代码中的具体表现
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

1. **禁止翻译代码名称**：如果一条描述的内容，Agent 读代码 5 分钟内能自己得出相同结论，不要生成
2. **禁止推断业务背景**：只记录代码证据支撑的业务含义，不推断产品意图、未来规划
3. **禁止遗漏 aliases**：英文别名必须提供，用于生成文件名
4. **禁止遗漏 evidence**：证据字段帮助 Agent 定位代码
5. **禁止使用代码类名作为概念名称**：`concept_name` 必须是业务术语