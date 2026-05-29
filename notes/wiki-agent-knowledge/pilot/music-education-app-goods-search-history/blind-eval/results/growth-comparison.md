# Growth Case Comparison

## Case

- requirement: `request-growth-search-data-quality.md`
- baseline result: `growth-baseline-result.md`
- knowledge result: `growth-knowledge-result.md`

## Summary

这一轮对比已经能说明知识对象是有效的。

两组输出都能理解到“这是主动搜索与普通浏览的边界问题”，但 `knowledge` 版本明显更稳：

- 更准地收敛了主改动面
- 更少地提出不必要的表结构/持久化层改动
- 更明确地区分“已知事实”和“需要升级确认的未知项”
- 更接近我们预设的 `OPEN` 对象设计目标

## Rubric Scoring

### baseline

- business_intent_recovery: `2`
- boundary_accuracy: `1`
- change_surface_precision: `1`
- unknown_escalation_quality: `2`
- verification_completeness: `1`
- unsupported_assumption_rate: `0`

total: `7 / 12`

### knowledge

- business_intent_recovery: `2`
- boundary_accuracy: `2`
- change_surface_precision: `2`
- unknown_escalation_quality: `2`
- verification_completeness: `2`
- unsupported_assumption_rate: `1`

total: `11 / 12`

## Where Baseline Was Weaker

### 1. 改动面过宽

baseline 把 `SearchHistoryDO`、`SearchHistoryMapper`、甚至表结构变更都列入主改动面，但当前需求并没有直接要求存储结构变化。

### 2. 容易引入无证据方案

baseline 很快提出：

- 新增 `isSearchAction`
- 新增 `searchType`
- 数据表新增字段

这些不是不可能，但它们在当前阶段都还只是方案，不是事实。

### 3. 对模块边界收敛不够

baseline 虽然看到了 `GoodsService` 是主入口，但没有像 knowledge 版本那样明确收敛到：

- 触发条件主要归属 `GoodsService`
- `SearchHistoryService` 只是窄持久化边界
- `GoodsController` 不该承接业务语义

## Where Knowledge Was Better

### 1. 准确识别了主改动面

knowledge 版本把主改动面集中在：

- `CON-GOODS-LIST`
- `MOD-GOODS-SERVICE-QUERY-PAGE`
- 请求语义层

同时明确 `SearchHistoryService` 和 `GoodsController` 大概率不是主改动点。

### 2. 更好地处理了未知项

knowledge 版本没有把“主动搜索 vs 浏览”的区分强行脑补成后端已知规则，而是明确把它提升为阻塞性未知项。

这说明 `OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE` 这类对象确实改变了 Agent 的决策行为。

### 3. 更完整地继承了验证意识

knowledge 版本能更自然地补出：

- 登录边界不能被破坏
- `keyword` 与 `keyType` 关系要回归
- 历史写入与普通浏览要分开验证

## Residual Gap

即使有知识对象，Agent 仍然不能单独闭合这个需求，因为仓库里并没有“客户端如何表达主动搜索”的事实。

这不是知识失败，而是知识系统正确地把问题留在了 `OPEN` 状态，而不是制造伪答案。

## Conclusion

这轮结果支持下面这个判断：

- 这批知识对象已经能明显降低错误改动面的概率
- 也能明显降低“把推测当事实”的倾向
- 它们还不能替代产品/前端确认，但已经能让 Agent 更早、更准地提出该问的问题
