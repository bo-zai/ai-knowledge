# Baseline Blind Run Prompt

你正在做一次“无知识增强”的需求理解与改动规划演练。

## 你可以使用的输入

- 当前需求文件
- 代码仓库：
  - `D:\\workspace\\other_project\\music-education-app`
  - `D:\\workspace\\other_project\\music-education-core`

## 你不能使用的输入

- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\design`
- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\discovery`
- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\final-knowledge`
- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\pilot` 下除当前需求文件外的其它材料

## 任务

阅读需求和仓库代码后，输出一份结构化的 change plan。

要求：

1. 不要猜测未确认的行为。
2. 如果需求依赖调用方、前端或外部输入语义，请明确指出。
3. 不要输出实现代码，只输出理解、边界、改动面和验证计划。
4. 输出格式必须符合 `output-schema.yaml`。

## 额外要求

- 如果你不确定“主动搜索”和“普通浏览”在当前请求里如何区分，必须把它列为 `unknowns`。
- 如果你认为有一部分不在当前后端仓库边界内，也必须显式写出。
