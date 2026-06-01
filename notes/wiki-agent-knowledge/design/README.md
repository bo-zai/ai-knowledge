# bootstrap-knowledge 设计文档

本目录定义 `ai-wiki` 项目要生成什么样的 `bootstrap-knowledge/` 知识包，以及为什么这样设计。

## 阅读顺序

1. [01-goals-and-principles.md](./01-goals-and-principles.md) — 为什么建这个知识系统，解决什么问题，不解决什么
2. [02-knowledge-model.md](./02-knowledge-model.md) — 知识模型：能力文档是主单位，知识段按需包含
3. [03-document-architecture.md](./03-document-architecture.md) — 目录结构、catalog.yaml 路由协议、入口分层
4. [04-capability-design.md](./04-capability-design.md) — 业务能力发现、粒度、评分、合并与拆分
5. [05-agent-protocol.md](./05-agent-protocol.md) — Agent 执行协议与输出结构
6. [06-evaluation.md](./06-evaluation.md) — 评测体系：指标、实验方法、保留与删除标准
7. [references.md](./references.md) — 外部参考资料与未决问题

## 设计核心

`ai-wiki` 是一个独立 CLI，读取目标仓库的代码图谱、执行流、MyBatis/SQL、测试、配置和契约证据，调用 LLM 生成知识内容，最终落盘为目标仓库的 `bootstrap-knowledge/`。

知识包的目标读者是 AI Agent，不是人。

核心边界：

- 程序负责输入输出结构、对象 ID、schema 校验、证据归一化和落盘
- 内嵌解析与索引引擎负责提供结构化代码图谱、执行流和数据访问证据
- LLM 只负责基于已提供证据生成知识内容，不能决定结构
- 没有证据但会影响决策的问题必须进入"已知未知"，不能伪装成事实

## 已废弃文档

以下旧文档已被上述新文档替代，保留仅供历史参考：

- `discussion-context.md` → 核心结论已迁入 `01-goals-and-principles.md`
- `document-architecture.md` → 已拆分为 `03-document-architecture.md`、`04-capability-design.md`、`05-agent-protocol.md`
- `knowledge-object-model.md` → 已重构为 `02-knowledge-model.md`
- `evaluation-and-validation.md` → 已迁入 `06-evaluation.md`
- `references-and-open-questions.md` → 已迁入 `references.md`
