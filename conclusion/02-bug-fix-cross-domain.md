# 场景 2：跨域 Bug 修复 —— 师徒绑定后教师端看不到学生

## 需求文档

> "Bug：教师为学生绑定师徒关系后，教师端的'我的学生'列表中看不到刚绑定的学生。需要排查原因并修复。"

## 我的工作过程

### 第一步：定位"绑定"和"我的学生"两端

Bug 修复需要找到两端——写入端（绑定）和读取端（列表查询），然后找断点。

```
CodeGraph context("师徒绑定 teacher student bind")
CodeGraph context("教师学生列表 teacher students list")
```

一次并行返回：
- context("绑定") → BindService.bind()、BindController、TeacherStudentRelation
- context("学生列表") → TeacherController.getMyStudents()、TeacherService.queryStudents()

**到这里我已经锁定了两端。**

### 第二步：读两端的关键代码

```
CodeGraph explore BindService TeacherService
```

一次返回两个 Service 的源码。我看到：

- BindService.bind()：检查频率限制 → 创建 TeacherStudentRelation（status = "PENDING"）→ 更新 StudentDO.teacherId
- TeacherService.queryStudents()：查询条件包含 relation.status = ?

**关键疑问**：queryStudents() 的查询条件中 status 等于什么？bind() 设的是 "PENDING"，如果查询要求 "ACTIVE"，那就是断点。

但 TeacherService.queryStudents() 的查询条件可能写在 Mapper XML 里，CodeGraph 可能只看到方法签名。我需要读 Mapper。

```
CodeGraph callees TeacherService.queryStudents()
```

→ 调用了 TeacherStudentMapper.selectByTeacher()

```
Grep "selectByTeacher" glob="*.xml"
```

→ 找到 Mapper XML 中的 SQL：
```sql
SELECT ... FROM teacher_student_relation WHERE teacher_id = ? AND status = 'ACTIVE'
```

**Bug 原因定位**：bind() 创建 relation 时 status = 'PENDING'，但列表查询要求 status = 'ACTIVE'。中间缺少"确认"步骤。

### 第三步：确认是设计意图还是 Bug

```
CodeGraph node BindService
```

→ 看到完整方法列表：bind()、confirmBind()、cancelBind()

→ 有 confirmBind() 方法！说明设计上就是"绑定申请 → 教师确认"两步流程。

这时候我需要问用户：

```
AskUserQuestion:
  - 系统设计上是"学生申请绑定 → 教师确认"两步流程。
    当前问题是教师端没有显示待确认的绑定请求，
    还是绑定应该改为自动确认（不需要教师确认）？
```

### 第四步：根据用户回答修复

**如果用户说"应该自动确认"**：
```
修改 BindService.bind()：创建 relation 时 status 直接设为 'ACTIVE'
```

修复前检查影响范围：
```
CodeGraph impact BindService.bind()
```
→ 找到所有调用方，确认修改不会破坏其他流程。

同时检查频率限制约束：
```
CodeGraph node BindService.bind()  ← 重新仔细看频率检查逻辑
```
→ 频率检查在 status 设置之前执行，不受影响。

**如果用户说"教师端应该显示待确认列表"**：
```
新增 TeacherController.getPendingBinds() 方法
查询 status = 'PENDING' 的绑定请求
```

### 第五步：编码和验证

检查约束：
- "一年只能绑定一次"的频率限制 → 从 bind() 源码中已看到，确认不受影响
- 绑定记录的完整性 → 检查 cancelBind() 是否需要调整

## 知识库在这个场景中的作用

回顾过程，我没有主动查知识库。CodeGraph 帮我完成了核心定位：
- context 帮我找到了两端（绑定和列表）
- explore 帮我看到了 PENDING 状态
- callees + grep XML 帮我找到了 ACTIVE 查询条件

**知识库可能在以下时刻有用**：

- 如果 concepts/teacher-student-bind.md 直接告诉我"绑定是两步流程：申请 → 确认，创建时 status=PENDING"，我可以在第一步就理解全貌，不需要等到第三步看 confirmBind() 方法名才推断出来
- 但这只是节省了"发现 confirmBind() 方法"这一步，CodeGraph node BindService 已经帮我看到了

**Bug 修复的核心困难是"找到断点"，不是"理解业务含义"。** CodeGraph 的 trace/explore/callees 在"找断点"这件事上比知识库更有效。

## 本场景结论

| 信息需求 | 实际获取方式 | 知识库的增量价值 |
|---------|------------|:---:|
| 绑定逻辑在哪 | CodeGraph context | 低 |
| 列表查询在哪 | CodeGraph context | 低 |
| bind() 创建 PENDING 状态 | CodeGraph explore | 无——源码直接可见 |
| 查询要求 ACTIVE 状态 | grep Mapper XML | 无 |
| 存在 confirmBind() 方法 | CodeGraph node | 低——概念知识可能提前告知 |
| 频率限制约束 | CodeGraph node（读源码） | 中——约束知识可直接告知 |
| 修复的影响范围 | CodeGraph impact | 无 |
