# 场景 7：性能问题 —— 订单列表查询慢

## 需求文档

> "用户反馈：订单列表页面加载很慢，特别是查询历史订单时，有时候需要 10 秒以上。需要排查原因并优化。"

## 我的工作过程

### 第一步：定位 API 入口

```
CodeGraph context("订单列表查询 order list query")
```

→ 返回 OrderController.queryOrder()、OrderService.queryOrderList() 及相关符号

### 第二步：追踪查询逻辑

```
CodeGraph explore OrderService
```

→ 看到 queryOrderList() 方法体：
1. OrderMapper.selectList(query) → 查主表
2. 对每个订单：OrderGoodsMapper.selectByOrderId(orderId) → 查商品
3. 对每个订单：UserService.getUser(order.userId) → 查用户

**N+1 查询问题。** 但这只是代码层面的判断，我需要看实际 SQL。

### 第三步：读 Mapper XML 确认 SQL

```
Grep "selectList" glob="*Order*Mapper.xml"
Grep "selectByOrderId" glob="*OrderGoods*Mapper.xml"
```

→ OrderMapper.selectList：
```sql
SELECT * FROM order WHERE user_id = #{userId} ORDER BY create_time DESC
```
没有 LIMIT，全量查询

→ OrderGoodsMapper.selectByOrderId：
```sql
SELECT * FROM order_goods WHERE order_id = #{orderId}
```
每个订单一次查询

### 第四步：评估数据量

```
AskUserQuestion:
  - 历史订单大约有多少条？几百还是几万？
  - 列表当前是否有分页？前端每次加载多少条？
```

### 第五步：设计优化方案

基于已发现的问题：

**问题 1：主查询无分页**
→ 添加 LIMIT + OFFSET
→ 检查前端是否传了分页参数

**问题 2：订单商品 N+1**
→ 改用 IN 查询：WHERE order_id IN (#{orderIds})
→ 一次查出所有订单的商品

**问题 3：用户信息 N+1**
→ 批量查询用户：WHERE id IN (#{userIds})
→ 或者如果列表不展示用户详情，移除这个查询

### 第六步：编码

1. 修改 OrderMapper.selectList 添加 LIMIT
2. 修改 OrderService：收集所有 orderId → 一次 IN 查商品
3. 修改 OrderService：收集所有 userId → 一次 IN 查用户
4. 如果项目有 Redis，考虑添加列表缓存

### 第七步：验证

- 确认分页参数正确传递
- 确认 IN 查询结果和 N+1 查询结果一致
- 确认排序逻辑不变

## 知识库在这个场景中的作用

**几乎没有。** 性能排查完全是"读代码 + 读 SQL"的过程，CodeGraph 的 explore + grep XML 覆盖了全部需求。

知识库可能在以下时刻有微小价值：
- 如果约束知识告诉我"订单列表必须展示商品名称和用户昵称"，我知道不能简单移除 JOIN
- 但这个信息从 Controller 的返回 VO 字段也能推断

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| API 入口 | CodeGraph context | 无 |
| 查询逻辑 | CodeGraph explore | 无 |
| N+1 问题 | 读 Service 源码 | 无 |
| SQL 详情 | Grep XML | 无 |
| 分页有无 | 读 SQL | 无 |
| 列表展示字段 | 读 VO 类 | 无 |

性能优化场景下知识库 ROI 接近零。和重构并列，是知识库价值最低的场景。
