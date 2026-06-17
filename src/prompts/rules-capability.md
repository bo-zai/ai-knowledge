# 能力目录提取规则

## 定义

能力目录是仓库内可见业务能力域的概览，提供域级业务上下文和入口导航。

## 提取重点

1. **域级业务上下文**：提炼该域的核心业务规则和特殊机制，不是操作描述的简单拼接
2. **入口识别**：HTTP 端点注解、RPC 接口、消息处理函数、定时任务入口、事件监听器
3. **角色要求**：识别涉及特定角色访问限制的操作（如权限注解），在描述中提及角色名称

## 生成约束

- 域级业务上下文不超过 2~3 句话
- 操作描述应说明业务目的，不描述实现细节
- 工具类、配置类、基础设施类不列入能力目录

## 产物示例

```json
{
  "domain_name": "订单管理",
  "summary_zh": "商品购买的订单全生命周期管理域，支持创建、支付、取消、查询等订单操作",
  "domain_description_zh": "商品购买的订单全生命周期管理",
  "domain_business_context": "支持支付宝、微信和余额三种支付渠道，支付回调与定时任务存在竞态条件",
  "entry_class": "OrderController",
  "aliases": ["Order", "订单域", "OrderModule"],
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
  "evidence": ["OrderController.java", "OrderService.java", "OrderDO.java"],
  "tags": ["订单", "交易", "购买"]
}
```
