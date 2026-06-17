# 回检报告：场景模拟的真实性审查

本文对 8 个场景模拟进行逐条审查，区分"我真的会做的操作"和"为了让对比好看而编造的操作"。

## 系统性问题（影响全部场景）

### 问题 1：知识库路径是理想化的，不是真实行为

**我在所有场景中描述的知识库使用方式：**

```
读 _glossary.md → 读 concepts/xxx.md → 读 index.md → 读 capabilities/xxx.md
```

**我真的会这样做吗？不会。**

真实情况是：即使有知识库，我的第一反应仍然是**搜索代码**，而不是先去翻知识库。我只有在以下情况才会去看知识库：

- 搜索代码后发现术语对不上（搜"打分"搜不到）
- 读代码后发现理解不了业务含义
- 需要确认"有没有我遗漏的东西"

也就是说，知识库对我来说是**补充工具**，不是**起点**。我在场景中描述的"先读 5 个知识文件再开始工作"的路径，是为了让对比效果好看而设计的理想路径。

**修正**：真实的知识库使用应该是碎片化的——在探索过程中遇到障碍时才去查对应文件，而不是开场就批量阅读。

### 问题 2：时间估算不可靠

我写的"无 KB 12 分钟 vs 有 KB 4 分钟"这类对比数字是**编造的**。

真实情况：

- 我无法精确估算每个步骤的耗时
- CodeGraph 的一次 search + explore 可能只需要 10 秒，不是"3 分钟"
- 读一个方法的源码可能需要 30 秒~2 分钟，取决于方法长度
- "总耗时"取决于我的上下文窗口还剩多少、之前的对话已经加载了什么

**修正**：放弃精确时间对比，改用"操作步骤数"和"走弯路风险"来衡量。

### 问题 3：低估了 CodeGraph 的综合能力

我在多个场景中把 CodeGraph 当成"只能查单个符号"的工具，然后说"Agent 需要 N 步才能拼出全貌"。但 CodeGraph 的 `context` 和 `explore` 工具实际上能一次返回大量关联信息：

- `codegraph_context("打分功能")` 一次返回：入口、相关符号、关键代码
- `codegraph_explore("ScoreService CoursewareType PracticeRecord")` 一次返回多个符号的源码

**修正**：很多场景中的"多步操作"其实可以用 1~2 次 CodeGraph context/explore 调用完成。这进一步降低了知识库的相对价值。

### 问题 4：忽略了"问用户"这个选项

在多个场景中，遇到不理解的业务含义时，我描述的是"继续搜索代码"。但真实情况下，我的一个核心选项是**直接问用户**：

- "请问'打分'在系统中对应哪个功能？"
- "课件类型有两种，它们都需要支持批量打分吗？"
- "优惠券是替换腾讯云还是两者共存？"

问用户通常比搜索代码更高效，特别是对于业务术语映射这种"代码里找不到答案"的问题。

**修正**：很多场景中，"问用户"应该是第一步操作，而不是搜索 10 步后才想到要问。

### 问题 5：搜索中文术语是不真实的

在场景 02 中我写了：

```
Step 2: CodeGraph search "师徒"
  → 0 结果（代码是英文的）
```

这是一个**错误操作**。我知道代码是英文的，不会去搜中文。真实行为是：

```
CodeGraph search "teacher student" 或 "bind" 或 "relation"
```

类似地，场景 06 中搜"学习进度"也是不真实的。我会搜 "progress" 或 "learning" 或 "study"。

---

## 逐场景审查

### 场景 01：单域新功能（批量打分）

| 描述的操作                        | 真实性 | 问题                                                                                                   |
| --------------------------------- | :----: | ------------------------------------------------------------------------------------------------------ |
| CodeGraph search "Score"          |   ✅   | 真的会这样做                                                                                           |
| CodeGraph node ScoreController    |   ✅   | 真的会看入口                                                                                           |
| CodeGraph search "CoursewareType" |   ⚠️   | 我不一定知道要搜这个。真实路径是：先理解打分流程，从打分代码中发现 coursewareType 的引用，然后才去搜它 |
| grep "coursewareType" in Service  |   ⚠️   | 我会用 CodeGraph callers 而不是 grep                                                                   |
| "知识库路径 4 分钟完成"           |   ❌   | 理想化。我不会开场就批量读知识文件                                                                     |
| 积分发放是异步的（ScoreEvent）    |   ✅   | 这个发现确实需要追踪事件机制，CodeGraph callers 对 @EventListener 可能追踪不到                         |

