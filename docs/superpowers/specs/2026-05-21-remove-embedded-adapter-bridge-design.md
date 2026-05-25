# Remove Embedded Adapter Bridge Design

## Goal

移除当前 `src/knowledge/embedded-adapter.ts` 这层过渡桥接，使主生成链直接依赖项目内部的结构化分析与查询 API，而不是继续模拟一层 “GitNexus 风格命令执行器”。

本次改动的目标不是新增功能，而是让当前架构真正收敛到：

- `engine/**` 提供分析与索引能力
- `query/**` 提供结构化查询能力
- `mybatis/**` 提供数据库证据能力
- `cli/**` 直接调用这些结构化模块

## Why This Matters

当前 `embedded-adapter.ts` 的问题不是“能不能工作”，而是它已经不再适合作为长期边界：

1. **命名污染**
   - 仍然暴露 `EmbeddedGitNexusExecutor`、`runEmbeddedList` 这类名称
   - 会误导后续开发者以为运行时仍然是 GitNexus CLI 兼容模式

2. **接口退化**
   - 桥接层把结构化能力重新包成：
     - `args: string[]`
     - `stdout: string`
   - 上层只能继续走“命令 + 文本输出”的旧思路

3. **阻碍进一步精确化**
   - DB knowledge、slice discovery、evidence bundle 本应消费 typed data
   - 现在仍有一部分逻辑在围绕“list/query 返回的文本”做适配

## Non-Goals

- 不改知识包格式
- 不改 LLM prompt contract
- 不新增 DB 解析能力
- 不改 vendored `engine/**` 内核算法
- 不对外暴露新服务端接口

## Current Architecture Problem

当前主链仍然存在这一层：

```text
generate.ts
  -> createEmbeddedGitNexusExecutor()
  -> ['analyze' | 'list' | 'query' | 'status']
  -> EmbeddedGitNexusResult.stdout
  -> 再进入 slice/evidence 逻辑
```

而理想架构应是：

```text
generate.ts
  -> ensureAnalysis(...)
  -> discoverSlices(...)
  -> buildDbBundles(...)
  -> buildEvidence(...)
  -> generate objects
```

也就是说，CLI 不应再通过一个“伪命令执行器”访问内部能力。

## Required End State

### 1. 删除桥接式执行器接口

以下接口应从主路径中消失：

- `EmbeddedGitNexusExecutor`
- `createEmbeddedGitNexusExecutor()`
- `EmbeddedGitNexusResult.stdout`
- 任何 `args: string[] -> stdout: string` 风格的内部调用

### 2. `generate.ts` 直接依赖结构化 API

`generate.ts` 不应再通过：

- `execEmbedded(['analyze', ...])`
- `execEmbedded(['list', ...])`
- `execEmbedded(['query', ...])`

来驱动流程。

它应改为直接调用：

- `ensureEmbeddedIndex(repoPath)` 或更中立的新入口
- 结构化 slice discovery
- `buildAllDbTableBundles(repoPath)`
- `buildDbTableBundle(repoPath, tableName)`
- `query/**` 中的 typed 查询接口

### 3. `list/query/status` 命令模拟语义从运行时边界移除

桥接层里当前提供：

- `runEmbeddedAnalyze`
- `runEmbeddedQuery`
- `runEmbeddedList`
- `checkEmbeddedIndex`
- `ensureEmbeddedIndex`

其中：

- `checkEmbeddedIndex`
- `ensureEmbeddedIndex`
  - 可保留，但需要迁移到更合适的模块边界，例如 `query/index-service.ts` 或 `engine/index.ts`
- `runEmbeddedList`
- `runEmbeddedQuery`
- `createEmbeddedGitNexusExecutor`
  - 不应再作为主运行时边界存在

### 4. slice discovery 去文本化

当前 slice discovery 仍保留“list -> output -> parse”思路。

应改为：

- 直接消费结构化 discovery 结果
- 不再依赖 `stdout`
- 不再依赖“命令名 + 参数”风格

如果短期还没有完整 typed discovery service，则本次必须至少把：

- “伪 executor”
- “stdout 协议”

从 `generate.ts` 中移除，把结构化发现逻辑下沉到专门模块。

