# Object Lifecycle Policy

这个策略定义单个知识对象从“提出”到“保留/删除”的生命周期。

## 状态

建议对象生命周期状态：

- `proposed`
- `draft`
- `trial`
- `stable`
- `stale`
- `deprecated`
- `removed`

## 状态说明

### proposed

- 已有候选 claim
- 尚未补齐证据

### draft

- 已形成对象文件
- 证据基本齐全
- 尚未参与真实评测

### trial

- 已进入真实 case 评测
- 结果未稳定

### stable

- 在真实 case 中证明有价值
- 有 owner 和 freshness 机制

### stale

- 触发了 `stale_if`
- 尚未重新验证

### deprecated

- 仍保留历史价值
- 但不再推荐使用

### removed

- 已确认无效、重复或错误

## 升级条件

- `proposed -> draft`
  - 至少一条一手证据
  - claim 可证伪
  - task_triggers 明确

- `draft -> trial`
  - 至少绑定一个 gold case
  - 已声明 target_metrics
  - 可做 with / without / stale 对比

- `trial -> stable`
  - 改善至少一个核心指标
  - 或避免一个 veto 级错误
  - 无明显冲突

## 降级条件

- `stable -> stale`
  - 命中 stale_if

- `trial/stable -> deprecated`
  - 有替代对象
  - 或价值明显下降，但仍保留历史上下文意义

- `draft/trial/stable -> removed`
  - 与事实冲突
  - 多次评测无效
  - 明显重复
  - 已不再服务任何真实任务

## 对象变更记录建议

每次状态变化建议记录：

```yaml
object_id:
from_status:
to_status:
date:
reason:
changed_by:
related_cases:
related_evidence:
```

