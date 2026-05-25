# database slice 先构建图数据实现计划

## 目标

让 `generate --slice database:<table>` 和普通 `generate` 一样，先确保目标仓库图数据已建立，再执行 DB 知识生成。

## 实施范围

只修：

- `database-only slice` 当前跳过 `ensureIndex(...)` 的逻辑

不改：

- DB 对象 schema
- prompt
- 日志文件格式
- companion repo 处理策略

## Task 1: 收紧 generate 前置条件

修改 `src/cli/generate.ts`：

- 删除或停用：
  - `isDatabaseOnly` 跳过索引的特殊分支
- 统一成：
  - `if (!mockMode) await ensureIndex(...)`

要求：

- 所有 slice 类型都走同一套索引前置条件

## Task 2: 清理辅助分支判断

检查并清理与“database-only 跳过索引”配套的分支逻辑，例如：

- 注释
- 条件变量命名
- 与该假设耦合的 helper

只做必要清理，不做额外重构。

## Task 3: 保证已有索引复用不回退

确认 `ensureIndex(...)` 的行为仍然是：

- 有索引时复用
- 无索引时自动建
- `--force-analyze` 时重建

本次不重新设计索引策略，只验证不回退。

## Task 4: 最小验证

优先做真实命令验证，不要求补很多测试代码。

至少验证：

1. 对目标仓库单表执行：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
```

观察日志中先发生索引检查/构建，再进入生成。

2. 再次执行同样命令：

- 应复用现有索引，不重复重建

3. 执行：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --force-analyze --llm-config llm.config.json
```

- 应触发重建

## Task 5: 完成前验收

至少运行：

```powershell
npm run typecheck
npm run build
npm test
```

并补一轮真实手工命令验证，确认：

- database slice 不再绕过图数据构建
- 单表知识仍能成功落盘
