# Full De-GitNexus Runtime Design

## Goal

按当前要求，项目中不应再保留任何面向运行时、面向产品边界、面向用户的 `GitNexus / gitnexus` 代码语义、命名、路径约定或桥接残留。

这次目标不再是“去掉外部 CLI 依赖”，而是更严格的：

- 不要任何 `gitnexus` 风格桥接
- 不要任何项目自有层的 `gitnexus` 命名
- 不要任何运行时仍依赖 `.gitnexus` / `.gitnexusignore` / `gitnexus_version`
- 不要任何主产品代码继续生成 GitNexus 上下文、GitNexus 技能或 GitNexus 文案

## Current State Summary

经过最新检查，桥接层已经部分被移除，但项目仍然保留了大量 GitNexus 语义残留，分成三层：

### A. 主产品边界残留

- `src/cli/generate.ts`
  - `OrchestrationDeps.gitnexus`
  - `source_kind: 'gitnexus'`
- `src/evidence/**`
  - 大量 `source_kind: 'gitnexus'`
- `src/schemas/manifest.ts`
  - `gitnexus_version`
- `tests/integration/**`
  - 仍以 GitNexus 语义命名和断言

### B. 活跃运行时残留

- `src/config/ignore-service.ts`
  - `.gitnexusignore`
- `src/engine/storage/repo-manager.ts`
  - `.gitnexus/`
  - `~/.gitnexus/registry.json`
- `src/engine/analyze/run-analyze.ts`
  - `ensureGitNexusIgnored`
  - `skipAgentsMd` 相关逻辑仍引用 GitNexus 上下文生成

### C. Vendored 内核残留

- `src/engine/cli/ai-context.ts`
  - 整块 GitNexus AGENTS/CLAUDE 技能上下文生成
- `src/engine/cli/skill-gen.ts`
  - GitNexus skill prompt 生成
- `src/engine/group/**`
  - cross-impact / group / storage 仍大量保留 GitNexus 语义
- `src/engine/platform/capabilities.ts`
  - `gitnexus` version 字段
- 大量 vendored 注释和 provenance 文本

## Required End State

### 1. 主产品层完全去 GitNexus 命名

以下项目自有层必须完全清理：

- `src/cli/**`
- `src/query/**`
- `src/evidence/**`
- `src/schemas/**`
- `src/packaging/**`
- `tests/**`
- `README.md`

规则：

- 不允许 `gitnexus_version`
- 不允许 `source_kind: 'gitnexus'`
- 不允许 `OrchestrationDeps.gitnexus`
- 不允许 “GitNexus output / GitNexus discovers slices / GitNexus + LLM” 这类文案

### 2. 活跃运行时的存储与忽略约定改名

当前运行时如果继续使用：

- `.gitnexus/`
- `.gitnexusignore`
- `~/.gitnexus/`

那仍然是实质性 GitNexus 运行时耦合。

必须改成项目自己的约定。建议：

- 仓库本地索引目录：`.knowledge-index/`
- 仓库忽略文件：`.knowledge-ignore`
- 用户家目录全局状态：`~/.knowledge/` 下专属子目录

相应地，需要修改：

- storage path
- registry path
- meta path
- ignore-service
- stale/index checking

### 3. 移除未使用的 GitNexus 专属内核功能

若某些 vendored 模块不是当前产品能力所需，应直接删除，而不是继续留在主仓中：

- `src/engine/cli/ai-context.ts`
- `src/engine/cli/skill-gen.ts`
- `src/engine/group/**`（若当前产品不需要 group/cross-impact）

判定标准：

- 如果当前 `generate/status/clean` 主路径不依赖它
- 且当前 DB knowledge 生成不依赖它
- 则不应继续保留

### 4. 去掉运行时中的 GitNexus 上下文写入行为

`run-analyze.ts` 当前仍然 import/调用 AI context 相关逻辑，即使运行参数里可能选择跳过。

这不符合“项目中不需要任何使用 GitNexus 的代码”。

要求：

- 从分析主链中彻底移除 GitNexus AGENTS/CLAUDE 上下文生成功能
- 若未来需要项目自己的上下文生成，另起独立中立模块

### 5. 去掉 GitNexus 风格 source_kind

`source_kind: 'gitnexus'` 是非常直观的残留。

必须替换为项目自己的来源枚举，例如：

- `analysis-runtime`
- `filesystem`
- `mybatis`
- `entity-code`
- `caller-code`
- `inferred`

规则：

- evidence 层不再用 `gitnexus`
- LLM 输入输出中也不再暴露 `gitnexus`

### 6. manifest / status 元数据改名

以下元数据要改：

- `gitnexus_version` -> `analysis_version` 或 `runtime_version`

要求：

- schema
- build-manifest
- status 输出
- tests fixtures
- 旧知识包兼容逻辑（如需要）一起处理

## Non-Goals

- 不要求重新实现底层解析算法
- 不要求替换 vendored engine 的所有历史注释
- 不要求去掉所有第三方来源痕迹
- 不在本次修改知识包格式本身

也就是说：

- 允许少量 provenance 注释仍说明“代码来源于某上游”
- 但不允许主产品边界、活跃运行时、用户可见路径继续是 GitNexus 语义

## Suggested Scope Split

### Phase 1: 主产品边界去 GitNexus 化

- CLI
- evidence
- schema
- tests
- docs

### Phase 2: 活跃运行时去 GitNexus 化

- storage path
- ignore file
- registry/home dir layout
- analysis metadata

### Phase 3: 删除无关 vendored 子系统

- engine/cli
- engine/group
- 其它未使用子模块

## Validation

完成后至少满足：

### Product boundary grep

```powershell
rg -n "gitnexus|GitNexus|gitnexus_version|embedded-gitnexus" src/cli src/query src/evidence src/schemas src/packaging tests README.md
```

预期：

- 无命中

### Runtime path grep

```powershell
rg -n "\\.gitnexus|\\.gitnexusignore|~/.gitnexus|GITNEXUS_" src
```

预期：

- 仅允许保留在 vendored provenance 注释或专门迁移文档中
- 活跃运行时路径中不再出现

### Functional verification

- `npm run typecheck`
- `npm run build`
- `npm test`
- 真实单表生成：
  - `database:auth_menu`
  - `database:mall_category`
  - `database:music_user`

## Acceptance

本次完成的标准是：

1. 主产品代码层已无 `gitnexus` 命名和桥接语义
2. 活跃运行时不再使用 `.gitnexus` / `.gitnexusignore` / `~/.gitnexus`
3. 未使用的 GitNexus 专属子系统已删除或隔离
4. 三张真实表的 DB 知识生成能力不回退
