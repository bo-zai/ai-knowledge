# 4 类知识的输入与 LLM 生成

所有知识的内容由 LLM 生成。程序的角色是：收集输入 → 喂给 LLM → 校验输出 → 落盘。

---

## 一、跨文件综合型概念知识

### 输入

给 LLM 的输入材料：

```
1. 枚举/常量类的完整源码
   例：CoursewareTypeEnum.java 全文

2. 引用了这个枚举的所有 Service 方法（方法体源码 + 所在类名和行号）
   例：
   - ScoreService.score() 第 87~103 行：if (coursewareType == 3) { ... } else { ... }
   - CourseService.getTimetable() 第 45~62 行：根据 coursewareType 选择不同 DAO
   - StatisticsService.calculate() 第 112~128 行：曲目课件统计次数，内容课件统计时长

3. 相关测试中的断言
   例：ScoreServiceTest 中 assert coursewareType == 3 时 beat 不为空

4. 相关 commit message
   例：
   - "feat: 新增曲目课件类型(type=3)，支持节拍和和弦属性"
   - "fix: 修复课件类型判断遗漏导致内容课件走了曲目数据源"
```

### LLM 做什么

从上述输入中生成：

- 这个概念在业务上是什么（不是翻译类名）
- 不同值/分支在业务上的差异
- 影响哪些业务流程
- 容易误解的地方
- 代码入口位置

### 输出示例

```markdown
# 课件类型

课表中的每个练习任务有一个 coursewareType 字段，决定了数据来源和处理路径：

- type=3（PRACTICE_MUSIC）：曲目课件，数据从 TeachCategoryCourse 表读取，
  包含 beat、chord 属性
- 其他类型：教学内容课件，数据从 TeachCategoryContentCourse 表读取，
  额外包含 rhythm、listType 属性

两种课件在以下流程中走不同分支：

- 课表展示（CourseService.getTimetable）
- 打分（ScoreService.score）
- 学习统计（StatisticsService.calculate）

注意：coursewareType 是数据来源的路由标识，不是课件的分类体系。

代码入口：CoursewareTypeEnum、CoursewareDO.coursewareType、ScoreService.java#87
```

### 程序怎么收集输入

| 步骤 | 操作                                              |
| :--: | ------------------------------------------------- |
|  1   | AST 扫描仓库中所有 enum 类和常量类                |
|  2   | 对每个 enum，AST 查找所有引用它的 Service 方法    |
|  3   | 按"被 3 个以上 Service 引用"过滤 → 跨文件概念候选 |
|  4   | 提取候选 enum 的完整源码                          |
|  5   | 提取所有引用处的方法体源码（±20 行上下文）        |
|  6   | 搜索测试文件中对该 enum 的引用，提取断言          |
|  7   | git log 搜索涉及该 enum 文件的 commit message     |
|  8   | 将以上材料打包为一次 LLM 调用的输入               |

---

## 二、跨域业务流程

### 输入

给 LLM 的输入材料：

```
1. Controller 入口方法签名 + URL + 注解
   例：
   - POST /order/submit → OrderController.submit()
   - POST /order/appPay → OrderController.appPay()
   - POST /order/payCallback → OrderController.payCallback()

2. 从入口出发的调用链（2~3 层深度的方法签名 + 关键源码）
   例：
   submit() → GoodsService.checkStock()
            → StockService.deduct()（Redis 防重）
            → OrderMapper.insert()
   payCallback() → OrderService.confirmPay()（乐观锁更新 status）
                 → eventPublisher.publish(PaySuccessEvent)

3. 异步节点
   例：
   - @EventListener PaySuccessEventListener.onPaySuccess()
     → 触发积分发放、发送通知
   - OrderUnpaidJob.execute() @Scheduled(cron="0 */5 * * * ?")
     → 扫描 status=101 且超过 30 分钟的订单 → 自动取消

4. 竞态检测结果（程序发现同一实体被两条路径修改）
   例：
   - OrderDO.status 被 payCallback() 和 OrderUnpaidJob 同时修改
   - 保护机制：UPDATE ... WHERE version = ?（乐观锁）

5. 相关 commit message
   例：
   - "fix: 修复支付回调和自动取消的竞态条件，引入乐观锁"
   - "feat: 增加余额支付分支，跳过外部 SDK"
   - "fix: 支付超时后重复回调导致订单状态异常"
```