### 5. `embedded-adapter.ts` 的命运

本次需要在 spec 中明确：

- **理想状态：删除该文件**
- 若由于 `status` 或其他小量命令仍需保留部分能力，则应把它拆成中立模块，而不是保留当前整块桥接层

允许的过渡形式：

- 将 `checkEmbeddedIndex` / `ensureEmbeddedIndex` 迁到 `src/query/index-service.ts`
- 将纯查询 helper 迁到 `src/query/**`
- 删除整个 `src/knowledge/embedded-adapter.ts`

不允许的结果：

- 只是改名字，但保留 `executor + args + stdout` 这套桥接模式

## Suggested Refactoring Direction

### A. Index Boundary

建立中立索引入口，例如：

- `src/query/index-service.ts`
- 或 `src/engine/index.ts`

职责：

- `hasIndex(repoPath)`
- `ensureIndex(repoPath, options?)`
- `loadIndexMeta(repoPath)`

### B. Discovery Boundary

建立中立 discovery 入口，例如：

- `src/query/discovery-service.ts`

职责：

- 返回 routes / processes / tools / communities / tables 的结构化结果

### C. Query Boundary

查询服务只暴露 typed 方法，不再暴露伪 CLI：

- `findDbTables`
- `getDbTableContext`
- `runCypherQuery`
- 其它必要 typed query

### D. CLI Boundary

CLI 只做：

- 参数解析
- 调用结构化服务
- 组装 orchestration

不再携带命令模拟层。

## File-Level Scope

至少涉及：

- `src/cli/generate.ts`
- `src/cli/status.ts`
- `src/knowledge/embedded-adapter.ts`
- `src/query/index-service.ts`
- `src/query/query-service.ts`
- `src/slicing/build-slice-plan.ts`
- 相关 unit/integration tests

并且要把以下“项目自有层”的残留一并纳入：

- `src/query/index-service.ts`
  - 仍然从 `embedded-adapter` import `checkEmbeddedIndex/ensureEmbeddedIndex`
- `src/query/query-service.ts`
  - `provenance.source` 仍然写成 `embedded-gitnexus`
- `src/cli/status.ts`
  - 仍读取 `manifest.gitnexus_version`
- `src/cli/generate.ts`
  - 仍保留 `gitnexusVersion`、`gitnexus` 这类命名字段

## Explicit Boundary: What Must Be Cleaned vs. What May Stay

### Must Be Cleaned

以下属于“项目自有边界”或“用户可见边界”，必须一起清理：

- `src/cli/**`
- `src/query/**`
- `src/knowledge/**`
- `src/slicing/**`
- `src/gitnexus/**`
- 项目自有测试
- `README.md`
- 当前生效的用户文案、日志文案、状态输出

### May Stay Temporarily

以下属于 vendored runtime 内部或第三方来源痕迹，本轮不要求整体去 GitNexus 化，只要它们不继续污染项目主边界即可：

- `src/engine/**` 内部大量历史注释
- `.gitnexusignore` / `.gitnexus` 这类索引与存储约定
- `engine/platform/capabilities.ts` 中的版本字段
- vendored provenance 注释

也就是说：

- **项目边界要中立**
- **vendored 内核内部可以保留来源痕迹**

本次不接受“为了追求字面干净，把 `engine/**` 整个大规模 rename 一遍”的过度改动。

## Validation

完成后至少满足：

- `generate.ts` 中不再出现：
  - `createEmbeddedGitNexusExecutor`
  - `EmbeddedGitNexusResult`
  - `['analyze'] / ['list'] / ['query']` 这类内部命令模拟
- `embedded-adapter.ts` 删除或只剩下极小且中立的残余工具，不再是主路径依赖
- `npm run typecheck`
- `npm run build`
- `npm test`
- 真实单表生成仍可工作：
  - `database:auth_menu`
  - `database:mall_category`
  - `database:music_user`

## Acceptance

本次完成的判定标准：

1. 主生成链不再依赖桥接式 executor
2. 内部 API 从“字符串命令 + stdout”切回结构化调用
3. 命名与架构语义一致
4. 单表 DB 知识生成能力不回退
