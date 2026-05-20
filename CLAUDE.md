# CLAUDE.md

实现本项目时，先阅读：

1. `AGENTS.md`
2. `CONTRIBUTING_zh.md`

最低约束：

- 程序控制结构，模型只填内容
- 所有外部边界都先做 schema 校验
- 输出知识包必须稳定、可重建
- `DB` 字段必须带中文描述与来源标记
- `OPEN` 是一等输出，不能静默省略