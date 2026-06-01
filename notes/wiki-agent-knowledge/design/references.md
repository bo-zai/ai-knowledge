# 参考资料与未决问题

## 外部参考

| # | 来源 | 关键启发 |
|---|---|---|
| 1 | [Harness Engineering (Aliyun)](https://developer.aliyun.com/article/1734483) | wiki 是业务上下文层，应按需加载，通过 Owner/Index 管理读取路径 |
| 2 | [Harness Engineering (OpenAI)](https://openai.com/index/harness-engineering/) | 仅靠文档无法保持一致性，需要知识、流程、验证和反馈回路一起考虑 |
| 3 | [Effective Context Engineering (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 关键不是堆上下文，而是让 Agent 在正确时机拿到正确上下文 |
| 4 | [Claude Code Memory (Anthropic)](https://docs.anthropic.com/en/docs/claude-code/memory) | 常驻记忆只放跨会话稳定信息，多步骤流程和局部细节应拆出去 |
| 5 | [Devin DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki) | 页面应有明确 purpose，需要机器可读的 steering |
| 6 | [GitHub Copilot Custom Instructions](https://docs.github.com/en/copilot/concepts/prompting/response-customization) | 重叠或冲突指令会降低行为确定性，需要分层和作用域 |
| 7 | [Diataxis](https://diataxis.fr/) | 文档类型不应混写，reference/explanation/how-to 应有清晰边界 |
| 8 | [ContextBench](https://arxiv.org/abs/2602.05892) | 需同时评估 recall/precision/efficiency，区分 retrieved 与 used |
| 9 | [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) | 仓库级上下文文件可能增加复杂度，常驻入口应保持极短 |
| 10 | [Impact of AGENTS.md](https://arxiv.org/abs/2601.20404) | 入口文件价值来自稳定、短小、可执行，不是信息量大 |
| 11 | [Cursor Rules](https://docs.cursor.com/en/context) | 上下文规则需区分 Always/glob/Agent 请求/手动引用 |
| 12 | [Windsurf Memories](https://docs.windsurf.com/windsurf/cascade/memories) | 自动 memory 适合偏好，稳定知识应进入版本控制的文件 |
| 13 | [Aider Repo Map](https://aider.chat/docs/repomap.html) | 大仓库需要紧凑 repo map，代码地图不是业务知识对象 |
| 14 | [Sourcegraph Cody](https://sourcegraph.com/docs/cody/capabilities/agentic-chat) | Agent 可先主动收集上下文再反思是否足够，支持多轮补充 |
| 15 | [Knowledge Graph Code Generation](https://arxiv.org/abs/2505.14394) | 仓库级代码生成需要结构关系和跨文件依赖 |
| 16 | [DocPrompting](https://arxiv.org/abs/2207.05987) | 文档检索应围绕自然语言意图，不是简单全文加载 |
| 17 | [DocSync](https://arxiv.org/abs/2605.02163) | 文档会随代码漂移，stale_if 应绑定文件/符号/表/接口锚点 |
| 18 | [Codified Context](https://arxiv.org/abs/2602.20478) | 上下文按频率分为 hot memory / domain routing / cold knowledge |

## 未决问题

### 1. 首批能力从哪里抽取

尚未决定从哪个域开始、选哪些真实需求做首批评测、哪些能力最可能带来立刻可见的提升。

### 2. 评测自动化程度

尚未决定评测先人工标注还是半自动、with/without/stale 如何批量运行、如何记录对象级使用日志。

### 3. Freshness 触发方式

尚未决定仅靠人工复核，还是由文件 watch / git diff / CI 钩子触发。

### 4. views/组合页是否还有必要

当前设计中能力文档已经是完整的，包含所有知识段。views 层被移除。是否需要保留跨能力的场景导航页（如"订单域全景"），待实际使用后决定。

### 5. 共享对象的精确判定标准

当前标准：被多个能力引用 + 有独立过期周期 + 自身内容足够复杂。"多个"的精确定义（>= 2 还是 >= 3）、"足够复杂"的量化标准尚未确定。

### 6. catalog.yaml 的 term_match 匹配策略

尚未决定是精确匹配还是模糊匹配（如"退"是否匹配"退款"）、是否支持正则、是否需要优先级。

### 7. 增量更新策略

当前设计把知识包当作一次性生成物。尚未决定：过期后是整体重新生成还是局部修补、局部修补时关联能力文档是否需要联动更新、人工修改过的知识在重新生成时如何处理。

### 8. 首版验证策略

完整的评测体系（gold case + 三组实验 + 17 个指标）假设已经有了一批知识对象。首版知识包是否需要一个更轻量的验证方式，尚未确定。
