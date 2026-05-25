# Database Slice Startup Recovery Design

## Goal

修复当前 CLI 在执行数据库单表生成时的启动期崩溃问题，使下面三条真实命令能够稳定启动并完成：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

## Problem Summary

当前 `typecheck` 和 `build` 可以通过，表级自测脚本也通过：

- `npx tsx scripts/selftest-music-admin-db-tables.mts`

但真实 CLI 入口仍然在启动期失败，错误为：

```text
Error: Cannot find module 'D:\workspace\vendor\leiden\index.cjs'
```

触发链路是：

1. `src/cli/generate.ts`
2. 顶层 import `src/query/index-service.ts`
3. `index-service.ts` 顶层 import `runFullAnalysis`
4. `runFullAnalysis` 继续拉起完整 ingestion pipeline
5. pipeline 导入 `communities.ts`
6. `communities.ts` 导入 `community-processor.ts`
7. `community-processor.ts` 在模块加载阶段通过硬编码路径 require `vendor/leiden/index.cjs`

这意味着：

- 即使当前命令是 `--slice database:...`
- 即使数据库单表生成理论上不应走 community detection
- 只要 CLI 入口启动，就已经把完整分析管线和 Leiden 依赖拉进来了

## Root Cause

根因不是 DB 生成逻辑错误，而是**模块加载边界不合理**：

- database-only 路径没有真正做到懒加载
- index/discovery 层在顶层 import 了完整 analyze runtime
- community detection 的 vendored 依赖在加载期就是强依赖，而不是运行到相关 phase 时才需要

## Non-Goals

- 不重写社区发现算法
- 不改 DB evidence bundle 结构
- 不改 LLM prompt
- 不在本次彻底删除 community 功能
- 不在本次处理全部测试体系问题以外的无关问题

## Required End State

### 1. Database-only generation must not require Leiden at startup

当命令满足：

- `generate`
- `--slice database:<table>`

则 CLI 启动和运行 DB 生成主链时，不应因 community detection 或 Leiden 缺失而失败。

这意味着：

- database-only 路径不应在启动阶段 import 完整 analyze pipeline
- 不应在未执行 community phase 时就 require `vendor/leiden/index.cjs`

### 2. `index-service.ts` must stop eager-loading full analysis runtime

当前 `src/query/index-service.ts` 顶层 import：

- `runFullAnalysis`

这会导致只要 import index service，就把完整 analyze runtime 拉起来。

要求：

- 改成懒加载
- 或将 `ensureIndex/runAnalysis` 分离到更小的模块边界

最低要求是：

- `database-only` 路径在不需要 analyze 时，不会触发 `runFullAnalysis` 相关模块加载

### 3. Community processor dependency must not be a startup hard requirement

当前 `src/engine/ingestion/community-processor.ts` 的 Leiden require 是硬编码强依赖。

本次至少需要满足以下之一：

#### Option A: Lazy import

只有真正执行 community phase 时才加载 Leiden。

#### Option B: Optional capability guard

若 Leiden 不存在：

- 对非社区路径不报错
- 对需要社区功能的路径才报可解释错误

本次推荐优先采用 A。

### 4. Database-only generation path should be explicitly isolated

`generate.ts` 已经有 `isDatabaseOnly` 判定，但还不够。

要求：

- database-only 路径从 CLI 入口到 DB bundle/LLM 调用之间，不应经过完整 discover/analyze 依赖链
- 相关 helper 应拆成更小边界，避免顶层 import 污染

### 5. Built CLI tests must align with real artifact path

当前集成测试还出现一类错误：

```text
Cannot find module 'D:\workspace\ai-wiki\dist\cli\index.js'
```

这说明测试体系对构建产物路径和时机的假设不稳定。

本次需要顺手收敛：

- 集成测试应与当前 `tsup` ESM 输出一致
- 测试若依赖 dist，必须确保预构建或改为直接运行源码入口

本次不要求重构整套测试，只要求把当前验证 database-only 路径的相关测试修到稳定。

## Suggested Refactoring Direction

### A. Split runtime loading boundaries

建议把下面两类能力拆开：

- `index existence / metadata`
- `full analysis execution`

也就是说，`hasIndex()` 不应依赖任何完整 analyze runtime 相关 import。

### B. Lazy-load `runFullAnalysis`

在真正需要 analyze 时再动态 import：

- `../engine/analyze/run-analyze.js`

而不是在模块顶层 import。

### C. Lazy-load or guard community phase dependencies

建议把 `community-processor` 的 Leiden require 迁到：

- `processCommunities()` 内部
- 或 phase 执行入口内部

避免只要 import 文件就触发 require。

### D. Keep database-only path narrow

理想路径：

```text
generate.ts
  -> parse slice filter
  -> detect database-only mode
  -> buildDbBundlesForGeneration(...)
  -> build DB evidence
  -> LLM generation
```

而不是：

```text
generate.ts
  -> index-service import
  -> runFullAnalysis import
  -> full ingestion pipeline import
  -> community processor import
```

## Validation

完成后必须验证：

### Code checks

- `npm run typecheck`
- `npm run build`

### Targeted tests

- 修复并通过与 CLI 入口相关的集成测试
- 至少保证 database-only 相关路径有稳定测试覆盖

### Real commands

必须实际运行并成功：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

### Expected outcome

- 三条命令都不再因为 `vendor/leiden` 缺失而崩溃
- 至少能成功进入并完成 DB 对象生成链

## Acceptance

本次修复完成的标准：

1. database-only 单表生成不再依赖 Leiden 启动成功
2. `index-service` 不再通过顶层 import 把完整 analyze runtime 拉进 database-only 路径
3. CLI 相关测试不再因 dist 入口或 Leiden 缺失而普遍失效
4. 三张真实表的单表生成能实际跑通
