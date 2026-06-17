# 跨域业务流程提取规则

## 定义

跨域业务流程知识记录跨越多个能力域的端到端业务路径。

## 提取重点

1. **端到端路径**：从外部触发到业务目标完成的完整路径
2. **涉及域序列**：流程经过的能力域列表（有序）
3. **关键分支**：流程中的主要分支点或异常处理

## 过滤规则

- 只记录涉及 2 个以上域的流程
- 排除能从能力关系知识中直接推导的流程
- 排除单域内的流程（属于域级业务上下文）

## 生成约束

- 流程步骤中的能力域名称必须与能力目录一致
- 关键分支必须有代码证据，不推断未实现的分支
- 条目数量应少而精（典型项目 3~8 条）

## 产物示例

```json
{
  "workflow_name": "商品购买全流程",
  "summary_zh": "用户从浏览商品到完成支付的端到端购买路径，涉及商品浏览、购物车、订单管理和支付四个域",
  "business_goal": "用户从浏览商品到完成支付的购买路径",
  "aliases": ["PurchaseFlow", "购买流程", "OrderFlow"],
  "involved_domains": ["商品浏览", "购物车", "订单管理", "支付"],
  "steps": [
    {
      "order": 1,
      "domain": "商品浏览",
      "action": "浏览商品",
      "description": "查看商品列表和详情"
    },
    {
      "order": 2,
      "domain": "购物车",
      "action": "加入购物车",
      "description": "添加商品到购物车"
    },
    {
      "order": 3,
      "domain": "订单管理",
      "action": "提交订单",
      "description": "校验库存、创建订单"
    }
  ],
  "trigger_condition": "用户点击购买按钮",
  "completion_flag": "支付回调确认，订单状态变为已支付(201)",
  "key_branches": ["超时未支付自动取消"],
  "evidence": [
    "GoodsController",
    "CartController.checkout",
    "OrderController.submit"
  ],
  "tags": ["购买", "订单", "全流程"]
}
```
