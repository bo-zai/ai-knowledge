# 业务功能逆向知识生成 Spec

## 目标

为已有代码仓库逆向生成面向 AI 的业务功能知识包，使 OpenSpec、spec-kit、Kiro、Claude Code、Cursor、Codex 等 SDD 工具在需求澄清、技术设计、实现计划、编码、Review 和验证阶段都能读取项目事实、边界、代码落点与验证依据。

第一版只落地一个闭环：

```text
已有仓库
-> 发现候选业务功能 CapabilityCandidate
-> 构建 EvidenceBundle
-> 生成候选知识 claim
-> 组装 CAP / TERM / FLOW / MOD / CON / VER / OPEN 对象
-> 渲染 catalog.yaml 和 capability view
-> 用真实需求验证 change plan 是否更准确
```

## 非目标

- 不生成完整人类 wiki。
- 不直接实现 OpenSpec/spec-kit/Kiro adapter。
- 不让 LLM 全仓库自由总结。
- 不要求一次覆盖全仓库所有业务功能。
- 不把无证据推断写成稳定事实。

## 核心原则

1. 生成内容是给 AI 消费的，不是给用户阅读的普通文档。
2. 程序负责结构、对象 ID、路径、对象类型、schema 校验和落盘。
3. LLM 只负责基于有限 EvidenceBundle 生成候选 claim。
4. 稳定知识必须引用 evidence ref。
5. 缺证据但会影响 AI 决策的问题必须进入 OPEN。
6. capability view 只做对象编排，不新增权威事实。

## 输出结构

第一版输出到目标仓库的 `bootstrap-knowledge/`：

```text
bootstrap-knowledge/
├── catalog.yaml
├── objects/
│   ├── capabilities/
│   ├── terms/
│   ├── flows/
│   ├── modules/
│   ├── contracts/
│   ├── validation/
│   └── open/
└── views/
    └── capabilities/
```

## 对象类型

第一版只生成 7 类对象。

### CAP

表示业务功能。回答：

- 这个功能是什么
- 服务哪些 SDD 阶段
- 当前功能范围是什么
- 相关对象有哪些

### TERM

表示业务术语。回答：

- 需求里的核心词是什么意思
- 不能和什么混淆
- 该术语会影响哪些 AI 判断

### FLOW

表示当前执行流程。回答：

- 功能从入口到输出如何运行
- 关键步骤有哪些
- 哪些失败分支缺证据

### MOD

表示代码改动面。回答：

- 相关需求应该改哪些路径或模块
- 什么情况下不要改这个模块
- 模块承担什么职责

### CON

表示契约。第一版包括：

- schema contract
- SQL/MyBatis evidence contract
- output package contract

### VER

表示验证依据。回答：

- 怎么证明改动成立
- 需要哪些测试或命令
- 验收 oracle 是什么

### OPEN

表示不能猜的问题。回答：

- 哪个事实没有证据
- 阻塞哪些决策
- 最小下一步证据是什么

## CapabilityCandidate

`CapabilityCandidate` 是候选业务功能，不是最终知识对象。

必备字段：

```ts
type CapabilityCandidate = {
  candidateId: string;
  nameCandidates: string[];
  summaryHint?: string;
  confidence: number;
  confidenceBreakdown: {
    entrySignal: number;
    behaviorSignal: number;
    dataSignal: number;
    testSignal: number;
    docSignal: number;
    graphCohesion: number;
  };
  primaryEntryPoints: EntrySignal[];
  behaviorAnchors: BehaviorSignal[];
  dataAnchors: DataSignal[];
  testAnchors: TestSignal[];
  docAnchors: DocSignal[];
  moduleClusters: ModuleCluster[];
  relatedTerms: string[];
  risks: CandidateRisk[];
  missingSignals: string[];
};
```

候选能力来源于 5 类信号：

- EntrySignal：CLI command、HTTP route、controller、handler、job、public service method
- BehaviorSignal：带业务动词和业务对象的函数或方法
- DataSignal：schema、type、interface、DB table、SQL、输出结构
- TestSignal：describe/it/test 名称、expect 断言、fixture/golden case
- DocSignal：README、AGENTS.md、notes、docs 中的辅助术语和约束

评分公式：

```text
confidence =
  entrySignal * 0.25 +
  behaviorSignal * 0.20 +
  dataSignal * 0.20 +
  testSignal * 0.15 +
  docSignal * 0.05 +
  graphCohesion * 0.15
```

过滤策略：

```text
targeted mode: confidence >= 0.55
full repo mode: confidence >= 0.70
```

第一版优先支持 targeted mode。

## EvidenceBundle

`EvidenceBundle` 是 LLM 的唯一主输入。

```ts
type EvidenceBundle = {
  bundleId: string;
  candidateId: string;
  repoProfile: RepoProfileLite;
  confidence: number;
  risks: CandidateRisk[];
  capabilityHints: {
    nameCandidates: string[];
    relatedTerms: string[];
    summaryHint?: string;
  };
  entryPoints: EvidenceEntryPoint[];
  flowTraces: EvidenceFlowTrace[];
  behaviorSlices: EvidenceBehaviorSlice[];
  dataContracts: EvidenceDataContract[];
  moduleSurfaces: EvidenceModuleSurface[];
  validationAnchors: EvidenceValidationAnchor[];
  docs: EvidenceDocSnippet[];
  negativeEvidence: NegativeEvidence[];
  openQuestions: OpenQuestionSeed[];
};
```

