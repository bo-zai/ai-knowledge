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

### 8. ContextBench: A Benchmark for Context Retrieval in Coding Agents

- 来源：https://arxiv.org/abs/2602.05892
- 本轮吸收的关键点：
  - 只评估最终任务是否成功不够，还需要评估 Agent 在过程中检索了什么上下文
  - 上下文检索应同时看 `recall`、`precision` 和 `efficiency`
  - Agent 可能检索到正确上下文但没有真正用于最终判断，因此需要区分 `retrieved` 与 `used`

### 9. Evaluating AGENTS.md

- 来源：https://arxiv.org/abs/2602.11988
- 本轮吸收的关键点：
  - 仓库级上下文文件可能增加任务复杂度和推理成本
  - `AGENTS.md` 不应承载百科式知识
  - 常驻入口应保持极短，只负责路由、边界和硬门禁

### 10. On the Impact of AGENTS.md Files

- 来源：https://arxiv.org/abs/2601.20404
- 本轮吸收的关键点：
  - 仓库级指令文件可能改善运行效率，但效果依赖文件质量和作用范围
  - 入口文件的价值来自稳定、短小、可执行，而不是信息量大
  - 对 Agent 生效的上下文应按加载频率和任务相关性分层

### 11. Cursor Rules

- 来源：https://docs.cursor.com/en/context
- 本轮吸收的关键点：
  - 上下文规则需要区分 `Always`、按 glob 自动附加、Agent 自主请求和手动引用
  - 规则应有清晰描述和作用范围，避免所有内容常驻
  - `catalog.yaml` 可以借鉴触发模式来表达对象何时加载

### 12. Windsurf Memories and Rules

- 来源：https://docs.windsurf.com/windsurf/cascade/memories
- 本轮吸收的关键点：
  - 自动 memory 适合个人偏好和重复事实，稳定项目知识应进入版本控制的规则或知识文件
  - Agent 上下文需要区分临时记忆、项目规则和可复核知识
  - `bootstrap-knowledge/` 应作为 cold knowledge，入口文件只做 hot routing

### 13. Aider Repo Map

- 来源：https://aider.chat/docs/repomap.html
- 本轮吸收的关键点：
  - 大仓库需要紧凑的 repo map，让 Agent 在 token 预算内理解文件、类、函数和关系
  - 代码地图不是业务知识对象，但能帮助 Agent 把业务对象落到代码位置
  - `MOD` 对象之外应考虑生成轻量的 `maps/` 层

### 14. Sourcegraph Cody Agentic Context Fetching

- 来源：https://sourcegraph.com/docs/cody/capabilities/agentic-chat
- 本轮吸收的关键点：
  - Agent 可先主动收集上下文，再反思上下文是否足够
  - 上下文获取应支持多轮补充，而不是一次性塞满
  - `catalog.yaml` 应支持 Agent 按任务逐步扩展读取范围

### 15. Knowledge Graph Based Repository-Level Code Generation

- 来源：https://arxiv.org/abs/2505.14394
- 本轮吸收的关键点：
  - 仓库级代码生成需要结构关系和跨文件依赖，不应只依赖文本相似度
  - 知识图谱能提高上下文相关性和代码一致性
  - 本项目的 `engine/` 图谱证据应进入知识包的可追溯来源，而不只是生成时的中间数据

### 16. DocPrompting

- 来源：https://arxiv.org/abs/2207.05987
- 本轮吸收的关键点：
  - 可更新外部文档能弥补模型训练知识过期问题
  - 文档检索应围绕自然语言意图，而不是简单全文加载
  - `bootstrap-knowledge/` 应服务从需求意图到知识对象的检索

### 17. DocSync

- 来源：https://arxiv.org/abs/2605.02163
- 本轮吸收的关键点：
  - 文档会随代码演化漂移，维护流程需要结构化代码证据和一致性检查
  - AST / 结构化上下文能帮助判断文档是否仍与代码一致
  - `stale_if` 不应停留在自然语言，应尽量绑定文件、符号、表、接口或测试锚点

### 18. Codified Context

- 来源：https://arxiv.org/abs/2602.20478
- 本轮吸收的关键点：
  - Agent 上下文可按访问频率拆成 hot memory、domain routing 和 cold knowledge
  - 常驻上下文放约定、路由和编排协议，稳定知识按需读取
  - `bootstrap-knowledge/` 应明确自己是 cold knowledge，`catalog.yaml` 是 warm routing

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

### 6. 入口文件如何与 Agent 工具集成

需要决定：

- 是否生成 `bootstrap-knowledge/README.md` 或 `AGENT-ENTRY.md`
- 是否建议目标仓库的 `AGENTS.md` / `CLAUDE.md` 只引用 `bootstrap-knowledge/catalog.yaml`
- 常驻入口允许包含哪些硬约束
- 常驻入口与 `catalog.yaml`、对象文件冲突时如何处理

### 7. catalog.yaml 如何表达触发模式

需要决定：

- 是否支持 `always`、`term_match`、`path_match`、`system_match`、`manual` 等触发模式
- 是否为对象声明加载优先级、风险等级和 token 预算
- 是否记录对象依赖，使 Agent 能按层逐步读取
- 是否把 `OPEN` gate 作为计划前置门禁

### 8. 是否生成代码地图层

需要决定：

- 是否新增 `maps/` 目录
- `repo-map.md`、`module-map.yaml`、`entrypoints.yaml` 分别承担什么职责
- `maps/` 与 `MOD` 对象如何避免重复
- maps 是否由图谱引擎直接生成，还是由 packaging 阶段渲染

### 9. 如何评估上下文检索过程

需要决定：

- 是否记录 Agent 读取了哪些对象
- 是否区分 `retrieved_objects` 与 `used_objects`
- 是否引入 `context_recall`、`context_precision`、`context_efficiency`
- 是否把“读了很多但没用上”作为质量扣分项

### 10. 可信度与风险等级如何进入对象模型

需要决定：

- 对象是否必须声明 `confidence`
- 错误使用对象的风险是否分为 `low / medium / high / critical`
- 中低可信对象是否只能用于提示和提问，不能直接支撑改动计划
- 外部系统、权限、支付、数据一致性对象是否默认更高风险

## 建议的下一步

1. 先确定 `catalog.yaml` 的路由协议和入口文件边界
2. 从当前仓库选择一个高频、跨系统、边界复杂的能力域
3. 基于该域构建 3 个真实 `gold cases`
4. 为该域创建首批对象：
   - `TERM`
   - `SYS`
   - `OWN`
   - `CON`
   - `MOD`
   - `VER`
5. 建立带触发模式、依赖、风险等级和 `OPEN` gate 的 `catalog.yaml`
6. 建立首版 `maps/` 层，验证它是否提升代码定位
7. 用真实需求跑一次 `requirement -> change plan` 评测
8. 同时记录最终计划质量和上下文检索质量
9. 删除或重写没有显著作用的对象

## 关于“保存思考过程”的说明

本目录保存的是：

- 讨论中形成的显式结论
- 设计 rationale
- 关键判断标准
- 后续可复用的模板与协议

没有保存逐步推理的原始脑内草稿，而是保存了后续继续设计和落地最有价值的结构化沉淀。
