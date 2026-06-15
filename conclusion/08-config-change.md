# 场景 8：配置变更 —— 启用短信校验功能

## 需求文档

> "启用短信校验功能。在用户注册和修改手机号时，需要通过短信验证码验证手机号。短信使用已有的腾讯云短信服务。"

## 我的工作过程

### 第一步：搜索现有短信实现

```
CodeGraph context("短信 SMS 验证码")
CodeGraph search "Sms" kind=class
```

→ 返回 SmsService、SmsConfig、SmsController、SmsSendRecord

### 第二步：理解现有实现

```
CodeGraph explore SmsService SmsConfig SmsController
```

一次返回三个类源码：
- SmsConfig：smsCheckSwitch 开关字段、腾讯云配置（appId、appSecret、templateId）
- SmsService.sendSms()：if (smsCheckSwitch) → 调腾讯云 SDK；else → 只记日志
- SmsController：sendVerifyCode()、verifyCode()、queryRecords()

**关键发现**：
1. 短信功能已完整实现（发送、校验、记录查询）
2. 有 smsCheckSwitch 开关控制
3. 使用腾讯云 SDK

### 第三步：确认开关当前状态

```
Grep "smsCheckSwitch" glob="*.yml"
```

→ mall.global.smsCheckSwitch: false → 当前禁用

### 第四步：确认需要集成的位置

需求说"注册"和"修改手机号"：

```
CodeGraph search "register" kind=method
CodeGraph search "updatePhone\|changePhone\|modifyPhone" kind=method
```

→ UserController.register()、UserController.updatePhone()

```
CodeGraph explore UserController
```

→ 看到 register() 和 updatePhone() 方法的源码
→ 两个方法中都没有短信校验的调用

### 第五步：确认配置有效性

```
AskUserQuestion:
  - 腾讯云的 appId/appSecret 配置是否仍然有效？
    短信功能之前是禁用的，需要确认第三方配置没有过期。
  - 注册和修改手机号时，验证码是必填还是可选？
```

### 第六步：实现

1. application.yml：smsCheckSwitch 改为 true
2. UserController.register()：在注册逻辑前调用 SmsService.verifyCode(phone, code)
3. UserController.updatePhone()：同上
4. 前端：注册页面和修改手机号页面增加"发送验证码"按钮和验证码输入框

### 第七步：检查启用后的副作用

smsCheckSwitch 改为 true 后，除了注册和修改手机号，还有没有其他地方会受影响？

```
Grep "smsCheckSwitch" glob="*.java"
```

→ 只有 SmsService.sendSms() 中引用了
→ 其他地方的短信发送都通过 SmsService 调用
→ 修改开关只影响 SmsService 的行为，不会影响其他地方

### 第八步：检查安全性

```
Grep "sendVerifyCode\|generateCode" path=SmsService
```

→ 验证码生成和发送逻辑
→ 有没有频率限制？同一个手机号能无限次请求发送吗？
→ 从 SmsService 源码中没有看到频率限制逻辑

→ 这是一个安全隐患，需要添加。但需求没提，需要和用户确认：

```
AskUserQuestion:
  - 短信发送目前没有频率限制。是否需要在本次需求中添加？
    比如：同一手机号 60 秒内只能发一次，每天最多 10 次。
```

## 知识库在这个场景中的作用

CodeGraph explore 一次调用就让我看到了全貌：功能完整、有开关、开关关闭、用的腾讯云。

**知识库可能的增量价值**：

- 如果 boundaries/sms-disabled.md 告诉我"腾讯云配置可能需要重新验证"——这个信息确实不容易从代码获取。我在第五步通过问用户解决了，但如果知识库提前告诉我，我可以少问一个问题
- 如果约束知识告诉我"短信发送没有频率限制"——我在第八步通过读代码发现了，但约束知识可以让我更早注意到

**但这些增量价值很小。** 整个过程中，CodeGraph explore 是主力工具，知识库只是让我少问一个问题或早一步注意到频率限制。

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| 短信功能是否存在 | CodeGraph explore | 无 |
| 用的什么 SDK | CodeGraph explore（SmsConfig） | 无 |
| 开关状态 | Grep yml | 无 |
| 功能是否完整 | CodeGraph explore（SmsController） | 无 |
| 注册/修改手机号位置 | CodeGraph search | 无 |
| 配置是否有效 | **问用户** | 低——边界知识可提供 |
| 频率限制有无 | Grep SmsService | 低——约束知识可提供 |
| 启用后的副作用 | Grep smsCheckSwitch | 无 |