**真实的行为应该是：**

```
消息 1（并行搜索）：
  CodeGraph search "Score"
  CodeGraph search "积分"  → 不对，我会搜 "integral" 或 "point"
  CodeGraph context("打分功能")  ← 这个最有用，一次返回相关符号

消息 2（基于结果深入）：
  CodeGraph explore ScoreService ScoreController
  → 看到打分方法列表和源码
  → 从中发现引用了 PracticeRecord、LearningRecord、ScoreEvent
  → 发现积分是异步触发的

消息 3（如果遇到术语困惑）：
  → 如果我不确定"课件类型"在代码中叫什么
  → 这时我可能去看 _glossary.md（如果知道它存在的话）
  → 或者直接问用户
```

**对结论的影响**：

- 概念知识的价值**略有降低**——CodeGraph context 一次调用就能帮我建立初始理解
- "问用户"在术语映射中比我描述的更常用
- 跨域流程知识的价值**不变**——异步触发确实是 CodeGraph 的盲区

---

### 场景 02：跨域 Bug 修复（师徒绑定后看不到学生）

| 描述的操作                             | 真实性 | 问题                                                                         |
| -------------------------------------- | :----: | ---------------------------------------------------------------------------- |
| CodeGraph search "bind"                |   ⚠️   | "bind" 太泛了。我会搜 "teacher student bind" 或 "teacher bind" 或 "relation" |
| CodeGraph search "师徒"                |   ❌   | **错误操作**。我不会搜中文，代码是英文的                                     |
| grep "teacher.\*student"               |   ⚠️   | 我会用 CodeGraph，不会用正则 grep 做第一步搜索                               |
| 读 UserService.bind() 发现是"绑定手机" |   ⚠️   | 有可能，但 CodeGraph node 会显示方法签名，我看到参数是 phone 就不会深入读了  |
| 读 Mapper XML 发现 status='ACTIVE'     |   ✅   | 这步是真的。追踪查询条件需要读 SQL                                           |
| "知识库 3 步 4 分钟"                   |   ❌   | 理想化。概念知识直接告诉我"PENDING 状态"太完美了                             |

**真实的行为应该是：**

```
消息 1（并行搜索）：
  CodeGraph context("师徒绑定")  ← 用中文描述让工具帮我找
  CodeGraph search "TeacherStudent"
  CodeGraph search "bind"

消息 2（基于结果深入）：
  CodeGraph explore BindService TeacherController
  → 看到 BindService.bind() 创建了 TeacherStudentRelation
  → 看到 TeacherController.getMyStudents() 调了 TeacherService.queryStudents()

消息 3（追踪断点）：
  CodeGraph trace BindService.bind() → TeacherService.queryStudents()
  → 可能 trace 不到（因为不是直接调用关系）
  → 我需要分别读两边的代码，然后对比

消息 4（读 SQL 定位问题）：
  读 TeacherService.queryStudents() 调用的 Mapper
  → 发现 WHERE relation.status = 'ACTIVE'
  → 回到 BindService.bind() 看 status 设的什么
  → 发现是 'PENDING'
```

**对结论的影响**：

- 概念知识的价值**降低**——PENDING 状态这个信息，我通过读 BindService.bind() 的源码也能发现
- Bug 修复的核心困难不是"不知道 PENDING"，而是"找到正确的文件去读"
- CodeGraph context("师徒绑定") 一次调用可能就够了

**修正后的结论**：概念知识在 Bug 修复场景的价值比我之前说的小。真正的价值不是"直接告诉我答案"，而是"帮我更快找到正确的文件"。

---

### 场景 03：跨域新功能（优惠券抵扣订单）

