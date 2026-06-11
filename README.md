# RKG (Repo Knowledge Generator)

一个独立的 TypeScript/Node.js CLI 工具，用于给目标代码仓库生成 `bootstrap-knowledge/` 知识包。

`bootstrap-knowledge/` 的目标读者是 Claude Code 这类代码 Agent。它不是普通 wiki，也不是源码摘要，而是一个按需检索的业务与系统知识层，帮助 Agent 在接到新需求后完成：

- 业务术语理解
- 能力归因
- 外部系统与 source of truth 判断
- 契约、状态、失败语义识别
- 代码改动面定位
- 验证计划生成
- 未知问题升级

## 核心边界

本项目的职责是控制知识包的结构、证据、schema 和落盘。

- `src/engine/`、`src/query/`、`src/mybatis/` 负责提供结构化代码图谱、执行流、SQL 和表字段证据。
- `src/slicing/`、`src/evidence/`、`src/knowledge/` 负责发现生成范围、构建证据包并协调知识对象生成。
- `src/generation/` 负责调用 OpenAI-compatible LLM 生成对象内容。
- `src/packaging/` 负责渲染并写入 `bootstrap-knowledge/`。

LLM 只负责生成知识内容，不负责决定对象 ID、对象路径、对象类型或 `catalog.yaml` 结构。所有外部边界数据必须经过 schema 校验；没有证据但会影响决策的问题必须进入 `OPEN`，不能伪装成事实。

## 输出结构

生成结果默认写入目标仓库的 `bootstrap-knowledge/`：

```text
bootstrap-knowledge/
├── catalog.yaml          # Agent 检索路由表
├── maps/                 # 仓库结构、模块和入口点地图
├── objects/              # 权威知识对象
├── views/                # 面向任务的组合页
├── evidence/             # 证据索引
├── .internal/            # 内部元信息（隐藏目录）
│   └── reports/          # 生成报告
└── debug/                # 调试材料，可选
```

其中：

- `objects/` 是权威事实来源，一文件一对象。
- `views/` 只编排对象，不新增权威事实。
- `catalog.yaml` 告诉 Agent 该按什么顺序读取哪些对象。
- `maps/` 帮助 Agent 快速定位代码结构、模块边界和入口点。
- `evidence/` 和 `.internal/reports/` 用于追溯生成质量与失败原因。

## 设计文档

设计入口位于：

- [notes/wiki-agent-knowledge/design/README.md](./notes/wiki-agent-knowledge/design/README.md)

如果需要理解本项目为什么这样生成知识包，建议从该入口开始，再按顺序阅读对象模型、文档架构、模板和评测标准。

## 安装

```bash
npm install
npm run build
npm link  # 全局安装 rkg 命令
```

## 使用

```bash
# 先配置 llm.config.json，或设置 OPENAI_API_KEY 环境变量

# 在项目目录中直接运行（使用 cwd git root）
rkg generate

# 或指定路径
rkg generate <path>
rkg status <path>
rkg clean <path>

# 或使用 --repo 显式指定
rkg generate --repo <path>
rkg status --repo <path>
rkg clean --repo <path>
```

## 开发

```bash
npm run dev        # 开发模式运行
npm test           # 运行测试
npm run typecheck  # 类型检查
npm run build      # 构建
```

## LLM 配置

默认会读取项目根目录的 `llm.config.json`：

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

你可以使用两种方式提供 API key。

方式 1：直接写在 `llm.config.json`：

```json
{
  "model": "glm-5",
  "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
  "apiKey": "your-direct-api-key"
}
```

方式 2：在 `llm.config.json` 里配置环境变量名，再在环境变量里提供真实 key，例如 PowerShell：

```powershell
$env:OPENAI_API_KEY="your-key"
```

也可以用命令行覆盖文件配置：

```bash
rkg generate --llm-config ./llm.config.json
rkg generate --model gpt-4o --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
```
