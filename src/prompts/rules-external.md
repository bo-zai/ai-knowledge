# 外部系统交互提取规则

## 定义
外部系统交互知识记录当前仓库与外部系统之间的可见交互。

## 提取重点
1. **SDK 使用**：扫描项目依赖和 import 语句
2. **配置文件**：外部 URL、API Key、AppId 等配置
3. **交互入口**：发起交互或接收回调的代码位置

## 过滤规则
- 基础设施依赖（数据库、缓存、消息队列）不作为外部系统记录
- 只记录从代码和配置中可见的交互，不推断外部系统内部行为

## 产物示例
```json
{
  "external_system_name": "微信支付",
  "summary_zh": "学生端和教师端的在线支付外部系统，通过 SDK 实现统一下单和回调处理",
  "interaction_purpose_zh": "学生端和教师端的在线支付",
  "interaction_method": "sdk",
  "repository_role": "caller",
  "interaction_entry": "WxPayServiceImpl",
  "aliases": ["WechatPay", "wxpay", "微信支付SDK"],
  "visible_interaction_scope": ["统一下单", "订单查询", "接收支付回调"],
  "evidence": ["WxPayServiceImpl.java", "WxpayConfig.java", "application.yml#wechat.pay"],
  "applicable_scope": "仅中国大陆地区微信支付",
  "tags": ["支付", "微信", "第三方"]
}
```