| 描述的操作                                 | 真实性 | 问题                                   |
| ------------------------------------------ | :----: | -------------------------------------- |
| CodeGraph search "Order" + "Coupon" 分开搜 |   ⚠️   | 我会并行搜，不是分开                   |
| 读 CouponService.use() 发现是空方法        |   ⚠️   | 可能是真的，但也可能是我没看清实现     |
| CodeGraph search "coupon" in OrderService  |   ✅   | 确认两个域有无交互，真的会这样做       |
| 读 CouponDO 发现"适用商品范围"字段         |   ✅   | 读数据模型时确实会发现需求未提及的字段 |
| "知识库 5 步 6 分钟"                       |   ❌   | 理想化                                 |

**真实的行为应该是：**

```
消息 1（并行搜索）：
  CodeGraph context("订单提交流程")
  CodeGraph context("优惠券使用")
  CodeGraph search "Coupon"

消息 2（基于结果深入）：
  CodeGraph explore OrderService CouponService
  → 一次看到两个 Service 的方法列表和关键源码
  → 发现 OrderService 完全没有 coupon 相关代码
  → 发现 CouponService.use() 可能是空实现

消息 3（追踪支付回调）：
  CodeGraph search "payCallback\|paySuccess"
  CodeGraph node OrderService.payCallback()
  → 看到支付成功后的处理逻辑
```

**对结论的影响**：

- 能力域地图的价值**降低**——CodeGraph context 一次调用就帮我定位了两个域
- 跨域流程知识的价值**不变**——支付回调 + 定时任务竞态这种信息，CodeGraph 不容易给我
- 但我可能直接**问用户**："核销时机是支付成功后立即还是延迟？"——比查知识库更直接

---

### 场景 04：重构（分包模式变更）

| 描述的操作                              | 真实性 | 问题                       |
| --------------------------------------- | :----: | -------------------------- |
| CodeGraph search "Order" 找到所有订单类 |   ✅   | 真的                       |
| CodeGraph callers OrderService          |   ✅   | 真的                       |
| grep "OrderMapper" in \*.xml            |   ⚠️   | 我会用 Grep 工具但逻辑一样 |
| 知识库几乎无帮助                        |   ✅   | 这个结论是对的             |

**这个场景基本真实。** 重构是纯结构操作，CodeGraph impact 分析比知识库更有用。

唯一修正：我不需要"读 architecture.md 确认当前分包模式"——CodeGraph files 一看目录结构就知道了。

---

### 场景 05：外部集成（接入阿里云短信）

| 描述的操作                                 | 真实性 | 问题                                                                                  |
| ------------------------------------------ | :----: | ------------------------------------------------------------------------------------- |
| CodeGraph search "Sms\|SMS\|短信\|Message" |   ⚠️   | 我不会搜"短信"（中文），会搜 "Sms\|SMS\|Message\|sms"                                 |
| 读 SmsConfig 发现 smsCheckSwitch           |   ✅   | 真的                                                                                  |
| 读 SmsService 发现 if/else 分支            |   ✅   | 真的                                                                                  |
| 读 application.yml 确认值                  |   ✅   | 真的                                                                                  |
| "边界知识直接告诉我短信被禁用"             |   ⚠️   | 如果我知道 boundaries/ 目录存在，可能会去看。但我更可能在读 SmsService 时就自己发现了 |

**真实的行为应该是：**

```
消息 1（并行搜索）：
  CodeGraph search "Sms"
  CodeGraph context("短信发送")

消息 2（读关键代码）：
  CodeGraph explore SmsService SmsConfig SmsController
  → 一次看到：
  → SmsConfig 有 smsCheckSwitch
  → SmsService.sendSms() 有 if(smsCheckSwitch) 分支
  → SmsController 有 sendVerifyCode / verifyCode
  → 已经理解了全貌

消息 3（确认配置值）：
  Grep "smsCheckSwitch" in *.yml
  → 确认 false
```

**对结论的影响**：

- 边界知识的价值**降低**——我通过 CodeGraph explore 一次调用就能看到 SmsService 的 if 分支 + SmsConfig 的开关字段
- 边界知识真正的价值是：**在我还没有搜索到 SmsService 之前**就告诉我"短信功能被禁用"
- 但如果需求明确说"接入阿里云短信"，我必然会搜索现有短信代码，必然会自己发现