### LLM 做什么

从上述输入中生成：

- 端到端流程的步骤序列（从哪里开始、到哪里结束）
- 每个步骤的业务含义（不是翻译方法名）
- 关键分支（走不同路径的条件）
- 竞态条件和保护机制
- 触发条件和完成标志

### 输出示例

```markdown
# 商品购买全流程

触发条件：用户点击"购买"按钮
完成标志：支付回调确认，订单状态变为 201

步骤：

1. 浏览商品：GoodsController.list() / detail()
2. 加入购物车：CartController.add()
3. 提交订单：OrderController.submit()
   → 校验商品 → 扣减库存(Redis 防重) → 创建订单(status=101)
4. 发起支付：OrderController.appPay()
   → 根据 payType 选择支付宝或微信 SDK
5. 支付回调：OrderController.payCallback()
   → 乐观锁更新 status=201

关键分支：

- 余额支付：跳过外部 SDK，直接扣减余额 + 更新状态
- 超时未支付：OrderUnpaidJob(每 5 分钟) 自动取消超 30 分钟未支付订单，
  回滚库存

竞态条件：payCallback() 和 OrderUnpaidJob 都修改 order.status，
用乐观锁(version)保护。定时任务先执行取消后，支付回调因 version
不匹配失败，需发起退款。

代码入口：OrderController.submit()、payCallback()、OrderUnpaidJob.execute()
```

### 程序怎么收集输入

| 步骤 | 操作                                                                   |
| :--: | ---------------------------------------------------------------------- |
|  1   | AST 扫描所有 Controller 入口方法（@RequestMapping 等）                 |
|  2   | 从每个入口出发，AST 构建调用链（深度 2~3 层，只跟踪业务 Service）      |
|  3   | AST 扫描 @EventListener / @Async / 消息队列发送 → 标记异步节点         |
|  4   | AST 扫描 @Scheduled / Quartz Job 配置 → 记录定时任务                   |
|  5   | 检测竞态：同一个实体类被"Controller 调用链"和"定时任务"同时写入 → 标记 |
|  6   | 提取竞态保护代码（乐观锁 / 分布式锁的实现）                            |
|  7   | git log 搜索涉及竞态、回调、取消、超时的 commit message                |
|  8   | 将以上材料打包为一次 LLM 调用的输入                                    |

---

## 三、约束知识的过滤结果

### 输入

给 LLM 的输入材料：

```
1. 经程序预过滤后保留的 throw 语句（附上下文）
   例：
   - BindService.java#437:
     if (lastBind != null && daysBetween(lastBind, now) < 365) {
       throw new UserException(USER_BIND_LIMIT, "同一个用户一年之内只能绑定一次");
     }
     上下文：bind() 方法，在学生绑定老师时执行

   - OrderService.java#540:
     if (goods.getGoodsKind() == 1 && StringUtils.isBlank(order.getAddress())) {
       throw new OrderException(ORDER_ADDRESS_ERROR, "实物商品必须填写收货地址");
     }
     上下文：submit() 方法，在创建订单时执行

2. 异常类和错误码定义
   例：
   - UserException extends BusinessException
   - USER_BIND_LIMIT = 10001
   - ORDER_ADDRESS_ERROR = 20003

3. 测试中的断言（揭示业务规则）
   例：
   - BindServiceTest: assertThrows(UserException, () -> bind(student, teacher))
     // 测试场景：学生去年已绑定过

4. 数据库约束
   例：
   - ALTER TABLE order ADD UNIQUE (order_no)
   - ALTER TABLE user_coupon ADD CHECK (status IN (0, 1, 2))

5. 相关 commit message
   例：
   - "feat: 师徒绑定频率从半年改为一年"
   - "fix: 管理员后台绑定不应受频率限制"
```

