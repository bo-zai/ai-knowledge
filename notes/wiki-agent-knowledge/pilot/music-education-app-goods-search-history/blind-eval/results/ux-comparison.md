# UX Case Comparison

## Case

- requirement: `request-ux-search-browse-separation.md`
- baseline result: `ux-baseline-result.md`
- knowledge result: `ux-knowledge-result.md`

## Run Note

这一组里：

- `baseline` 在默认设置下完成
- `knowledge` 在完整自由探索下两次超时
- 最终通过 `glm-5 + effort=low + 限制不要全仓库穷举扫描` 完成

这说明一个现实问题：

- 知识增强虽然能提高判断质量，但如果 prompt 不收敛，Agent 也可能因为同时扫代码和知识目录而变慢
- 这更像“运行方式问题”，不是“知识本身无效”

## Summary

`knowledge` 版本依然明显优于 `baseline`。

最主要的提升不在“它知道更多文件名”，而在：

- 更清楚地区分了已知事实与开放问题
- 更早意识到 `keyword` / `keyType` / 搜索历史写入之间的分歧
- 更少把问题直接归咎为“前端状态管理问题”

## Rubric Scoring

### baseline

- business_intent_recovery: `2`
- boundary_accuracy: `1`
- change_surface_precision: `1`
- unknown_escalation_quality: `1`
- verification_completeness: `1`
- unsupported_assumption_rate: `1`

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

### 1. 过早把问题归因到前端

baseline 很快把问题解释成：

- 前端没有清空 keyword
- 前端状态管理出错

这不是完全错误，但它在没有足够证据前，把“可能的外部依赖”说得过于接近“根因”。

### 2. 没有抓住读写分歧

baseline 看到了搜索和分类是 AND 条件，但没有明确抓住：

- `keyword` 写历史时不检查 `keyType`
- SQL 过滤时检查 `keyType == 1`

也就是说，它看到了“浏览与搜索混在一起”，但没精准识别出最关键的系统内分歧点。

### 3. 改动面仍然偏散

baseline 把 controller、service、sql、前端状态一起拉进来了，但没有明确收敛“主改动面是谁、次改动面是谁、哪些其实只是外部依赖”。

## Where Knowledge Was Better

### 1. 把核心冲突说清楚了

knowledge 版本明确指出：

- `keyword` 是运行时搜索词
- `keyType == 1` 才触发商品名过滤
- 搜索历史写入条件与 SQL 过滤条件存在分歧

这直接把“用户为什么会觉得自己在逛，但结果像在搜”压缩成了可操作的系统问题。

### 2. 更稳地处理边界

knowledge 版本没有一上来把锅甩给前端，而是先说：

- 后端已知什么
- 当前知识不知道什么
- 哪些点需要前端/产品确认

这比 baseline 更符合我们想要的“先界定边界，再提未知项”。

### 3. 更贴近正确验证方式

knowledge 版本更自然地把回归点放在：

- 登录边界
- `keyword/keyType` 组合
- 搜索历史写入
- 其他非目标链路不受影响

这比 baseline 的验证列表更像一份能真正拿来做改动验收的计划。

## Residual Gap

这组 case 也再次证明：

- 光靠当前后端知识，仍然无法独立判断“用户交互意图”
- 真正缺的不是更多代码细节，而是“前端如何表达主动搜索 vs 浏览”的契约事实

所以这组知识的价值，不是替你闭合所有答案，而是：

- 把系统内部已知分歧抓出来
- 把真正该问的问题缩到最小集合

## Conclusion

第二组结果和第一组一致：

- 这批知识对象能稳定提高边界判断质量
- 也能稳定减少拍脑袋式归因
- `OPEN` 类对象尤其有效，因为它能阻止 Agent 把未确认行为说成既定事实
