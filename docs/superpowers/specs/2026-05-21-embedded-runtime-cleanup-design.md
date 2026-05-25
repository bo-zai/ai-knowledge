# Embedded Runtime Cleanup Design

## Goal

清理项目中残留的 `gitnexus` 外部适配层、旧命名和旧文案，使当前代码与“内嵌运行时”架构一致。

本次清理不改变功能边界，不重构 DB 生成链，只解决以下不一致：

- `src/cli/generate.ts` 仍然 import `../gitnexus/*`
- `src/gitnexus/**` 目录仍然存在
- `slicing` 仍然暴露 `extractSliceSeedsFromGitNexus`
- CLI、日志、测试、文档中仍然把运行时描述成 GitNexus 外部依赖

## Non-Goals

- 不修改 MyBatis 解析行为
- 不修改 LLM prompt 结构
- 不修改知识包格式
- 不扩展新功能
- 不重写 `engine/**` 中 vendored runtime 的内部实现

## Current Problem

当前主运行路径已经切到内嵌实现：

- `src/knowledge/embedded-adapter.ts`
- `src/query/**`
- `src/engine/**`

但项目仍然保留了旧结构：

- `src/gitnexus/commands.ts`
- `src/gitnexus/ensure-index.ts`
- `src/gitnexus/adapter.ts`
- `src/gitnexus/types.ts`

并且 `generate.ts` 还直接 import 了其中两个模块，虽然主路径实际上没有再使用它们。

这会带来三个问题：

1. 代码语义不一致，阅读成本高
2. Claude/Codex 后续修改时容易误判真实边界
3. 测试和文档会继续把外部 GitNexus CLI 当成运行时依赖

## Required End State

### 1. 删除运行时残留 import

`src/cli/generate.ts` 不再出现：

- `ensureGitNexusIndex`
- `checkGitNexusIndex`
- `runGitNexus`
- `../gitnexus/*`

主生成链只能依赖：

- `src/knowledge/embedded-adapter.ts`
- `src/query/**`
- `src/engine/**`

### 2. 删除 `src/gitnexus/**`

若确认没有生产路径需要它，整个 `src/gitnexus/**` 应删除。

允许保留的前提只有一个：

- 某个文件确实仍被当前主路径使用，且短期内无法迁出

如果存在这种情况，必须在 spec 实现中显式说明原因；否则默认删除。

### 3. 清理旧类型依赖

测试和模块中不应再 import：

- `src/gitnexus/types`
- `src/gitnexus/adapter`
- `src/gitnexus/ensure-index`

所有类型和行为测试应改成依赖：

- `src/knowledge/embedded-adapter`
- `src/query/**`
- 或新的中立 shared types

### 4. 重命名 slice 旧接口

`extractSliceSeedsFromGitNexus` 是旧世界命名。

需要替换为中立命名，例如：

- `extractSliceSeedsFromDiscoveryOutput`
- 或更合适的等价命名

要求：

- 新名称不再暗示外部 GitNexus CLI
- 旧名称从主路径删除
- 若保留兼容 wrapper，必须明确标注过渡用途，并不被主路径引用

### 5. 清理 CLI 和用户可见文案

以下用户可见文案必须改掉：

- `Generate bootstrap-knowledge packages from GitNexus + LLM`
- `Force GitNexus re-analysis`
- `GitNexus Version`
- 任何“需要 gitnexus CLI”的帮助描述

替换方向：

- 使用“embedded analysis runtime”
- 使用“embedded index”
- 使用“project runtime”

### 6. 清理注释中的旧运行时语义

例如：

- `Ensure GitNexus index`
- `Run embedded GitNexus list command`
- `GitNexus query`

如果注释表达的是“历史来源”，可以保留在 vendored provenance 文档；
如果表达的是“当前运行时行为”，要改成当前项目语义。

### 7. 清理测试语义

现有测试中仍有大量：

- `GitNexus index handling`
- `extracts slices from GitNexus output`
- `mock GitNexus output`

需要改成：

- embedded index handling
- discovery output normalization
- embedded runtime discovery

这里不是要求删除测试，而是要求测试名、mock 类型、断言语义与当前架构一致。

## File-Level Scope

本次清理至少应覆盖：

- `src/cli/generate.ts`
- `src/cli/index.ts`
- `src/cli/status.ts`
- `src/slicing/build-slice-plan.ts`
- `src/knowledge/embedded-adapter.ts`
- `src/query/**`（如需补类型承接）
- `src/gitnexus/**`（删除或迁出）
- `tests/unit/gitnexus/**`
- `tests/unit/cli/generate-orchestration.test.ts`
- 相关 README / docs 中的当前运行时描述

## Validation

完成后至少应满足：

- `rg "src/gitnexus|../gitnexus/|ensureGitNexusIndex|checkGitNexusIndex|runGitNexus" src tests`
  - 不再命中主运行路径
- `rg "GitNexus + LLM|Force GitNexus re-analysis|GitNexus Version" src README.md`
  - 不再保留旧用户文案
- `npm run typecheck`
- `npm run build`
- `npm test`

## Acceptance

本次清理完成的判定标准：

1. 运行时主链不再依赖 `src/gitnexus/**`
2. 主路径中不再出现旧 `gitnexus` import
3. 旧命名从 `generate.ts` 和 slice 构建主链中移除
4. 用户可见文案与当前架构一致
5. 测试通过，且测试名/断言不再误导为外部 GitNexus CLI 架构
