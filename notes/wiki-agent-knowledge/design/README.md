# bootstrap-knowledge 设计入口

本目录描述 `ai-wiki` 项目要生成什么样的 `bootstrap-knowledge/` 知识包，以及为什么要这样生成。

`ai-wiki` 不是普通文档生成器。它是一个独立 CLI，用于读取目标仓库的代码图谱、执行流、MyBatis/SQL、测试、配置和契约证据，再调用 LLM 生成可被 Agent 检索的知识内容，最终落盘为目标仓库的 `bootstrap-knowledge/`。

核心边界：

- 程序负责输入输出结构、对象 ID、对象路径、schema 校验、证据归一化和落盘。
- 内嵌解析与索引引擎负责提供结构化代码图谱、执行流和数据访问证据。
- LLM 只负责基于已提供证据生成知识内容，不能决定对象类型、对象 ID、对象路径或 catalog 结构。
- 没有证据但会影响决策的问题必须进入 `OPEN`，不能伪装成事实。

## 设计目标

`bootstrap-knowledge/` 的目标读者是 Claude Code 这类代码 Agent。

成功标准不是“文档看起来完整”，而是：

- Agent 能知道目标仓库有哪些业务能力、外部系统、边界、契约、代码落点和验证方式。
- Agent 接到新需求后，能先做业务语义理解、边界判断、source of truth 判断和未知升级，再输出改动计划。
- Agent 的关键判断都能引用知识对象 ID；没有对象支撑的判断应被视为推测。
- 过期、缺失或无证据的知识不会被当作稳定事实使用。

## 输出包心智模型

目标仓库中的 `bootstrap-knowledge/` 应按两层理解：

```text
bootstrap-knowledge/
├── catalog.yaml          # Agent 检索路由表
├── maps/                 # 紧凑代码地图和入口点索引
├── objects/              # 权威知识对象，一文件一对象
├── views/ 或 pages/      # 场景化组合页，只编排对象
├── evidence/             # 可追溯证据索引
├── reports/              # 生成结果与质量报告
└── debug/                # 调试材料，可选
```

其中最重要的原则是：

- `objects/` 是权威事实来源。
- `views/` 或 `pages/` 只负责把对象组织成 Agent 易读的任务视图，不新增权威事实。
- `catalog.yaml` 是 Agent 的读取路线图，不只是文件列表。
- `maps/` 帮助 Agent 在 token 预算内理解仓库结构、模块边界和入口点。
- `evidence/` 用来证明对象内容来自哪里。

上下文按访问频率分三层：

- `hot entry`
  - `AGENTS.md`、`CLAUDE.md` 或其他 Agent 入口，只放最小路由和硬门禁。
- `warm routing`
  - `catalog.yaml`，负责按术语、路径、系统、风险和未知门禁路由对象。
- `cold knowledge`
  - `objects/`、`views/`、`maps/`、`evidence/`、`reports/`，按任务需要读取。

## Agent 读取顺序

Claude Code 或其他 Agent 第一次理解本项目设计时，建议按以下顺序读取：

1. [discussion-context.md](./discussion-context.md)
   - 理解为什么要把 wiki 设计成 Agent 检索知识层，而不是普通文档库。
2. [document-architecture.md](./document-architecture.md)
   - 理解 `catalog.yaml`、对象文件、组合页和新需求读取协议。
3. [knowledge-object-model.md](./knowledge-object-model.md)
   - 理解 `TERM / CAP / SYS / OWN / CON / FLOW / MOD / VER / OPEN` 等对象类型。
5. [evaluation-and-validation.md](./evaluation-and-validation.md)
   - 理解如何判断一条知识是否值得保留，以及如何评测它是否真的帮助 Agent。
6. [references-and-open-questions.md](./references-and-open-questions.md)
   - 查看外部参考、当前未决问题和下一步落地方向。

## 当前实现对齐点

当前 CLI 的实现方向应和本目录设计保持一致：

- `generate` 命令面向目标仓库生成 `bootstrap-knowledge/`。
- DB/MyBatis 知识以表、字段、SQL、Mapper 证据为主要输入。
- capability 知识以业务能力为主线，生成 `CAP / TERM / FLOW / CON / MOD / VER / OPEN` 等对象。
- schema 校验必须位于外部边界，不能直接信任 LLM 输出。
- 打包层负责渲染 `catalog.yaml`、对象文件、组合页、报告和调试材料。

## 非目标

本设计不试图让知识包独立保证代码正确。

知识包解决的是 Agent 的理解问题：需求归因、术语解释、边界判断、代码落点和验证计划。编码规范、测试执行、CI、review 和提交流程仍由规则、工具链和人工评审负责。
