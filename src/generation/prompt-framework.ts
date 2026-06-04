/**
 * Prompt Framework
 *
 * 设计文档 05 定义的四层提示词结构：
 * 1. base_system — 全局基础规则（JSON 格式、中文输出、禁止虚构）
 * 2. type_specific — 类型特定规则（提取规则、产物示例、生成约束）
 * 3. phase_context — 阶段上下文（前序产物引用）
 * 4. strategy_modifier — 策略修饰符（bootstrap/refine/validate）
 */

import type { AllObjectType, KnowledgeType } from '../knowledge/type-directory-map.js';

/**
 * Prompt configuration for building a complete prompt
 */
export interface PromptConfig {
  /** Target object type to generate */
  objectType: AllObjectType | KnowledgeType;

  /** Generation strategy */
  strategy: 'bootstrap' | 'refine' | 'validate';

  /** Generation phase (for ordering) */
  phase: 'concept' | 'data_model' | 'capability' | 'parallel';

  /** Dependencies from previous phases */
  dependencies?: {
    /** Already generated concept names */
    conceptNames?: string[];
    /** Already generated data model names */
    dataModelNames?: string[];
    /** Already generated capability domain names */
    capabilityNames?: string[];
    /** Already generated tag pool */
    tagPool?: string[];
  };

  /** Evidence bundle for the generation */
  evidence?: unknown;
}

/**
 * Complete prompt framework output
 */
export interface PromptFramework {
  /** System prompt (global + type-specific + phase + strategy) */
  system: string;

  /** User prompt (evidence + task) */
  user: string;
}

// ============================================================================
// Layer 1: Base System (全局基础规则)
// ============================================================================

/**
 * 全局基础规则
 *
 * 所有知识类型生成都必须遵守的规则。
 */
export const BASE_SYSTEM_PROMPT = `你是一个代码知识提取专家。你必须生成符合 Schema 的 JSON 输出。

## 核心规则

1. **输出格式**：只输出 JSON，不输出解释性文本。JSON 必须符合提供的 Schema。
2. **语言约束**：所有描述性字段必须使用简体中文，代码标识符（类名、方法名、字段名）保持英文。
3. **证据约束**：只能使用提供的 evidence 中的信息，禁止虚构不存在的能力、概念、约束或证据路径。
4. **引用约束**：引用其他知识条目时，必须使用已生成的名称（在 dependencies 中提供），禁止自创名称。

## 价值门槛

生成的知识必须提供 Agent 无法从代码中 3 分钟内得出的信息增量。
- 不翻译显而易见的代码名称
- 不罗列 Agent 可以直接 grep 搜索到的信息
- 优先提取需要跨文件综合理解才能得出的结论

## 输出结构

{
  "objects": [...],  // 生成的知识对象数组
  "warnings": [...]  // 警告信息（可选）
}`;

// ============================================================================
// Layer 2: Type Specific Rules (类型特定规则)
// ============================================================================

/**
 * 类型特定规则映射
 *
 * 每种知识类型有独特的提取规则、产物示例和生成约束。
 */
export const TYPE_SPECIFIC_RULES: Record<string, string> = {
  // 能力目录
  CAPABILITY: buildCapabilityRules(),

  // 概念知识
  CONCEPT: buildConceptRules(),

  // 边界知识
  BOUNDARY: buildBoundaryRules(),

  // 外部系统交互
  EXTERNAL: buildExternalRules(),

  // 约束知识
  CONSTRAINT: buildConstraintRules(),

  // 能力关系
  RELATION: buildRelationRules(),

  // 数据模型
  DATA_MODEL: buildDataModelRules(),

  // 跨域业务流程
  WORKFLOW: buildWorkflowRules(),

  // 兼容旧类型
  TERM: buildConceptRules(), // TERM 对应 CONCEPT
  DB: buildDataModelRules(), // DB 对应 DATA_MODEL
  FLOW: buildWorkflowRules(), // FLOW 对应 WORKFLOW
  OPEN: buildBoundaryRules(), // OPEN 对应 BOUNDARY
};

function buildCapabilityRules(): string {
  return `## 能力目录提取规则

### 定义
能力目录是仓库内可见业务能力域的概览，提供域级业务上下文和入口导航。

### 提取重点
1. **域级业务上下文**：提炼该域的核心业务规则和特殊机制，不是操作描述的简单拼接
2. **入口识别**：HTTP 端点注解、RPC 接口、消息处理函数、定时任务入口、事件监听器
3. **角色要求**：识别涉及特定角色访问限制的操作（如权限注解），在描述中提及角色名称

### 生成约束
- 域级业务上下文不超过 2~3 句话
- 操作描述应说明业务目的，不描述实现细节
- 工具类、配置类、基础设施类不列入能力目录

### 产物示例
{
  "domain_name": "订单管理",
  "domain_description_zh": "商品购买的订单全生命周期管理",
  "domain_business_context": "支持支付宝、微信和余额三种支付渠道，支付回调与定时任务存在竞态条件",
  "entry_class": "OrderController",
  "operations": [
    {
      "operation_name": "创建订单",
      "access_method": "POST /order/submit",
      "method_location": "OrderController.submit()",
      "operation_description_zh": "提交商品购买订单，完成商品校验、库存扣减和优惠券核销",
      "role_requirements": ["学生", "教师"],
      "tags": ["订单", "创建", "购买"]
    }
  ],
  "tags": ["订单", "交易", "购买"]
}`;
}

