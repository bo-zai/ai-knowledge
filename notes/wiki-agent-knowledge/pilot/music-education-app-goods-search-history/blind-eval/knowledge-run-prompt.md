# Knowledge-Augmented Blind Run Prompt

你正在做一次“有知识增强”的需求理解与改动规划演练。

## 你可以使用的输入

- 当前需求文件
- 代码仓库：
  - `D:\\workspace\\other_project\\music-education-app`
  - `D:\\workspace\\other_project\\music-education-core`
- 知识目录：
  - `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\final-knowledge\\music-education-app-goods-search-history`

## 你不能使用的输入

- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\design`
- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\discovery`
- `D:\\workspace\\ai-wiki\\notes\\wiki-agent-knowledge\\pilot` 下除当前需求文件外的其它材料

## 任务

阅读需求、仓库代码和允许的知识对象后，输出一份结构化的 change plan。

要求：

1. 不要猜测未确认的行为。
2. 优先引用知识对象 ID 来支撑关键判断。
3. 如果知识不足以闭合判断，必须显式列入 `unknowns`，不能假装已有答案。
4. 不要输出实现代码，只输出理解、边界、改动面和验证计划。
5. 输出格式必须符合 `output-schema.yaml`。

## 额外要求

- `knowledge_refs` 必须填写你实际使用到的对象 ID。
- 如果需求打到了当前知识覆盖边界，也要明确指出“知识已知什么、还不知道什么”。
