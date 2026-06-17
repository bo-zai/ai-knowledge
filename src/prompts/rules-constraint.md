# 约束知识提取规则

## 定义

约束知识记录由代码、配置、测试明确体现的业务约束和技术约束。

## 提取重点

1. **异常抛出**：使用业务错误码的异常
2. **业务判断**：包含业务判断条件的校验
3. **事务边界**：事务注解声明的操作范围

## 过滤规则

- 排除通用参数校验：null check、空字符串、类型校验
- 排除框架层约束：ORM 注解、序列化配置
- 排除工程惯例：在任何同类型项目中都会出现的通用约束

## 生成约束

- 约束必须有代码证据支撑
- 描述应说明"什么条件下触发"和"触发后发生什么"
- 同一业务流程的多个约束合并为一条

## 产物示例

```json
{
  "constraint_name": "学生绑定老师频率限制",
  "summary_zh": "同一学生一年内只能绑定一次老师，防止频繁更换师徒关系",
  "constraint_type": "business_rule",
  "constraint_description_zh": "同一个学生一年内只能绑定一次老师",
  "aliases": ["StudentBindLimit", "师徒绑定限制", "绑定频率限制"],
  "trigger_condition": "绑定时间在上次绑定一年内",
  "violation_consequence": "抛出 UserException: 同一个用户一年之内只能绑定一次",
  "evidence": ["UserService.java#bind"],
  "applicable_scope": "仅学生主动绑定老师，管理员后台调整不受限",
  "tags": ["师徒", "绑定", "频率"]
}
```