**修正后的结论**：边界知识在外部集成场景的价值比我之前说的小。因为 Agent 必然会搜索现有实现，搜索过程中必然会发现 if(switch) 分支。

---

### 场景 06：模糊需求（优化学习体验）

| 描述的操作                      | 真实性 | 问题                                                                 |
| ------------------------------- | :----: | -------------------------------------------------------------------- |
| 搜中文"学习进度"                |   ❌   | **错误操作**。我会搜 "progress" 或 "learning"                        |
| 逐个读 4 个 DO 的源码来区分概念 |   ⚠️   | 可能，但我更可能用 CodeGraph explore 一次看 4 个                     |
| "先理解现状再和用户讨论"        |   ❌   | **错误顺序**。面对模糊需求，我的第一反应是**问用户**，不是先去读代码 |
| "知识库帮我和用户讨论"          |   ⚠️   | 有道理，但前提是知识库的术语定义比代码更好懂                         |

**真实的行为应该是：**

```
消息 1（先问用户，不搜索代码）：
  AskUserQuestion:
  - "优化学习体验"具体是指哪些方面？
    a) 新增学习进度可视化（图表、统计）
    b) 改善现有练习记录的查看方式（筛选、排序、分页）
    c) 减少操作步骤（合并流程）
    d) 提升页面加载速度
  - 是否有具体的用户反馈或痛点？

消息 2（基于用户回答，定向搜索）：
  如果用户说"想看学习进度图表"：
  → CodeGraph context("学习进度")
  → CodeGraph search "progress" "statistics"

消息 3（如果遇到概念混淆）：
  → 如果我不确定 progress 和 record 和 statistics 的区别
  → 这时才去看 _glossary.md 或 concepts/
  → 或者直接问用户
```

**对结论的影响**：

- 概念知识的价值**降低**——面对模糊需求，我的第一步是问用户，不是查知识库
- 概念知识在模糊需求中的真正价值是：**用户回答了我的问题后**，帮我快速理解用户提到的概念在代码里叫什么
- 但这个价值和"明确需求"场景没有本质区别

**修正后的结论**：模糊需求场景下，知识库的价值不在于"帮我理解系统现状"（我会先问用户），而在于"用户回答后，帮我把用户的描述映射到代码"。这和普通场景的价值一样。

---

### 场景 07：性能问题（订单列表查询慢）

| 描述的操作                                   | 真实性 | 问题                      |
| -------------------------------------------- | :----: | ------------------------- |
| CodeGraph search OrderController             |   ✅   | 真的                      |
| CodeGraph node OrderService.queryOrderList() |   ✅   | 真的                      |
| 发现 N+1 查询                                |   ✅   | 读 Service 方法体就能看到 |
| 读 Mapper XML 确认 SQL                       |   ✅   | 真的需要读 XML            |
| 知识库几乎无帮助                             |   ✅   | 这个结论是对的            |

**这个场景基本真实。** 性能排查靠读代码和读 SQL，CodeGraph trace + explore 足够。

---

### 场景 08：配置变更（启用短信校验）

| 描述的操作                       | 真实性 | 问题                                                                                                 |
| -------------------------------- | :----: | ---------------------------------------------------------------------------------------------------- |
| CodeGraph search "Sms\|SMS"      |   ✅   | 真的                                                                                                 |
| 读 SmsConfig 发现 smsCheckSwitch |   ✅   | 真的                                                                                                 |
| 11 步操作                        |   ⚠️   | 步骤过多。真实情况下 CodeGraph explore SmsService SmsConfig SmsController 一次调用就能看到大部分信息 |
| "边界知识一条省了 9 分钟"        |   ❌   | 夸大。我通过读代码也能在 2~3 步内发现短信功能被禁用                                                  |

**真实的行为应该是：**

