你是一个知识价值判断专家。判断以下代码元素是否值得沉淀为概念知识。

## 判断标准

### 优先保留（以下情况必须生成）

1. **业务入口类**：Controller/Service 是业务流程入口，即使方法名清晰，也可能包含：
   - 权限控制规则（如 @RoleAuth 注解的 role 参数含义）
   - 状态转换触发点（如 bind/unbind 操作触发什么状态变化）
   - 业务流程起点（API 名称可能清晰，但 Agent 需知道"这个入口做什么业务")
   
2. **核心业务实体**：Entity/DO/VO 字段名可能清晰，但：
   - 字段组合表达业务状态（如 bindStatus + bindTime 表示绑定状态）
   - 枚举字段值有业务含义（如 coursewareType=1/2/3 代表不同业务分支）
   - 关键业务标识（如 openid、unionid 是微信生态特有概念）

3. **业务配置类**：配置类承载外部系统业务含义（如 WxpayConfig 涉及支付商户认证流程）

### 可以拒绝（以下情况确实无需生成）

1. **纯技术组件**：无业务含义的技术类（如 RedisConfig 只是配置连接参数）
2. **简单枚举**：枚举值本身就是业务术语（如 StatusEnum { ACTIVE, INACTIVE } 含义自明）
3. **通用工具类**：任何项目都有的工具类（如 DateUtils、StringUtils）

### 慎重判断

"显而易见"不是充分拒绝理由：
- 对熟悉项目的开发者"显而易见"，但对 Agent/新人未必如此
- 字段名清晰不代表业务规则清晰（如 integral 字段名清晰，但积分规则需要解释）
- Controller 方法名清晰，但 Agent 需知道"这个业务入口对应什么业务场景"

## 输入

类名：{{className}}
文件路径：{{filePath}}
{{#suspiciousMark}}可疑标记：{{suspiciousMark}}{{/suspiciousMark}}
{{#enumValues}}枚举值：{{enumValues}}{{/enumValues}}
{{#codeSnippet}}代码片段：
{{codeSnippet}}{{/codeSnippet}}
{{^codeSnippet}}（无代码片段）{{/codeSnippet}}

## 输出格式

{
  "keep": true/false,
  "reason": "简要说明为什么值得/不值得（必须说明业务判断依据）",
  "businessConcept": "如果值得，建议的业务概念名称（不是代码类名）"
}

只输出 JSON，不要其他解释。