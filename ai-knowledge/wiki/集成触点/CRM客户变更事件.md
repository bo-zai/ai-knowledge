---
title: CRM客户变更事件
kind: integration-touchpoint
direction: inbound
target_module: customer-sync
---

# CRM客户变更事件

## 触点定义

CRM系统在客户主档或客户等级发生变化后，向客户中心服务推送客户变更事件。

## 关键字段

| 字段 | 来源 | 用途 |
|---|---|---|
| customerId | CRM系统 | 本地客户定位 |
| customerName | CRM系统 | 客户基础信息更新 |
| customerLevel | CRM系统 | 客户等级更新 |
| customerSegment | CRM系统 | 客户分群更新 |

## 本地入口

1. `crm-adapter` 负责接收和反序列化事件。
2. `customer-sync` 负责幂等、映射和落库。

## 兼容要求

1. CRM 新增字段时，本地可忽略未知字段，但不应错误覆盖已有字段。
2. 已有字段语义变化时，需先确认 CRM 发布说明，再改本地映射。
