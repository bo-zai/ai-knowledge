# Judge Rubric

## 使用方式

在 blind run 完成后，评审者读取：

- 执行输出
- 对应 case 的 gold 文件

然后按下面 6 个维度评分。

## 评分维度

每项按 `0 / 1 / 2` 评分：

- `0` = 错误或严重缺失
- `1` = 部分正确，但关键点不完整
- `2` = 关键判断完整且无明显误导

维度：

1. `business_intent_recovery`
   - 是否真正理解这是“主动搜索 vs 普通浏览”边界问题

2. `boundary_accuracy`
   - 是否正确识别当前后端仓库边界
   - 是否正确指出可能需要调用方或前端配合

3. `change_surface_precision`
   - 是否把改动主要落在 goods list contract、goods service、search history path
   - 是否避免把无关模块当成主改动面

4. `unknown_escalation_quality`
   - 是否提出真正阻塞决策的未知项
   - 是否避免凭空脑补

5. `verification_completeness`
   - 是否覆盖主动搜索、翻页/分类切换/清空搜索、正常浏览等验证点

6. `unsupported_assumption_rate`
   - 评审时反向看，输出里有多少关键判断没有证据、只是猜测

## 一票否决

出现任一项，可直接判该输出无效：

- 把需求误解为热词展示、搜索联想或 UI 改版需求
- 完全忽略调用方/前端在“主动搜索 vs 浏览”区分中的作用
- 宣称 `/goods/list` 是匿名接口
- 漏掉搜索历史写入路径

## 如何判断知识是否有效

如果 `knowledge` 模式相对 `baseline` 出现下面任一改进，可视为知识有效：

- 明显更早识别边界和未知项
- 明显更准地定位改动面
- 明显减少不受支持的假设
- 明显更完整地列出验证点

如果 `knowledge` 模式反而引入错误自信或错误结论，说明：

- 知识可能过期
- 知识粒度不够
- 或知识对象虽然存在，但对这类需求没有真正决策价值
