# 能力关系提取规则

## 定义
能力关系知识记录仓库内可见业务能力之间的组合、依赖、上下游或共享概念关系。

## 提取重点
1. **调用依赖**：能力 A 直接调用能力 B 的 Service 方法
2. **触发链**：能力 A 执行后同步触发能力 B
3. **异步触发**：能力 A 通过事件总线异步触发能力 B
4. **共享实体**：能力 A 和 B 操作同一个业务实体

## 过滤规则
- 只记录业务 Service 层之间的关系
- 排除 Service → Mapper/DAO 的调用
- 排除 Service → 工具类/基础设施的调用

## 生成约束
- 关系必须有代码证据支撑
- 同一业务流程的多条调用关系合并为一条
- 标注无法静态追踪的边（反射、动态代理、事件机制）

## 产物示例
```json
{
  "relation_name": "课表制定触发评分更新",
  "summary_zh": "练习录音打分后通过 EventBus 异步更新课表中的最高评分",
  "relation_type": "async_trigger",
  "participating_capabilities": ["课表制定", "练习录音评分"],
  "aliases": ["ScoreUpdateTrigger", "评分更新触发", "课表评分关系"],
  "relation_description_zh": "练习录音打分通过 EventBus 异步更新课表中的最高评分",
  "evidence": ["ScoreListener.handleScore", "BasicEventBus.post"],
  "applicable_scope": "仅教师为学生制定课表后的评分场景",
  "tags": ["课表", "评分", "事件驱动"]
}
```