function buildConceptRules(): string {
  return `## 概念知识提取规则

### 定义
概念知识记录仓库中可见的业务概念的定义和业务含义。

### 提取重点
1. **枚举类**：值含义非显而易见的枚举
2. **核心业务实体**：有业务含义的字段或状态
3. **状态流转**：状态之间的合法转换路径

### 过滤规则
- 排除值少于 5 个且命名自解释的简单枚举（如 GenderEnum: MALE, FEMALE）
- 排除纯技术配置常量
- 排除 DTO/VO/Request/Response 传输类

### 生成约束
- 业务含义解释应说明"这个概念在什么场景下起作用、它影响什么"
- 值说明：5 个值以内逐值解释，6~15 个只解释非显而易见的，15 个以上描述分类逻辑
- 不推断代码中不可见的业务背景

### 产物示例
{
  "concept_name": "订单状态",
  "business_meaning_zh": "订单从创建到完成的流转状态标识，控制订单可执行的操作",
  "value_explanation": [
    { "value": "101", "business_meaning_zh": "待支付，用户可取消" },
    { "value": "201", "business_meaning_zh": "已支付，等待发货" }
  ],
  "code_manifestation": [
    { "kind": "enum", "name": "OrderStatusEnum", "location": "OrderDO.status" }
  ],
  "applicable_scope": "仅适用于主订单流程，退款流程有独立状态机",
  "tags": ["订单", "状态", "流转"]
}`;
}

function buildBoundaryRules(): string {
  return `## 边界知识提取规则

### 定义
边界知识记录已有能力的局限性和被禁用的功能。

### 提取重点
1. **局限性**：能力目录中某个能力的范围限制
2. **禁用功能**：代码中存在实现但配置关闭的功能

### 过滤规则
- 不从能力目录中简单取反生成缺失清单
- 禁用功能判断必须来自配置文件的显式值

### 生成约束
- 每条边界知识必须说明对 Agent 后续工作的影响
- 局限性描述必须基于已有代码的总结，不推断缺失功能

### 产物示例
{
  "boundary_title": "支付渠道局限",
  "boundary_type": "limitation",
  "detailed_description_zh": "当前只支持支付宝和微信支付两个渠道，不支持银联、信用卡",
  "related_capability": "订单管理",
  "evidence": ["AlipayConfig.java", "WxpayConfig.java"],
  "applicable_scope": "仅影响支付渠道选择",
  "tags": ["支付", "渠道"]
}`;
}

function buildExternalRules(): string {
  return `## 外部系统交互提取规则

### 定义
外部系统交互知识记录当前仓库与外部系统之间的可见交互。

### 提取重点
1. **SDK 使用**：扫描项目依赖和 import 语句
2. **配置文件**：外部 URL、API Key、AppId 等配置
3. **交互入口**：发起交互或接收回调的代码位置

### 过滤规则
- 基础设施依赖（数据库、缓存、消息队列）不作为外部系统记录
- 只记录从代码和配置中可见的交互，不推断外部系统内部行为

### 产物示例
{
  "external_system_name": "微信支付",
  "interaction_purpose_zh": "学生端和教师端的在线支付",
  "interaction_method": "sdk",
  "repository_role": "caller",
  "interaction_entry": "WxPayServiceImpl",
  "visible_interaction_scope": ["统一下单", "订单查询", "接收支付回调"],
  "applicable_scope": "仅中国大陆地区微信支付",
  "tags": ["支付", "微信", "第三方"]
}`;
}

function buildConstraintRules(): string {
  return `## 约束知识提取规则

### 定义
约束知识记录由代码、配置、测试明确体现的业务约束和技术约束。

### 提取重点
1. **异常抛出**：使用业务错误码的异常
2. **业务判断**：包含业务判断条件的校验
3. **事务边界**：事务注解声明的操作范围

### 过滤规则
- 排除通用参数校验：null check、空字符串、类型校验
- 排除框架层约束：ORM 注解、序列化配置
- 排除工程惯例：在任何同类型项目中都会出现的通用约束

### 生成约束
- 约束必须有代码证据支撑
- 描述应说明"什么条件下触发"和"触发后发生什么"
- 同一业务流程的多个约束合并为一条

### 产物示例
{
  "constraint_name": "学生绑定老师频率限制",
  "constraint_type": "business_rule",
  "constraint_description_zh": "同一个学生一年内只能绑定一次老师",
  "trigger_condition": "绑定时间在上次绑定一年内",
  "violation_consequence": "抛出 UserException: 同一个用户一年之内只能绑定一次",
  "evidence": ["UserService.java#bind"],
  "applicable_scope": "仅学生主动绑定老师，管理员后台调整不受限",
  "tags": ["师徒", "绑定", "频率"]
}`;
}

