# 业务功能知识 CLI 真实生成闭环 Spec

## 背景

当前仓库已经有以下业务功能知识生成雏形：

- `src/slicing/capability-discovery.ts`
- `src/evidence/capability-evidence-builder.ts`
- `src/generation/capability-claim-generator.ts`
- `src/knowledge/capability-object-assembler.ts`
- `src/knowledge/capability-knowledge-pipeline.ts`
- `src/packaging/capability-knowledge-writer.ts`

但当前实现仍不能算真正生成业务功能知识：

1. `runCapabilityKnowledgePipeline()` 默认没有真实 claims，未注入 `claimsProvider` 时只能产生 OPEN，不能生成 CAP/FLOW/MOD/CON/VER。
2. capability pipeline 没有接入 CLI，用户无法对真实仓库运行。
3. `catalog.yaml` 写死 `capabilities: {}`，缺少 capability 到对象和 view 的路由关系。
4. capability discovery 仍是 targeted demo，`primaryEntryPoints` 为空，缺少真实入口信号。

本次目标是补齐最小可用闭环，使 Claude Code 能在真实项目 `D:\workspace\other_project\music-education-app` 上验证“可以生成业务功能知识”。

## 目标

新增一个可执行的 capability-oriented 知识生成入口，使系统能：

```text
真实项目路径 + 目标术语/路径
-> discover capability
-> build EvidenceBundle
-> generate or fallback assemble claims
-> assemble CAP / FLOW / MOD / CON / VER / OPEN
-> write bootstrap-knowledge catalog + objects + capability view
```

## 非目标

- 不做 full repo 自动发现。
- 不做 OpenSpec/spec-kit/Kiro adapter。
- 不重写现有 DB 对象生成流程。
- 不要求 LLM 一定可用；无 LLM 时必须有 deterministic skeleton fallback。
- 不要求完美业务命名，但输出必须能被 AI 作为 capability context 消费。

## 功能要求

### 1. CLI 必须能触发业务功能知识生成

新增 CLI 能力，推荐命令形式：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms db,mybatis,knowledge --paths src/main,src/test
```

如果不新增顶级命令，也可以在现有 `generate` 下增加显式选项，但必须能从命令行触发 capability pipeline，不能只靠单元测试调用。

### 2. 默认必须生成非 OPEN 对象

`runCapabilityKnowledgePipeline()` 在没有 LLM 或没有 `claimsProvider` 时，必须基于 EvidenceBundle 生成 deterministic skeleton claims，至少覆盖：

- CAP
- FLOW
- MOD
- CON
- VER
- OPEN

如果某类证据为空，可以生成 OPEN，但不能因为没有 LLM 就只生成 OPEN。

### 3. catalog 必须包含 capability 路由

`catalog.yaml` 必须包含：

```yaml
capabilities:
  CAP-XXX:
    view: views/capabilities/CAP-XXX.md
    objects:
      - CAP-XXX
      - FLOW-XXX
      - MOD-XXX
      - CON-XXX
      - VER-XXX
      - OPEN-XXX
```

`objects` 下每个对象必须有 type 和 path。

### 4. capability view 必须可作为 AI 入口

生成：

```text
bootstrap-knowledge/views/capabilities/CAP-XXX.md
```

必须包含：

```md
## Purpose
## Terms
## Current Flow
## Code Surface
## Contracts
## Validation
## Unknowns
```

各节引用对象 ID，不新增权威事实。

### 5. 真实项目验证是强制项

必须在：

```text
D:\workspace\other_project\music-education-app
```

运行真实命令并验证输出。

最低验证内容：

1. `bootstrap-knowledge/catalog.yaml` 存在。
2. `bootstrap-knowledge/views/capabilities/*.md` 至少一个。
3. `bootstrap-knowledge/objects/capabilities/CAP-*.yaml` 至少一个。
4. 至少存在 FLOW/MOD/CON/VER/OPEN 中的 4 类对象。
5. catalog 中 `capabilities` 不是 `{}`。
6. capability view 中引用了生成的对象 ID。

## 设计要求

### Deterministic Skeleton Claims

新增函数：

```ts
export function buildSkeletonClaims(bundle: EvidenceBundle): CandidateClaim[]
```

生成规则：

- CAP：来自 `bundle.capabilityHints.nameCandidates[0]`
- FLOW：如果有 `flowTraces`，引用第一个 flow evidence
- MOD：如果有 `moduleSurfaces`，为主要 module 生成 MOD claim
- CON：如果有 `dataContracts`，为主要 data contract 生成 CON claim
- VER：如果有 `validationAnchors`，生成 VER claim
- OPEN：来自 `openQuestions` 和 `negativeEvidence`

非 OPEN claim 必须引用真实 evidence ref。

### Claims Provider 顺序

`runCapabilityKnowledgePipeline()` 应按顺序取 claims：

1. 如果传入 `claimsProvider`，使用 provider 输出并过滤。
2. 如果 provider 没有输出可用非 OPEN claim，使用 `buildSkeletonClaims(bundle)` 补齐最小对象。
3. 如果 skeleton 也缺某类证据，生成 OPEN。

### CLI 输入

支持：

```text
path: 目标仓库路径
--terms: 逗号分隔目标术语
--paths: 逗号分隔目标路径
--out: 可选输出目录，默认目标仓库根目录
```

### 写入路径

默认写入：

```text
<targetRepo>/bootstrap-knowledge/
```

## 验收标准

1. 新增 CLI/integration 测试覆盖 capability 命令或选项。
2. `runCapabilityKnowledgePipeline()` 无 `claimsProvider` 时也能生成 CAP/FLOW/MOD/CON/VER/OPEN 中至少 5 类对象。
3. `catalog.yaml` 的 `capabilities` 包含实际 capability 映射。
4. `npm run typecheck` 通过。
5. `npm test` 通过。
6. `npm run build` 通过。
7. 真实项目 `D:\workspace\other_project\music-education-app` 生成成功，并记录输出摘要。