**程序预过滤做了什么**：AST 扫描所有 throw 语句，用规则排除明显的工程惯例（null check、参数类型校验、IllegalArgumentException 等），只保留使用业务异常/业务错误码的 throw。大约从 200 条过滤到 20~30 条。

### LLM 做什么

从上述输入中生成：

- 用业务语言描述每条约束（不是翻译代码）
- 分类：业务规则 / 技术约束 / 数据约束
- 触发条件和违反后果
- 作用范围（影响哪些能力，有没有例外）

### 输出示例

```markdown
# 学生绑定老师频率限制

约束：同一个学生一年内只能绑定一次老师
类型：业务规则
触发条件：学生主动绑定时，检查上次绑定时间距今是否满 365 天
违反后果：抛 UserException，提示"同一个用户一年之内只能绑定一次"
作用范围：学生端绑定操作。管理员后台调整不受此限制（历史修复）
代码：BindService.java#437
```

### 程序怎么收集输入

| 步骤 | 操作                                                                           |
| :--: | ------------------------------------------------------------------------------ |
|  1   | AST 扫描所有 throw / raise / panic 语句                                        |
|  2   | 程序规则过滤：排除 IllegalArgumentException、null check、isEmpty、参数类型校验 |
|  3   | 保留使用自定义业务异常或业务错误码的 throw                                     |
|  4   | 提取每条保留 throw 的上下文（所在方法签名、if 条件、±20 行代码）               |
|  5   | AST 解析自定义异常类和错误码枚举/常量                                          |
|  6   | 搜索测试文件中对相关方法的断言                                                 |
|  7   | 解析 .sql 文件中的 UNIQUE / CHECK / NOT NULL / 外键约束                        |
|  8   | git log 搜索涉及"限制、约束、不允许、必须"的 commit message                    |
|  9   | 按 Service/方法分组（同一方法中的多个约束打包为一次 LLM 调用）                 |

---

## 四、能力域地图

### 输入

给 LLM 的输入材料：

```
1. Controller 分组结果（程序已按 URL 前缀 + 包路径分组）
   例：
   - 组 1：OrderController（/order/*）、OrderGoodsController（/order/goods/*）
     → 包含方法：submit, cancel, payCallback, queryOrder, getDetail
   - 组 2：TeachController（/teach/*）、ScoreController（/score/*）
     → 包含方法：makeTimetable, getTimetable, score, batchScore
   - 组 3：UserController（/user/*）、BindController（/bind/*）
     → 包含方法：register, login, bind, getMyStudents

2. 跨域 Service 调用统计
   例：
   - TeachService → IntegralService.addUserScore()（调用 3 处）
   - OrderService → StockService.deduct()（调用 2 处）
   - OrderService → CouponService.checkValid()（调用 1 处）
   - CartService → OrderService.submit()（调用 1 处）
   - ScoreService → LearningRecordService.update()（调用 1 处）

3. 各域被调用次数（被其他域的 Service 引用次数）
   例：
   - UserService：被 5 个域引用（身份校验）
   - IntegralService：被 2 个域引用
   - StockService：被 2 个域引用
   - OrderService：被 2 个域引用
   - CouponService：被 1 个域引用

4. 项目根目录结构
   例：
   src/main/java/com/app/
   ├── controller/  （OrderController, TeachController, UserController...）
   ├── service/     （OrderService, TeachService, UserService...）
   ├── mapper/
   └── entity/

5. 相关 commit message（文件共同变更频率）
   例：
   - "feat: 订单提交增加优惠券校验" → OrderService + CouponService 一起变更
   - "fix: 课表制定后积分未发放" → CourseService + IntegralService 一起变更
```

### LLM 做什么

从上述输入中生成：

- 每个域的一句话业务描述
- 核心域 / 支撑域 / 辅助域的分类
- 域间主要交互的业务语义描述

