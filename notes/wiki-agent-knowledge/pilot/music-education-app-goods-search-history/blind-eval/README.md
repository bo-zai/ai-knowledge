# Blind Eval Package

## 目的

这套文件用于做真正的“低污染验证”：

- 不让执行 Agent 看到本次讨论过程
- 只给它最少必需输入
- 对比“无知识”和“有知识”两种模式的输出差异

## 重要约束

在当前会话里，主执行 Agent 已经知道这批对象和结论，不能把当前会话输出当成盲测结果。

真正的盲测应在 **全新会话** 或 **不继承当前上下文的新 agent** 中运行。

## 两种模式

### 1. baseline

- 允许输入：
  - 需求文件
  - `music-education-app` 与 `music-education-core` 仓库代码
- 禁止输入：
  - `notes/wiki-agent-knowledge/final-knowledge/`
  - `notes/wiki-agent-knowledge/discovery/`
  - `notes/wiki-agent-knowledge/pilot/` 中除需求文件外的任何材料

### 2. knowledge

- 允许输入：
  - 需求文件
  - `music-education-app` 与 `music-education-core` 仓库代码
  - `final-knowledge/music-education-app-goods-search-history/`
- 禁止输入：
  - `design/`
  - `discovery/`
  - `pilot/` 中的 gold、claim candidates、scoring 等文件

## 如何判断知识是否真的有用

如果 `knowledge` 相比 `baseline` 有这些提升，就说明知识对象有效：

- 更准确地区分主动搜索与普通浏览
- 更准确地识别后端边界和前端/调用方依赖
- 更准确地定位改动面
- 更少地凭空假设
- 更完整地给出验证计划

如果两种模式输出差不多，说明：

- 这批知识可能没有改变决策
- 或者知识没被检索到
- 或者需求还没有打到知识真正擅长的决策点
