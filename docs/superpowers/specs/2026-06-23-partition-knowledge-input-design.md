# Partition Knowledge Evidence Design

## 目标

`partition` 输出作为 `CONCEPT` 和 `CAPABILITY` 知识生成的一级业务边界输入。它不直接生成知识对象，也不引入新的知识输入协议，而是把现有生成链路的证据准备层重构为统一的 `knowledge-evidence` 层。

现有稳定资产继续复用：

- `EvidenceGroup`
- `CapabilityInventoryItem`
- `CapabilityCandidate`
- `EvidenceBundle`
- 现有 prompt、claims、assembler、writer

## 架构

```text
generate
  -> KnowledgeEvidencePlanner
      -> PartitionEvidenceProvider
      -> GraphEvidenceProvider
      -> EvidenceMergePolicy
  -> EvidenceGroup[] / CapabilityInventoryItem[] / CapabilityCandidate[]
  -> existing LLM prompt / claims / assembler / writer
```

新增模块：

```text
src/knowledge-evidence/
  index.ts
  types.ts
  evidence-planner.ts
  partition-provider.ts
  graph-provider.ts
  merge-policy.ts
  artifact-writer.ts
  concept/concept-evidence-planner.ts
  capability/capability-evidence-planner.ts
  capability/capability-inventory-planner.ts
```

## 设计原则

- `partition` 是边界和证据范围，不是 concept/capability 的最终粒度。
- `partition` 有效时，以 partition 边界为主；graph 扫描只作为补充证据。
- `partition` 不存在或质量不足时，回退现有 graph 扫描。
- 不新增 `KnowledgeInputBundle`，不绕开现有 `EvidenceBundle`。
- 不硬编码项目名、路径、表名前缀、模块名、业务关键词。

## Concept 生成

`CONCEPT` 生成以 partition-scoped `EvidenceGroup[]` 作为输入。

规则：

- 表、Entity、枚举、字段、外部业务常量是 concept 的主要证据。
- entry point、service、mapper 只作为 usage/context 证据，不直接决定 concept。
- 一个 partition 可以包含多个 concept 候选。
- 没有表、Entity、枚举或字段证据的 partition 不生成强 concept group。
- 现有 concept extractor 的语言适配、过滤、外部引用发现继续复用，但候选会按 partition 边界重新归组。

## Capability 生成

`CAPABILITY` 生成以 partition 的入口点、调用链、服务、Mapper、表和模块作为证据。

规则：

- 有 entry point 的 partition 可以生成 primary capability 输入。
- 没有 entry point 但有表的 partition 不生成 primary capability，只作为 concept/data 支撑证据。
- `capability-domain` 模式下，partition 本身就是能力边界。
- `business-domain` 模式下，partition 是业务域边界，具体能力由 entry/action 证据在域内归纳。
- 现有 capability claims、assembler、writer 继续复用。

## 接入点

- `src/evidence/type-evidence-builder.ts`：改为调用 `KnowledgeEvidencePlanner` 获取 `EvidenceGroup[]`。
- `src/slicing/capability-inventory.ts`：改为调用 `buildPlannedCapabilityInventory()`，没有 partition 时回退原扫描逻辑。
- `src/evidence/extractors/*`：降级为 `GraphEvidenceProvider` 内部能力。
- `src/knowledge/capability-knowledge-pipeline.ts`：保留现有后半段逻辑。

## 中间产物

写入 `.knowledge/knowledge-generation/`：

- `evidence-plan.json`
- `concept-evidence-groups.json`
- `capability-evidence-groups.json`
- `capability-inventory.json`
- `capability-candidates.json`
- `evidence-quality-report.json`

这些文件用于回检 partition 到知识生成输入的转换过程。

## 验收

- `generate --knowledge CONCEPT` 优先使用 partition 边界生成 concept evidence groups。
- `generate --knowledge CAPABILITY` 优先使用 partition 边界生成 capability inventory/evidence groups。
- partition 缺失时，现有 graph 生成逻辑仍可工作。
- 中间产物能说明每个 group 来源、证据数量、跳过原因和回退行为。
- 新增代码不包含任何验证项目专用逻辑。