```
消息 1：
  CodeGraph context("短信校验")
  CodeGraph search "Sms"

消息 2：
  CodeGraph explore SmsService SmsConfig SmsController
  → 一次看到：
  → SmsConfig 有 smsCheckSwitch
  → SmsService 有 if(switch) 分支
  → SmsController 有 sendVerifyCode / verifyCode
  → 已经知道功能存在但被禁用

消息 3：
  Grep "smsCheckSwitch" in *.yml
  → 确认当前值 false
```

**3 步操作，不是 11 步。** 我之前把每一步都拆成了独立步骤，夸大了操作数量。

**对结论的影响**：

- 边界知识的价值**大幅降低**——我之前说"一条知识省了 9 分钟"是基于 11 步操作的假设。真实操作只需要 3 步
- 边界知识仍然有一定价值（告诉我"腾讯云配置可能需要重新验证"这种代码之外的信息），但不是"极大"

---

## 修正后的总结

### 修正 1：知识库不是起点，是补充

Agent 的真实工作模式不是：

```
读知识库 → 搜索代码 → 实现
```

而是：

```
搜索代码（或问用户）→ 遇到障碍 → 查知识库（如果知道它存在且相关）→ 继续
```

这降低了所有知识类型的"节省时间"价值，因为 Agent 不一定会去看知识库。

### 修正 2：CodeGraph 的 context/explore 被严重低估

我之前把 CodeGraph 当成"一次只查一个符号"的工具。实际上：

- `codegraph_context("打分功能")` 一次返回入口、相关符号、关键代码
- `codegraph_explore("ScoreService CouponService OrderService")` 一次看多个类的源码

这使得很多"无知识库时需要 N 步"的操作，实际上 1~2 步就能完成。

### 修正 3：知识库真正不可替代的场景变少了

修正后，知识库真正不可替代的场景只剩：

| 知识类型                                       | 不可替代的原因                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **概念知识**（仅跨文件综合型）                 | CodeGraph 能给我单个类的全貌，但不能告诉我"A 类和 B 类共同构成了'课件类型'概念"这种跨文件业务综合 |
| **跨域业务流程**                               | CodeGraph trace 在 @EventListener 处断裂，无法自动追踪异步触发的全链路                            |
| **约束知识**（仅"工程惯例 vs 业务约束"的过滤） | CodeGraph 能找到所有 throw 语句，但不能区分"参数校验"和"业务规则"                                 |

而以下内容，CodeGraph 可以基本替代：

- 域定位（CodeGraph context 用自然语言搜索）
- 操作清单（CodeGraph explore 看 Controller）
- 调用关系（CodeGraph trace）
- 实体关系（CodeGraph explore 看 DO 类）
- 短信/优惠券等功能的发现（CodeGraph search）

### 修正 4：知识库的"信息增量"门槛应该更高

设计文档的"3 分钟规则"（Agent 3 分钟内能自行获取的知识不值得生成）在 CodeGraph 加持下应该升级为**"1 次 CodeGraph 调用规则"**：

> 如果 Agent 通过 1 次 CodeGraph context 或 explore 调用就能获取同等信息，该知识不值得预生成。

用这个标准重新评估：

- 概念知识中的"简单字段含义"——CodeGraph node 一次就能看到 → 不值得
- 概念知识中的"跨文件综合概念"——需要多次 context + 人工综合 → 值得
- 能力目录的"域级上下文"——CodeGraph context 给不了业务描述 → 值得
- 能力目录的"操作清单"——CodeGraph explore 一次就能看到 → 不值得
- 约束知识的"过滤后清单"——CodeGraph 给不了"这是业务约束不是工程惯例"的判断 → 值得

### 修正 5：问用户 > 查知识库 > 搜索代码

面对不确定的业务含义时，三个选项的优先级应该是：

1. **问用户**（最快、最准确，但打断用户）
2. **查知识库**（快、但可能过时或不完整）
3. **搜索代码**（最慢、但最准确）

我在所有场景中都忽略了选项 1。真实工作中，我会在搜索 2~3 次后仍然不确定时选择问用户，而不是继续搜索或查知识库。

这意味着知识库的价值还要再打折——有些"知识库帮了忙"的场景，真实情况下我可能直接问用户了。
