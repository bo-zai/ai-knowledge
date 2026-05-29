# Agent Wiki 文档分层

这个目录现在按三类内容理解，不要再混着看：

## 1. 最终知识文档

目录：

- [final-knowledge/README.md](./final-knowledge/README.md)

定义：

- 这是未来真正要喂给 Agent 的稳定知识层
- 只允许放 `对象化、可验证、可引用` 的知识文件
- 例如：`TERM / OWN / CON / MOD / VER / OPEN` 对象

当前状态：

- 已经有第一批正式的最终知识对象，位于 `final-knowledge/music-education-app-goods-search-history/`
- 这批对象围绕 `music-education-app` 的 `商品列表查询 + 搜索历史写入` 能力，作为首个完整 MVP

## 2. 方案设计文档

目录：

- [design/discussion-context.md](./design/discussion-context.md)
- [design/knowledge-object-model.md](./design/knowledge-object-model.md)
- [design/document-architecture.md](./design/document-architecture.md)
- [design/evaluation-and-validation.md](./design/evaluation-and-validation.md)
- [design/examples-and-templates.md](./design/examples-and-templates.md)
- [design/references-and-open-questions.md](./design/references-and-open-questions.md)
- [operational-kit/README.md](./operational-kit/README.md)

定义：

- 这些是我们的方法论、对象模型、评测方法、模板和实施方案
- 它们是“怎么建设知识系统”的文档
- **不是最终知识本身**

使用规则：

- 可以作为团队设计依据
- 不应直接混入 Agent 的事实知识层

## 3. 调研与试点中间产物

目录：

- [discovery/mall-repo-assessment.md](./discovery/mall-repo-assessment.md)
- [discovery/mall-req001-evidence-notes.md](./discovery/mall-req001-evidence-notes.md)
- [discovery/music-education-repo-assessment.md](./discovery/music-education-repo-assessment.md)
- [discovery/music-education-app-goods-search-history-evidence-notes.md](./discovery/music-education-app-goods-search-history-evidence-notes.md)
- [pilot/mall-swarm-req001/README.md](./pilot/mall-swarm-req001/README.md)
- [pilot/music-education-app-goods-search-history/README.md](./pilot/music-education-app-goods-search-history/README.md)

定义：

- 这些是围绕真实仓库做的取证、评估、gold case、claim candidates
- 它们是“知识沉淀前的工作材料”
- **也不是最终知识**

使用规则：

- 只能作为取证、建模、评测输入
- 不能直接当作稳定知识对象喂给 Agent

## 当前最重要的判断

现在目录里真正应该区分清楚的是：

1. `final-knowledge/`
   - 未来给 Agent 用的稳定知识
2. `design/` 和 `operational-kit/`
   - 我们的方案设计和实施方法
3. `discovery/` 和 `pilot/`
   - 真实项目试点过程中的中间材料

如果后续继续落地，原则是：

- 一手证据先进入 `discovery/`
- 评测与候选对象先进入 `pilot/`
- 只有通过验证的对象，才进入 `final-knowledge/`
