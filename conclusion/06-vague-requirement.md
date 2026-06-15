# 场景 6：模糊需求 —— 优化学习体验

## 需求文档

> "优化学生的学习体验，让学生更方便地查看学习进度和练习记录。"

## 我的工作过程

### 第一步：先问用户

这个需求太模糊了。"优化学习体验"可以是任何事情。在搜索代码之前，我需要先缩小范围：

```
AskUserQuestion:
  - "优化学习体验"具体是指哪些方面？
    a) 新增学习进度可视化（图表、统计面板）
    b) 改善现有练习记录的查看方式（筛选、排序、分页）
    c) 减少操作步骤（合并流程、一键操作）
    d) 提升页面加载速度
    e) 其他
  - 有没有具体的用户反馈或痛点？比如"找不到XX"、"操作太复杂"、"加载太慢"？
  - 改动范围是后端 API、前端页面、还是两端都改？
```

**如果我不问就直接去搜代码，我会迷失在大量相关类中不知道该看哪个。**

### 第二步：根据用户回答定向搜索

假设用户回答："主要是练习记录列表不好用，学生想按课件类型筛选、按时间排序，但现在只能看到全部记录。后端 API 和前端都需要改。"

现在需求明确了：**改善练习记录列表的筛选和排序能力**。

```
CodeGraph context("练习记录 practice record list")
CodeGraph search "PracticeRecord" kind=class
```

→ 返回 PracticeRecordDO、PracticeRecordService、PracticeController

### 第三步：理解现有实现

```
CodeGraph explore PracticeController PracticeRecordService PracticeRecordDO
```

一次返回三个类的源码：
- PracticeController.getRecords()：返回 List<PracticeRecordVO>，没有分页、没有筛选参数
- PracticeRecordService.queryRecords()：直接 selectList，WHERE user_id = ?
- PracticeRecordDO 字段：userId, coursewareId, coursewareType, practiceCount, lastPracticeTime, score

**问题明确**：
1. 没有分页 → 记录多时列表很长
2. 没有 coursewareType 筛选 → 不能按课件类型过滤
3. 没有排序参数 → 不能按时间或次数排序

### 第四步：确认"课件类型"含义

需求说"按课件类型筛选"。我需要确认 coursewareType 的可选值：

```
CodeGraph node CoursewareTypeEnum
```

→ type=3 是 PRACTICE_MUSIC，其他值是教学内容课件

如果概念知识文件存在且我知道，我可能直接看 concepts/courseware-type.md 获取更详细的业务含义。但大多数情况下，CodeGraph node 返回的枚举值已经够用了。

### 第五步：设计改进方案

1. PracticeController.getRecords() 新增参数：coursewareType（可选）、sortBy（可选）、page/size
2. PracticeRecordService.queryRecords() 增加 WHERE 条件和 ORDER BY
3. Mapper XML 更新 SQL
4. 返回类型改为分页结果

### 第六步：编码和验证

参考现有分页查询模式（grep "PageHelper\|PageInfo\|Page" in Service files），复用项目已有的分页方式。

## 知识库在这个场景中的作用

**第一步中知识库完全没用**——面对模糊需求，唯一有效的手段是问用户。

**第二步之后**，如果我知道知识库存在：
- concepts/_glossary.md 可以帮我快速确认"练习记录"对应 PracticeRecordDO，但 CodeGraph context 已经帮我做了这个映射
- concepts/courseware-type.md 可以告诉我课件类型的业务含义，但 CodeGraph node 已经返回了枚举值

**知识库在模糊需求场景中的价值取决于用户回答后的方向**：
- 如果用户说"想看学习进度图表" → 我可能需要理解"学习进度"和"练习记录"和"学习统计"的区别 → 这时概念知识有增量价值
- 如果用户说"练习记录列表不好用"（如本场景）→ 需求明确，CodeGraph 足够

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| 需求到底要什么 | **问用户** | 无 |
| 练习记录对应什么类 | CodeGraph context | 低 |
| 现有列表 API 的问题 | CodeGraph explore | 无 |
| 课件类型的可选值 | CodeGraph node | 低 |
| 分页模式参考 | Grep 现有代码 | 无 |

模糊需求场景下，**问用户**是不可替代的第一步。知识库在需求澄清后有一些增量价值（帮助理解概念区分），但 CodeGraph 已覆盖大部分需求。