function buildRelationRules(): string {
  return `## 能力关系提取规则

### 定义
能力关系知识记录仓库内可见业务能力之间的组合、依赖、上下游或共享概念关系。

### 提取重点
1. **调用依赖**：能力 A 直接调用能力 B 的 Service 方法
2. **触发链**：能力 A 执行后同步触发能力 B
3. **异步触发**：能力 A 通过事件总线异步触发能力 B
4. **共享实体**：能力 A 和 B 操作同一个业务实体

### 过滤规则
- 只记录业务 Service 层之间的关系
- 排除 Service → Mapper/DAO 的调用
- 排除 Service → 工具类/基础设施的调用

### 生成约束
- 关系必须有代码证据支撑
- 同一业务流程的多条调用关系合并为一条
- 标注无法静态追踪的边（反射、动态代理、事件机制）

### 产物示例
{
  "relation_name": "课表制定触发评分更新",
  "relation_type": "async_trigger",
  "participating_capabilities": ["课表制定", "练习录音评分"],
  "relation_description_zh": "练习录音打分通过 EventBus 异步更新课表中的最高评分",
  "evidence": ["ScoreListener.handleScore", "BasicEventBus.post"],
  "applicable_scope": "仅教师为学生制定课表后的评分场景",
  "tags": ["课表", "评分", "事件驱动"]
}`;
}

function buildDataModelRules(): string {
  return `## 数据模型提取规则

### 定义
数据模型知识记录仓库内核心业务实体之间的关联关系和聚合边界。

### 提取重点
1. **外键字段**：命名包含 Id、FK、Ref 等后缀的字段
2. **关联字段**：List<OtherEntity>、@OneToMany 等注解
3. **聚合边界**：一对多关系中的"一"方作为聚合根

### 过滤规则
- 只记录核心业务实体（DO/Entity/Model）
- 排除 DTO/VO 等传输类
- 多模块项目需标注实体所属模块

### 生成约束
- 聚合边界判断必须有代码证据
- 实体关系描述应说明关联字段
- 记录跨聚合引用关系

### 产物示例
{
  "aggregate_name": "订单聚合",
  "aggregate_description_zh": "用户购买商品产生的交易记录",
  "core_entities": [
    { "name": "OrderDO", "role": "聚合根", "description": "订单主体" },
    { "name": "OrderGoodsDO", "role": "子实体", "description": "订单商品项" }
  ],
  "entity_relations": [
    { "from": "OrderDO", "to": "OrderGoodsDO", "type": "one_to_many", "field": "orderGoodsList" }
  ],
  "related_aggregates": ["商品聚合", "优惠券聚合", "用户聚合"],
  "evidence": ["OrderDO.java", "OrderGoodsDO.java"],
  "tags": ["订单", "交易", "聚合"]
}`;
}

function buildWorkflowRules(): string {
  return `## 跨域业务流程提取规则

### 定义
跨域业务流程知识记录跨越多个能力域的端到端业务路径。

### 提取重点
1. **端到端路径**：从外部触发到业务目标完成的完整路径
2. **涉及域序列**：流程经过的能力域列表（有序）
3. **关键分支**：流程中的主要分支点或异常处理

### 过滤规则
- 只记录涉及 2 个以上域的流程
- 排除能从能力关系知识中直接推导的流程
- 排除单域内的流程（属于域级业务上下文）

### 生成约束
- 流程步骤中的能力域名称必须与能力目录一致
- 关键分支必须有代码证据，不推断未实现的分支
- 条目数量应少而精（典型项目 3~8 条）

### 产物示例
{
  "workflow_name": "商品购买全流程",
  "business_goal": "用户从浏览商品到完成支付的购买路径",
  "involved_domains": ["商品浏览", "购物车", "订单管理", "支付"],
  "steps": [
    { "order": 1, "domain": "商品浏览", "action": "浏览商品", "description": "查看商品列表和详情" },
    { "order": 2, "domain": "购物车", "action": "加入购物车", "description": "添加商品到购物车" },
    { "order": 3, "domain": "订单管理", "action": "提交订单", "description": "校验库存、创建订单" }
  ],
  "trigger_condition": "用户点击购买按钮",
  "completion_flag": "支付回调确认，订单状态变为已支付(201)",
  "key_branches": ["超时未支付自动取消"],
  "evidence": ["GoodsController", "CartController.checkout", "OrderController.submit"],
  "tags": ["购买", "订单", "全流程"]
}`;
}

