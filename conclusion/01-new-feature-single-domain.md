# 场景 1：单域新功能 —— 教师批量打分

## 需求文档

> "新增功能：教师可以为学生批量打分。选择课件类型后，展示该类型下所有学生的练习记录，教师逐个填写分数后一键提交。打分完成后自动更新学习记录并触发积分发放。"

## 我的工作过程

### 第一步：术语映射 + 定位入口

需求里有 5 个业务术语需要映射到代码。我不会逐个搜，直接并行发起：

```
CodeGraph context("教师打分评分")
CodeGraph context("课件类型 courseware type")
CodeGraph search "Score" kind=method
CodeGraph search "Integral" kind=function
```

一次并行调用返回：
- context("打分") → 返回 ScoreController.score()、ScoreService、相关符号和关键代码
- context("课件类型") → 返回 CoursewareDO.coursewareType、CoursewareTypeEnum
- search "Score" → ScoreController、ScoreService、ScoreDO、ScoreRecord 等
- search "Integral" → IntegralService.addUserScore()、IntegralController

**到这里我已经知道**：打分入口在 ScoreService，课件类型是 CoursewareTypeEnum，积分服务是 IntegralService。

### 第二步：理解现有打分流程

```
CodeGraph explore ScoreService CoursewareTypeEnum IntegralService
```

一次调用返回三个类的源码。我看到：

- ScoreService.score() 方法：校验教师身份 → 查练习记录 → 保存分数 → 更新学习记录 → publishEvent(ScoreEvent)
- CoursewareTypeEnum：type=3 是 PRACTICE_MUSIC，其他类型含义不明
- IntegralService.addUserScore()：积分发放逻辑

**关键发现**：ScoreService.score() 发了一个 ScoreEvent。谁在监听？

```
CodeGraph callers ScoreEvent
```

→ IntegralService.onScoreEvent() 监听了 ScoreEvent → 异步触发积分发放。

**到这里我已经理解了现有打分的全链路：打分 → 更新学习记录 → 异步触发积分。**

### 第三步：确认需求细节

有些信息我从代码里确认不了：

```
AskUserQuestion:
  - 课件类型有两种（PRACTICE_MUSIC 和教学内容），批量打分是否两种都支持？
  - 批量打分时，一个学生打分失败，其他学生继续还是全部回滚？
```

同时继续搜索课件类型的分支逻辑：

```
grep "coursewareType" path=ScoreService
```

→ 发现 score() 方法里根据 coursewareType 走不同数据来源：type=3 从 TeachCategoryCourse 取数据，其他从 TeachCategoryContentCourse 取。

### 第四步：确定实现方案

基于前面的理解：
1. 批量打分入口：在 ScoreController 新增 batchScore() 方法
2. 复用现有 score() 的逻辑，循环调用
3. 积分发放复用 ScoreEvent 异步机制
4. 课件类型的分支逻辑已存在，无需额外处理

需要确认新代码放哪个包：

```
CodeGraph node ScoreController
```

→ 包路径 com.education.music.app.controller → 按层分包 → 新方法加在同一个 Controller 中。

### 第五步：编码

参考现有 score() 方法的参数格式（ScoreRequest DTO）、权限注解（@RequireRole）、事务处理方式，编写 batchScore()。

编码过程中检查约束：
- 权限注解：从现有 score() 方法看到 @RequireRole("TEACHER")，直接复用
- 事务边界：看现有批量操作模式（grep "@Transactional" in Service files）

### 第六步：验证

检查边界情况：
- 空学生列表 → 参数校验
- 课件类型不存在 → 参数校验
- 一个学生打分失败 → 根据用户回答决定策略
- 批量 ScoreEvent 对积分服务的压力 → 读 IntegralService.onScoreEvent() 确认是否有防重

## 知识库在这个场景中的作用

回顾整个过程，我没有主动去查知识库。原因：

1. CodeGraph context 用自然语言搜索，一次就帮我完成了术语映射（"打分" → ScoreService，"课件类型" → CoursewareTypeEnum）
2. CodeGraph explore 一次返回多个类的源码，让我快速理解了打分流程和课件类型分支
3. CodeGraph callers 帮我发现了异步积分触发

**知识库可能在以下时刻有用**（如果我知道它存在）：

- 第三步中，如果 concepts/courseware-type.md 直接告诉我"两种课件类型走不同数据源"，我可以少做一次 grep
- 第五步中，如果约束知识告诉我"积分发放有每周首次限制"，我可以提前处理

但这些是"锦上添花"，不是"没有就不行"。CodeGraph 已经覆盖了 80% 的信息需求。

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| 术语映射（打分→ScoreService） | CodeGraph context | 低——context 已覆盖 |
| 现有打分流程 | CodeGraph explore | 无 |
| 积分是异步触发的 | CodeGraph callers ScoreEvent | 无 |
| 课件类型的分支逻辑 | grep coursewareType | 中——概念知识可替代 |
| 积分发放的限制条件 | 读 IntegralService 源码 | 中——约束知识可替代 |
| 新代码放哪个包 | CodeGraph node | 无 |
