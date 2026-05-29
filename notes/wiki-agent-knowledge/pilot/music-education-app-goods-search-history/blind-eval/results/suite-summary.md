# Blind Eval Suite Summary

## Scope

本轮已经完成两组需求的 `baseline vs knowledge` 对比：

1. `request-growth-search-data-quality.md`
2. `request-ux-search-browse-separation.md`

## Results

### Growth Case

- baseline: `7 / 12`
- knowledge: `11 / 12`
- detail: `growth-comparison.md`

### UX Case

- baseline: `7 / 12`
- knowledge: `11 / 12`
- detail: `ux-comparison.md`

## Cross-Case Pattern

两组 case 呈现出的提升模式非常一致：

- `knowledge` 更擅长收敛主改动面
- `knowledge` 更擅长把“未知项”提成阻塞性问题，而不是直接脑补
- `knowledge` 更擅长把验证计划拉回到真正的风险点

而 `baseline` 的典型弱点也很稳定：

- 改动面容易发散
- 容易把可能性说成事实
- 容易过早归因到前端或外部系统

## Most Valuable Object Types

从两组结果看，当前最有价值的对象类型是：

- `TERM`
  - 帮助稳定 keyword 的运行时语义
- `CON`
  - 帮助稳定接口参数和登录边界理解
- `MOD`
  - 帮助稳定主改动面定位
- `OPEN`
  - 帮助显式暴露真正阻塞决策的未知项

其中 `OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE` 的效果最明显。

## What This Proves

这轮 MVP 已经证明：

- 我们沉淀的知识不是“看起来有用”
- 它们在真实需求理解任务里，确实改变了 Agent 的判断结果
- 且这种改进不是单 case 偶然现象，而是在两个不同导向的真实需求里都能复现

## Remaining Limitation

当前知识系统仍然有明确边界：

- 它能明显改善“后端代码理解与规划”
- 但它不能替代缺失的前端契约事实和产品规则定义

这不是失败，而是正确边界。