// ============================================================================
// Layer 3: Phase Context (阶段上下文)
// ============================================================================

/**
 * 构建阶段上下文
 *
 * 设计文档要求的生成阶段：
 * - 阶段 1: 概念 → 数据模型 → 能力目录（按序）
 * - 阶段 2: 其他类型并行生成
 */
export function buildPhaseContext(
  phase: 'concept' | 'data_model' | 'capability' | 'parallel',
  dependencies?: PromptConfig['dependencies']
): string {
  if (!dependencies || phase === 'concept') {
    return ''; // Concept phase has no dependencies
  }

  const lines: string[] = [];
  const conceptNames = dependencies.conceptNames;
  const dataModelNames = dependencies.dataModelNames;
  const capabilityNames = dependencies.capabilityNames;
  const tagPool = dependencies.tagPool;

  if (conceptNames && conceptNames.length > 0) {
    lines.push(`## 已生成的概念名称（必须使用这些名称作为引用）`);
    lines.push(conceptNames.map(n => `- ${n}`).join('\n'));
  }

  if (phase !== 'data_model' && dataModelNames && dataModelNames.length > 0) {
    lines.push(`## 已生成的数据模型名称`);
    lines.push(dataModelNames.map(n => `- ${n}`).join('\n'));
  }

  if (phase === 'parallel' && capabilityNames && capabilityNames.length > 0) {
    lines.push(`## 已生成的能力域名称（必须使用这些名称作为引用）`);
    lines.push(capabilityNames.map(n => `- ${n}`).join('\n'));
  }

  if (tagPool && tagPool.length > 0) {
    lines.push(`## 已有标签池（优先使用这些标签保持一致性）`);
    const displayTags = tagPool.slice(0, 20);
    lines.push(displayTags.map(t => `- ${t}`).join('\n'));
    if (tagPool.length > 20) {
      lines.push(`- ... (共 ${tagPool.length} 个标签)`);
    }
  }

  return lines.join('\n\n');
}

// ============================================================================
// Layer 4: Strategy Modifier (策略修饰符)
// ============================================================================

/**
 * 策略修饰符
 *
 * 不同生成策略的差异化规则。
 */
export const STRATEGY_MODIFIERS: Record<string, string> = {
  bootstrap: `## 生成策略：首次生成（bootstrap）

这是首次为该仓库生成知识。你需要从提供的 evidence 中提取完整的知识条目。
- 不要假设已有知识存在，一切从头提取
- 生成完整的、高质量的知识条目
- 置信度设为 "high" 或 "medium"（不设 "low"）`,

  refine: `## 生成策略：增量更新（refine）

这是增量更新已有知识。你需要基于变更的证据重新生成受影响的条目。
- 保持与已有知识的命名一致性
- 只更新变更影响的部分，不变更未受影响的部分
- 标记新增、修改、删除的条目`,

  validate: `## 生成策略：质量验证（validate）

这是对已有知识的质量验证。你需要检查知识的准确性和完整性。
- 检查证据引用是否仍然有效
- 检查描述是否与当前代码一致
- 输出验证结果和需要修正的建议`,
};

// ============================================================================
// Main API
// ============================================================================

/**
 * 构建完整的提示词框架
 */
export function buildPromptFramework(config: PromptConfig): PromptFramework {
  const { objectType, strategy, phase, dependencies } = config;

  // Layer 1: Base system
  const baseSystem = BASE_SYSTEM_PROMPT;

  // Layer 2: Type specific rules
  const typeSpecific = TYPE_SPECIFIC_RULES[objectType] ?? '';

  // Layer 3: Phase context
  const phaseContext = buildPhaseContext(phase, dependencies);

  // Layer 4: Strategy modifier
  const strategyModifier = STRATEGY_MODIFIERS[strategy] ?? '';

  // Combine all layers into system prompt
  const systemParts = [baseSystem, typeSpecific, phaseContext, strategyModifier]
    .filter(p => p.length > 0)
    .join('\n\n---\n\n');

  const system = systemParts;

  // Build user prompt with evidence
  const user = buildUserPrompt(config);

  return { system, user };
}

/**
 * 构建用户提示词
 */
function buildUserPrompt(config: PromptConfig): string {
  const { objectType, evidence } = config;

  const task = {
    object_type: objectType,
    generation_mode: config.strategy,
  };

  if (evidence) {
    return JSON.stringify({ task, evidence }, null, 2);
  }

  return JSON.stringify({ task }, null, 2);
}

/**
 * 获取类型特定规则（单独使用）
 */
export function getTypeSpecificRules(objectType: string): string {
  return TYPE_SPECIFIC_RULES[objectType] ?? '';
}