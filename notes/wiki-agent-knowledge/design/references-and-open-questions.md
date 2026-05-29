# 参考资料与未决问题

## 外部参考

### 1. Harness Engineering 文章

- 来源：https://developer.aliyun.com/article/1734483
- 本轮讨论吸收的关键点：
  - `wiki` 是业务上下文层，不是规则层
  - `wiki` 应按需加载，而不是常驻上下文
  - 应通过 Owner / Index 管理读取路径

### 2. OpenAI: Harness Engineering

- 来源：https://openai.com/index/harness-engineering/
- 本轮吸收的关键点：
  - 仅靠文档无法保持代码库一致性
  - 需要把知识、流程、验证和反馈回路一起考虑

### 3. Anthropic: Effective Context Engineering for AI Agents

- 来源：https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- 本轮吸收的关键点：
  - 关键不是堆上下文，而是让 Agent 在正确时机拿到正确上下文

### 4. Anthropic: Claude Code Memory

- 来源：https://docs.anthropic.com/en/docs/claude-code/memory
- 本轮吸收的关键点：
  - 常驻记忆只放跨会话稳定信息
  - 多步骤流程和局部细节应拆出去

### 5. Devin DeepWiki

- 来源：https://docs.devin.ai/work-with-devin/deepwiki
- 本轮吸收的关键点：
  - 页面应带有明确 `purpose`
  - 需要机器可读的 steering / repo notes

### 6. GitHub Copilot Custom Instructions

- 来源：https://docs.github.com/en/copilot/concepts/prompting/response-customization?tool=jetbrains
- 本轮吸收的关键点：
  - 重叠或冲突指令会降低行为确定性
  - 需要明确分层和局部作用域

### 7. Diataxis

- 来源：https://diataxis.fr/
- 本轮吸收的关键点：
  - 文档类型不应混写
  - `reference`、`explanation`、`how-to` 应有清晰边界

## 当前未决问题

### 1. 首批对象从哪里抽取

虽然对象模型已经成型，但尚未决定：

- 从当前仓库的哪个域开始
- 选哪些真实需求做首批评测
- 哪些对象最可能带来立刻可见的提升

### 2. 对象文件是否需要机器可解析 frontmatter 规范

目前已经定义了对象字段，但还没定：

- 是否统一用 YAML frontmatter
- 正文中的 claim 是否也要结构化到可自动提取
- `catalog.yaml` 与对象 frontmatter 的职责边界

### 3. 评测自动化程度

尚未决定：

- 评测先人工标注还是半自动
- `with / without / stale` 如何批量运行
- 如何记录对象级使用日志

### 4. Freshness 触发方式

尚未决定：

- 仅靠人工复核
- 还是由文件 watch / git diff / CI 钩子触发

### 5. 组合页是否允许极少量解释性摘要

当前原则是“组合页不新增事实”，但尚未最终确定：

- 是否允许为 Agent 提供少量摘要性导航文字
- 这些文字是否也需要绑定对象 ID

## 建议的下一步

1. 从当前仓库选择一个高频、跨系统、边界复杂的能力域
2. 基于该域构建 3 个真实 `gold cases`
3. 为该域创建首批对象：
   - `TERM`
   - `SYS`
   - `OWN`
   - `CON`
   - `MOD`
   - `VER`
4. 建立首版 `catalog.yaml`
5. 用真实需求跑一次 `requirement -> change plan` 评测
6. 删除或重写没有显著作用的对象

## 关于“保存思考过程”的说明

本目录保存的是：

- 讨论中形成的显式结论
- 设计 rationale
- 关键判断标准
- 后续可复用的模板与协议

没有保存逐步推理的原始脑内草稿，而是保存了后续继续设计和落地最有价值的结构化沉淀。
