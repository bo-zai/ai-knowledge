# ai-wiki 设计文档

本目录定义 `ai-wiki` 项目要生成什么样的 `ai-knowledge/` 知识库，以及为什么这样设计。

## 阅读顺序

1. [01-goals-and-principles.md](./01-goals-and-principles.md) — 为什么建这个知识系统，解决什么问题，不解决什么
2. [02-knowledge-type-spec.md](./02-knowledge-type-spec.md) — 8 类知识的具体规格：定义、条目结构、提取方式和产物示例
3. [03-knowledge-directory-structure.md](./03-knowledge-directory-structure.md) — 知识库的目录结构、索引体系和文件引用机制
4. [04-generation-flow-design.md](./04-generation-flow-design.md) — 生成流程的完整管线：仓库扫描、AST 构建、分组策略、LLM 调用、校验和增量更新
5. [05-system-architecture.md](./05-system-architecture.md) — 系统架构决策：管线编排模式、LLM 交互格式、大上下文处理策略和实现挑战

## 设计核心

`ai-wiki` 是一个独立 CLI，读取目标仓库中的可见材料（代码、配置、注释、测试、脚本和已有文档），调用 LLM 生成知识内容，最终落盘为目标仓库的 `ai-knowledge/`。

知识包的目标读者是 AI Agent，不是人。
