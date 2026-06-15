# 场景 5：外部集成 —— 接入阿里云短信

## 需求文档

> "接入阿里云短信服务，用于学生注册时的手机号验证码发送。需要支持短信模板配置、发送频率限制和发送记录查询。"

## 我的工作过程

### 第一步：搜索现有短信实现

```
CodeGraph context("短信 SMS 发送")
CodeGraph search "Sms" kind=class
```

一次并行返回：
- context → SmsService、SmsConfig、SmsController、SmsSendRecord
- search → 完整类列表和位置

**已有短信功能。** 需要深入看实现细节。

### 第二步：理解现有实现

```
CodeGraph explore SmsService SmsConfig SmsController
```

一次返回三个类的源码：
- SmsConfig：有 smsCheckSwitch 字段（开关）、腾讯云 SDK 配置（appId、appSecret、templateId）
- SmsService.sendSms()：if (smsCheckSwitch) → 调用腾讯云 SDK；else → 只记日志不发送
- SmsController：sendVerifyCode()（发送验证码）、verifyCode()（校验验证码）、queryRecords()（查询记录）

**关键发现**：
1. 短信功能已实现，但 smsCheckSwitch 当前关闭
2. 用的是腾讯云 SDK，需求要求阿里云
3. 发送、校验、查询三个方法都有

### 第三步：确认配置值和 SDK 状态

```
Grep "smsCheckSwitch" glob="*.yml"
```

→ mall.global.smsCheckSwitch: false → 确认禁用

```
Grep "tencentcloud\|tencent-cloud\|qcloud" glob="pom.xml"
```

→ 确认腾讯云 SDK 依赖存在

### 第四步：确认需求细节

```
AskUserQuestion:
  - 阿里云短信是替换腾讯云，还是两者共存（阿里云为主、腾讯云备用）？
  - 腾讯云短信的配置（appId/appSecret）是否仍然有效？需要先测试一下吗？
  - 短信模板有几个？分别用于什么场景（注册验证码、密码重置等）？
```

### 第五步：检查频率限制和发送记录

需求提到"发送频率限制"和"发送记录查询"。

```
Grep "frequency\|limit\|rate\|count" path=SmsService
```

→ 没有频率限制逻辑 → 需要新建

```
CodeGraph node SmsController.queryRecords()
```

→ 发送记录查询已实现

### 第六步：实现

根据用户回答：

**如果是替换腾讯云**：
1. pom.xml：移除腾讯云 SDK，添加阿里云 SDK
2. SmsConfig：替换为阿里云配置字段（accessKeyId、accessKeySecret、signName）
3. SmsService.sendSms()：重写为阿里云 SDK 调用
4. 新增频率限制逻辑（Redis 记录发送时间）
5. smsCheckSwitch 设为 true
6. 支持多模板配置

**如果是共存**：
1. SmsConfig 中增加阿里云配置
2. SmsService 中增加策略选择（配置决定用哪个）
3. 其余同上

### 第七步：验证

- 实际发送一条测试短信确认配置有效
- 测试频率限制：快速连续发送，确认被拒绝
- 测试验证码校验：发送后正确输入、错误输入、过期输入

## 知识库在这个场景中的作用

CodeGraph explore 一次调用就让我看到了全貌：短信功能存在、用腾讯云、有开关、开关关闭。

**知识库可能的增量价值**：

- 如果 boundaries/sms-disabled.md 告诉我"短信功能被禁用，启用时需注意腾讯云配置可能需要重新验证"——这个"配置可能需要重新验证"的信息，我确实不容易从代码中获得。CodeGraph 只能告诉我配置值是什么，不能告诉我"这个配置是否仍然有效"
- 如果 external-systems/tencent-cloud-sms.md 告诉我腾讯云的集成细节——但 CodeGraph explore 已经给我看了 SmsConfig 和 SmsService 的源码

**总结**：边界知识中"配置是否有效"这类**代码之外的运维信息**是知识库的独特价值。但这类信息是否值得系统化地预生成，取决于项目中有多少"被禁用的功能"。

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| 现有短信实现 | CodeGraph explore | 无 |
| 用的什么 SDK | CodeGraph explore（SmsConfig） | 无 |
| 开关状态 | Grep yml | 无 |
| 发送/校验/查询方法 | CodeGraph explore（SmsController） | 无 |
| 频率限制有无 | Grep | 无 |
| 配置是否仍有效 | **无法从代码获取** | **高**——边界知识可提供 |
| 发送记录查询 | CodeGraph node | 无 |