### 输出示例

```markdown
# 能力域地图

## 核心域

| 域       | 描述                                               | 入口                             |
| -------- | -------------------------------------------------- | -------------------------------- |
| 订单管理 | 商品购买的订单全生命周期（创建、支付、取消、查询） | OrderController                  |
| 教学管理 | 课表制定、课件练习、打分评价                       | TeachController, ScoreController |

## 支撑域

| 域       | 描述                           | 入口                           | 为谁服务             |
| -------- | ------------------------------ | ------------------------------ | -------------------- |
| 用户管理 | 注册、登录、师徒绑定、会员体系 | UserController, BindController | 所有需要身份校验的域 |
| 商品管理 | 商品信息维护、分类、库存管理   | GoodsController                | 订单管理、购物车     |

## 辅助域

| 域       | 描述                         | 入口                 |
| -------- | ---------------------------- | -------------------- |
| 积分管理 | 积分发放、查询、兑换         | IntegralController   |
| 学习统计 | 学习进度、练习记录、统计面板 | StatisticsController |

## 域间主要交互

- 用户管理 → 教学管理：教师身份校验
- 教学管理 → 积分管理：课表制定触发积分发放（异步）
- 商品管理 → 订单管理：库存扣减
- 购物车 → 订单管理：结算转入订单创建
```

### 程序怎么收集输入

| 步骤 | 操作                                                    |
| :--: | ------------------------------------------------------- |
|  1   | AST 扫描所有 Controller，提取 URL 前缀和包路径          |
|  2   | 按 URL 前缀 + 包路径分组 → 每组是一个域候选             |
|  3   | 对每个域，AST 构建 Service 层调用图                     |
|  4   | 统计跨域调用：A.Service → B.Service 的调用次数          |
|  5   | 统计每个域的被引用次数（被多少个其他域的 Service 依赖） |
|  6   | 提取项目顶层目录结构                                    |
|  7   | git log --name-only 统计文件共同变更频率                |
|  8   | 将以上材料打包为一次 LLM 调用的输入                     |

---

## 总览

```
          ┌─────────────────────────────────────┐
          │            程序：收集输入              │
          │                                     │
          │  AST 解析 → 源码、调用链、引用关系     │
          │  文件扫描 → 配置、SQL、测试            │
          │  Git 分析 → commit message、共同变更   │
          │  规则过滤 → 排除噪音（throw 过滤等）    │
          │  分组打包 → 按知识类型组织输入材料      │
          └──────────────┬──────────────────────┘
                         │
                         ▼
          ┌─────────────────────────────────────┐
          │           LLM：生成知识               │
          │                                     │
          │  输入：代码 + 调用链 + 测试 + commit    │
          │  输出：结构化的业务知识（JSON）          │
          │                                     │
          │  4 类知识，4 种提示词，4 次（批）调用    │
          └──────────────┬──────────────────────┘
                         │
                         ▼
          ┌─────────────────────────────────────┐
          │           程序：校验 + 落盘            │
          │                                     │
          │  校验代码路径真实性                    │
          │  JSON → Markdown 转换                │
          │  写入 ai-knowledge/ 目录              │
          └─────────────────────────────────────┘
```

| 知识类型 | 输入的核心材料                                                  | LLM 调用的粒度                |
| -------- | --------------------------------------------------------------- | ----------------------------- |
| 概念知识 | 枚举源码 + 所有引用处的分支逻辑 + 测试断言 + commit             | 每个概念一次调用              |
| 跨域流程 | 入口列表 + 调用链 + 异步节点 + 定时任务 + 竞态点 + commit       | 每条流程一次调用              |
| 约束过滤 | 预过滤后的 throw 上下文 + 异常类 + 测试断言 + SQL 约束 + commit | 按 Service 分组，每组一次调用 |
| 域地图   | Controller 分组 + 跨域调用统计 + 目录结构 + 共同变更 + commit   | 整个项目一次调用              |
