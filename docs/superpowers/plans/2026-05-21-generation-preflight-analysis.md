# 知识生成命令统一前置图数据检查实现计划

## 目标

把“是否已生成图数据”的检查，从当前零散的局部分支，提升为知识生成命令的统一 preflight 阶段。

## 实施范围

本次只做：

- `generate` 命令前置图数据检查收口

不做：

- DB schema 变更
- prompt 变更
- 知识包格式变更

## Task 1: 提取统一 preflight 能力

新增一个统一的“知识生成前检查”函数，例如：

- `ensureAnalysisReady(...)`
- 或 `prepareKnowledgeGeneration(...)`

输入至少包括：

- `repoPath`
- `forceAnalyze`
- `mockMode`

输出至少包括：

- `analysisState`
  - `reused`
  - `created`
  - `rebuilt`
  - `skipped_for_mock`

## Task 2: 从 generate 主流程移除 slice 级建图判断

修改 `src/cli/generate.ts`：

- 不再根据 `database-only` 或其它 slice 类型决定是否执行 `ensureIndex(...)`
- 改为：
  - 在进入生成主逻辑前统一调用 preflight

要求：

- slice 只负责收窄生成范围
- 不再决定是否先建图

## Task 3: 保持已有索引复用逻辑

确保 preflight 仍符合现有索引策略：

- 无索引：创建
- 有索引：复用
- `--force-analyze`：重建
- `mockMode`：跳过

## Task 4: 日志补强

使用现有 logger 输出 preflight 结果，例如：

- checking analysis state
- reusing existing index
- creating index
- rebuilding index because forceAnalyze=true

不要求新增复杂日志结构。

## Task 5: 最小验证

优先做真实命令验证，不要求补很多测试代码。

至少验证：

1. 无索引时的单表生成
2. 已有索引时的单表生成
3. 全量生成
4. `--force-analyze`

真实验证对象优先：

- `D:\workspace\other_project\music-education-admin`
- `D:\workspace\other_project\music-education-app`

## Task 6: 完成前验收

至少运行：

```powershell
npm run typecheck
npm run build
npm test
```

并给出至少一条真实命令证明：

- 命令启动后先发生图数据检查
- 然后才进入知识生成
