# Object Review Checklist

单个知识对象进入稳定层前，至少逐项检查：

## 基础真实性

- [ ] `Claim` 是一句可证伪的话
- [ ] 至少绑定一个一手证据
- [ ] `Scope` 明确
- [ ] `Status` 明确，不混淆 `fact / decision / open-question`

## 对 Agent 的价值

- [ ] 明确写出了 `task_triggers`
- [ ] 明确写出了 `decision_points`
- [ ] 明确写出了 `expected_failure_if_missing`
- [ ] 明确写出了 `expected_failure_if_stale`

## 非伪知识检查

- [ ] 不是读代码 `30` 秒即可获得的显性事实
- [ ] 不是纯规范或 SOP
- [ ] 不是一次性临时状态
- [ ] 不是重复或冲突对象

## 可维护性

- [ ] `stale_if` 足够具体
- [ ] `owner` 明确
- [ ] `last_verified` 已填写

## 评测准备

- [ ] 已关联至少一个 `gold case`
- [ ] 已明确目标指标
- [ ] 可以做 `with / without / stale` 对比

