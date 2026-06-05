# 概念知识提取规则

## 定义
概念知识记录仓库中可见的业务概念的定义和业务含义。

## 提取重点
1. **枚举类**：值含义非显而易见的枚举
2. **核心业务实体**：有业务含义的字段或状态
3. **状态流转**：状态之间的合法转换路径

## 过滤规则
- 排除值少于 5 个且命名自解释的简单枚举（如 GenderEnum: MALE, FEMALE）
- 排除纯技术配置常量
- 排除 DTO/VO/Request/Response 传输类

## 生成约束
- 业务含义解释应说明"这个概念在什么场景下起作用、它影响什么"
- 值说明：5 个值以内逐值解释，6~15 个只解释非显而易见的，15 个以上描述分类逻辑
- 不推断代码中不可见的业务背景
- 别名字段列出代码中的英文命名和业务术语中的其他叫法

## 产物示例
```json
{
  "concept_name": "订单状态",
  "summary_zh": "订单从创建到完成的流转状态标识，控制订单可执行的操作（取消、发货、确认等）",
  "business_meaning_zh": "订单从创建到完成的流转状态标识，控制订单可执行的操作",
  "aliases": ["OrderStatus", "订单状态码", "orderStatus", "OrderStatusEnum"],
  "value_explanation": [
    { "value": "101", "business_meaning_zh": "待支付，用户可取消" },
    { "value": "201", "business_meaning_zh": "已支付，等待发货" }
  ],
  "key_differentiation": "订单状态 ≠ 支付状态，订单状态控制订单操作，支付状态反映支付结果",
  "related_concepts": ["支付渠道", "退款状态"],
  "code_manifestation": [
    { "kind": "enum", "name": "OrderStatusEnum", "location": "OrderDO.status" }
  ],
  "evidence": ["OrderStatusEnum.java", "OrderDO.java#status", "OrderService.java#submit"],
  "applicable_scope": "仅适用于主订单流程，退款流程有独立状态机",
  "tags": ["订单", "状态", "流转"]
}
```