大小预算：

```text
entryPoints: 1-5
flowTraces: 1-3
behaviorSlices: 4-12
dataContracts: 1-10
moduleSurfaces: 2-8
validationAnchors: 1-10
docs: 0-5
```

所有证据必须有稳定引用：

```text
evidence://entry/EP-001
evidence://flow/FLOW-EVID-001
evidence://behavior/BEH-004
evidence://contract/CON-EVID-002
evidence://validation/VAL-003
```

## LLM 输出

LLM 输出候选 claim，不能输出最终对象 ID、最终路径或 catalog。

```ts
type CandidateClaim = {
  suggestedType: "CAP" | "TERM" | "FLOW" | "MOD" | "CON" | "VER" | "OPEN";
  claimText: string;
  confidence: "high" | "medium" | "low";
  evidenceRefs: string[];
  decisionPoints: string[];
  sddStageUses: SddStage[];
  unsupportedParts: string[];
  blockedDecisions: string[];
  objectHints?: {
    canonicalTerm?: string;
    subject?: string;
    modulePath?: string;
    contractKind?: "schema" | "sql" | "api" | "event" | "output";
  };
};
```

过滤规则：

- 非 OPEN claim 的 `evidenceRefs` 必须非空。
- 非 OPEN claim 的 evidence ref 必须存在于 bundle。
- `confidence=low` 的非 OPEN claim 不进入稳定对象。
- `unsupportedParts` 必须拆成 OPEN。
- OPEN claim 必须有 `blockedDecisions` 和 `minimalNextEvidence`。

## Capability View

每个功能生成一个 view：

```text
views/capabilities/CAP-XXX.md
```

固定结构：

```md
# CAP-XXX

## Purpose
## Terms
## Current Flow
## Code Surface
## Contracts
## Validation
## Unknowns
```

规则：

- 只引用对象 ID。
- 允许一行导航摘要。
- 不新增权威事实。

## catalog.yaml

第一版支持按 capability 和 SDD 阶段检索：

```yaml
version: 1

retrieval_order:
  capability_context:
    - CAP
    - TERM
    - FLOW
    - MOD
    - CON
    - VER
    - OPEN

sdd_stage_mapping:
  requirement_clarification:
    include_types: [TERM, CAP, OPEN]
  requirement_specification:
    include_types: [CAP, FLOW, CON, VER, OPEN]
  design_planning:
    include_types: [FLOW, CON, MOD, OPEN]
  implementation_planning:
    include_types: [MOD, CON, VER, FLOW]
  coding:
    include_types: [MOD, CON, VER]
  review:
    include_types: [CON, MOD, VER, OPEN]
  validation:
    include_types: [VER, CON, FLOW]

capabilities: {}
objects: {}
```

## 首个 Pilot

首个 pilot 使用当前项目自身，目标能力：

```text
DB/MyBatis evidence -> DB knowledge generation
```

预期识别：

- CAP-DB-KNOWLEDGE-GENERATION
- TERM-DB-OBJECT
- TERM-DESCRIPTION-SOURCE
- FLOW-DB-KNOWLEDGE-GENERATION
- MOD-MYBATIS-EVIDENCE
- MOD-DB-KNOWLEDGE-GENERATOR
- CON-DB-OBJECT-SCHEMA
- CON-MYBATIS-SQL-EVIDENCE
- VER-DB-KNOWLEDGE-GENERATION
- OPEN-DB-DESCRIPTION-INFERENCE

## 验收标准

第一版完成后，必须满足：

1. targeted mode 能围绕关键词或路径发现至少 1 个候选业务功能。
2. 能为该候选功能构建通过 schema 校验的 EvidenceBundle。
3. 能生成并过滤 CandidateClaim。
4. 能组装 `CAP / FLOW / MOD / CON / VER / OPEN` 至少 5 类对象。
5. 所有非 OPEN 对象都有 evidence ref。
6. 能渲染 `catalog.yaml` 和 capability view。
7. 用 pilot 需求验证时，AI 能输出带对象引用的 change plan。

Pilot 需求：

```text
修改 DB 知识对象生成逻辑：每个字段必须包含 description_zh，description_source 只能是 comment 或 inferred。
```

期望 change plan 至少包含：

```yaml
matched_capability:
  - CAP-DB-KNOWLEDGE-GENERATION
term_mapping:
  description_source: TERM-DESCRIPTION-SOURCE
current_flow:
  - FLOW-DB-KNOWLEDGE-GENERATION
change_surface:
  - MOD-DB-KNOWLEDGE-GENERATOR
  - CON-DB-OBJECT-SCHEMA
validation_plan:
  - VER-DB-KNOWLEDGE-GENERATION
unknowns:
  - OPEN-DB-DESCRIPTION-INFERENCE
```
