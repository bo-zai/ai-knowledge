# 场景 3：跨域新功能 —— 优惠券抵扣订单

## 需求文档

> "新增功能：订单提交时支持使用优惠券抵扣。用户从可用优惠券列表中选择一张，系统校验优惠券有效性后计算抵扣金额，订单支付后核销优惠券。优惠券过期、已使用、不满足使用条件时应给出明确提示。"

## 我的工作过程

### 第一步：并行理解两个域

需求涉及订单和优惠券两个域，我需要同时理解：

```
CodeGraph context("订单提交 submit order")
CodeGraph context("优惠券 coupon 使用")
```

一次并行返回：

- context("订单提交") → OrderController.submit()、OrderService.submit() 及其调用链
- context("优惠券") → CouponController、CouponService、CouponDO、UserCouponDO

**初步了解**：两个域都有代码，但需要确认它们之间有没有交互。

### 第二步：检查现有交互 + 深入理解

```
CodeGraph explore OrderService CouponService CouponDO
```

一次调用返回三个类的源码：

- OrderService.submit()：校验商品 → 扣减库存 → 计算金额 → 创建订单 → 没有任何 coupon 相关代码
- CouponService：有 checkValid()（校验有效性）、use()（核销）、receive()（领取）
- CouponDO 字段：amount（面额）、minSpend（最低消费）、expireTime、status、applicableGoods（适用商品范围）

**关键发现**：

1. 订单服务完全不知道优惠券的存在 → 需要新建集成
2. CouponService.checkValid() 已实现 → 可复用
3. CouponService.use() → 需要确认是否已实现
4. CouponDO 有 applicableGoods 字段 → 需求没提"适用商品范围"

### 第三步：确认需求细节

```
AskUserQuestion:
  - CouponDO 有 applicableGoods（适用商品范围）字段。
    优惠券是全部商品通用，还是需要校验适用商品？
  - 订单取消时，已使用的优惠券怎么处理？退回还是作废？
```

同时追踪支付回调，确认核销时机：

```
CodeGraph search "payCallback" kind=method
```

→ 找到 OrderService.payCallback()

```
CodeGraph node OrderService.payCallback()
```

→ 看到支付成功后的处理逻辑：更新订单状态（乐观锁保护）、更新支付记录

→ 核销应该加在这个方法里

### 第四步：检查竞态和边界情况

需求说"支付后核销"，但订单可能被自动取消（定时任务）。我需要确认：

```
CodeGraph search "OrderUnpaid\|orderCancel\|autoCancel" kind=function
```

→ 找到 OrderUnpaidJob（定时任务自动取消未支付订单）

→ 这说明存在竞态：支付回调和自动取消可能同时触发。订单状态已有乐观锁保护，优惠券核销也需要类似保护。

```
AskUserQuestion:
  - 如果用户在支付过程中优惠券刚好过期了，怎么处理？
    a) 提交订单时校验有效性，支付时不再校验
    b) 支付核销时再次校验
```

### 第五步：设计集成方案

基于前面的理解：

1. SubmitOrderRequest 新增 couponId 字段（可选）
2. OrderService.submit() 中，如果 couponId 不为空：调用 CouponService.checkValid() → 计算抵扣金额 → 记录优惠金额
3. OrderDO 新增 discountAmount 字段
4. OrderService.payCallback() 中：调用 CouponService.use() 核销
5. OrderService.cancel() 中：如果订单使用了优惠券，回滚优惠券状态
6. CouponService 新增 rollback() 方法

确认代码位置：

```
CodeGraph node OrderController
```

→ com.app.service.OrderService → 按层分包 → 修改现有 Service

### 第六步：编码

参考现有代码模式：

- 乐观锁：从 payCallback() 中看到版本号更新模式，复用到优惠券状态更新
- 事务：从 submit() 中看到 @Transactional 的使用模式
- 异常处理：从现有校验逻辑中看到 throw BusinessException 的模式

### 第七步：验证

边界情况：

- 同一张优惠券被两个订单同时使用 → use() 中加乐观锁
- 抵扣后订单金额为负数 → 限制抵扣金额不超过订单金额
- 订单金额小于优惠券最低消费 → checkValid() 已处理

## 知识库在这个场景中的作用

CodeGraph 覆盖了大部分信息需求。知识库可能在以下时刻有用：

- **能力目录的域级上下文**：如果 capabilities/order.md 告诉我"支付回调与定时任务存在竞态条件，使用乐观锁保护"，我在第三步就知道要注意竞态，不需要自己搜索 OrderUnpaidJob 才发现
- **跨域业务流程**：如果 workflows/purchase-flow.md 描述了"支付 → 回调 → 自动取消"的完整路径和关键分支，我不需要自己从 OrderUnpaidJob 和 payCallback() 中拼凑
- **概念知识**：如果 concepts/coupon-status.md 直接告诉我"状态只能从 UNUSED → USED 或 UNUSED → EXPIRED"，我不需要从 CouponService 源码中推断

但这些"如果"的前提是**我知道去查这些文件**。真实情况下，我可能不会主动去查——因为 CodeGraph 已经给了我足够的线索（我看到了 payCallback 中的乐观锁、看到了 OrderUnpaidJob 的存在），我可以自己跟进。

## 本场景结论

| 信息需求                          | 实际获取方式                 |        知识库的增量价值        |
| --------------------------------- | ---------------------------- | :----------------------------: |
| 订单和优惠券有无交互              | CodeGraph explore            |               无               |
| checkValid() 已实现、use() 待实现 | CodeGraph explore            |               无               |
| 支付回调位置和逻辑                | CodeGraph search + node      |               无               |
| 定时任务自动取消的竞态            | CodeGraph search OrderUnpaid | **中**——跨域流程知识可直接告知 |
| 乐观锁保护模式                    | 读 payCallback() 源码        |               低               |
| 优惠券状态机                      | 读 CouponService 源码        |   **中**——概念知识可直接告知   |
| applicableGoods 字段              | 读 CouponDO 源码             |               低               |
