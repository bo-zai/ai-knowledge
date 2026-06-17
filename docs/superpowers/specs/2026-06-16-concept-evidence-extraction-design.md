---
name: Concept Evidence Extraction Redesign
description: 重构 Concept 知识证据提取流程，采用多途径追溯发现替代命名模式匹配
type: project
---

# Concept 知识证据提取设计方案

## 设计目标

**核心改进**：

- 从"命名模式匹配"升级为"追溯路径发现"
- 支持 Java 多入口追溯：Controller → Mapper → 表 → Entity
- 以数据库表作为跨模块聚合锚点
- 保留追溯路径信息，为 CAPABILITY 知识生成准备证据
- Git commit 信息作为 LLM 调用的补充证据

---

## 1. 多途径聚合架构

采用**并行发现 + 表锚点合并**架构：

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    ParallelDiscoveryRunner                                  │
│                                                                            │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │ControllerPath   │ │ScheduledPath    │ │MQConsumerPath   │ ← 并行追溯   │
│  │Discovery        │ │Discovery        │ │Discovery        │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│         ↓                  ↓                  ↓                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      TracePathBuilder                                 │ │
│  │  构建完整追溯路径：EntryPoint → Service → Mapper → Table → Entity     │ │
│  │  每个追溯路径记录：模块信息、文件路径、行号、置信度                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                    TableAnchorAggregator                              │ │
│  │  以数据库表为锚点聚合：                                                │ │
│  │  - 同一张表被多个模块追溯 → isCrossModule = true → 置信度 +0.2        │ │
│  │  - 同一张表被多个入口点追溯 → 多场景覆盖 → 置信度加权                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                    ServiceCallCluster                                 │ │
│  │  Service 调用链聚合（业务域归类）：                                     │ │
│  │  - 多个入口点调用同一 Service → 该 Service 是业务域核心               │ │
│  │  - 将分散入口归类到同一业务域                                          │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                   TableRelationSupplement                             │ │
│  │  表关联补充发现：                                                      │ │
│  │  - 外键关系：pms_product.category_id → pms_category                   │ │
│  │  - JOIN 语句分析：发现隐含关联                                         │ │
│  │  - 补充遗漏的 Entity/表                                                │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                  GitCommitEvidenceEnhancer                            │ │
│  │  为每个候选附加 Git commit 信息（LLM 调用时传入）                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                  BusinessDomainDefiner                                │ │
│  │  业务域边界划定：                                                      │ │
│  │  - 跨模块表 → 跨模块业务域                                             │ │
│  │  - 单模块表 → 单模块业务域                                             │ │
│  │  - 表关联 → 业务域合并                                                 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 发现途径设计

### 途径 1：Controller 追溯

**追溯链路**：`Controller → Service → Mapper → Table → Entity`

**实现步骤**：

1. 查询所有 Controller 类（Cypher 或文件扫描）
2. 分析 Controller 方法调用关系
3. 追溯 Service → Mapper → SQL → 表
4. 从 Mapper XML 或 Entity 注解提取表名
5. 构建完整 TracePath

### 途径 2：Scheduled 追溯

**追溯链路**：`@Scheduled 方法 → Service → Mapper → Table → Entity`

**实现步骤**：

1. 扫描 @Scheduled 注解方法
2. 追溯调用链至 Mapper
3. 提取表信息

### 途径 3：MQ Consumer 追溯

**追溯链路**：`@RocketMQMessageListener/@KafkaListener → Service → Mapper → Table → Entity`

**实现步骤**：

1. 扫描 MQ 消费者注解
2. 追溯消费方法调用链
3. 提取表信息

### 途径 4：Service 调用链聚合

**目的**：将分散入口归类到同一业务域

**实现**：

- 查询 Service 被哪些入口点调用
- 同一 Service 被多个 Controller/Scheduled/MQ 调用 → 该 Service 是业务域核心
- 将这些入口点归类到同一业务域

### 途径 5：表关联补充

**目的**：发现遗漏的表和 Entity

**实现**：

- 外键分析：从 Mapper XML 或 Entity 注解提取外键关系
- JOIN 分析：从 Mapper SQL 提取 JOIN 语句中的关联表
- 补充 TracePath 中缺失的表

---

## 3. 候选信息结构

### 3.1 ConceptCandidate

```typescript
interface ConceptCandidate {
  // 基础信息
  candidateId: string; // CAND-{table-name}
  nameCandidates: string[]; // 候选概念名称
  confidence: number; // 置信度 0-1
  confidenceBreakdown: {
    traceDepth: number; // 追溯深度（完整度）
    crossModule: number; // 跨模块加权
    multiEntryPoint: number; // 多入口覆盖
    tableRelation: number; // 表关联密度
  };

  // 模块信息
  modulePath: string; // 主模块路径
  moduleName: string; // 主模块名
  isCrossModule: boolean; // 是否跨模块候选

  // 表锚点信息
  tableAnchor: {
    tableName: string; // 数据库表名（核心锚点）
    schema?: string;
    columns: string[];
  };

  // 追溯路径信息
  tracePath: ConceptTracePath;

  // Git commit 信息
  gitCommits: GitCommitEvidence[];

  // 标记信息
  suspiciousMark?:
    | "transmission_class"
    | "config_class"
    | "simple_enum"
    | "external_enum_usage";
}
```

### 3.2 ConceptTracePath

```typescript
interface ConceptTracePath {
  entryPoints: {
    kind: "controller" | "scheduled" | "mq_consumer";
    className: string;
    filePath: string;
    moduleName: string;
    modulePath: string;
    methodName?: string;
    startLine: number;
    signature?: string; // @GetMapping("/product/list")
  }[];

  serviceChain?: {
    className: string;
    filePath: string;
    moduleName: string;
    modulePath: string;
    methodName?: string;
    startLine: number;
  }[];

  mappers: {
    className: string;
    filePath: string;
    moduleName: string;
    modulePath: string;
    xmlPath?: string;
    sqlIds: string[];
  }[];

  tables: {
    tableName: string;
    schema?: string;
    columns?: string[];
  }[];

  entities: {
    className: string;
    filePath: string;
    moduleName: string;
    modulePath: string;
    fields: string[];
    startLine: number;
    codeSnippet?: string;
  }[];
}
```

### 3.3 GitCommitEvidence

```typescript
interface GitCommitEvidence {
  commitHash: string;
  commitMessage: string; // 业务描述
  commitDate: string;
  author?: string;

  changedFiles: {
    filePath: string;
    moduleName: string;
    changeType: "added" | "modified" | "deleted";
  }[];

  relevanceScore: number; // 与候选相关度
}
```

---

## 4. 跨模块业务域发现

### 4.1 以表为聚合锚点

**理由**：

- 表是物理唯一：不管代码库有多少 Entity 定义，数据库中只有一张表
- 跨模块聚合更准确：多个模块操作同一张表 → 共享同一业务数据 → 属于同一业务域

### 4.2 TableAnchor 结构

```typescript
interface TableAnchor {
  tableName: string; // 数据库表名（唯一锚点）
  schema?: string;
  columns: string[];

  traceSources: {
    modulePath: string;
    moduleName: string;
    entityClassName: string;
    entityFilePath: string;
    entryPoints: {
      kind: string;
      className: string;
      filePath: string;
      methodName?: string;
    }[];
    mapperClassName: string;
    mapperFilePath: string;
    confidence: number;
  }[];

  isCrossModule: boolean; // traceSources 来自多个模块
  moduleCount: number;
  moduleNames: string[];

  aggregatedConfidence: number;
}
```

### 4.3 BusinessDomain 结构

```typescript
interface BusinessDomain {
  domainId: string; // domain-{table-name}
  domainName: string; // 业务域名称

  coreTables: TableAnchor[];
  relatedTables: TableAnchor[];

  coveredModules: {
    moduleName: string;
    modulePath: string;
    role: "primary" | "supporting";
    entryPointCount: number;
  }[];

  isCrossModuleDomain: boolean;
  candidates: ConceptCandidate[];
  gitCommits: GitCommitEvidence[];
}
```

---

## 5. 置信度计算

```typescript
function computeConfidence(anchor: TableAnchor): number {
  // 基础追溯深度（0.5 - 1.0）
  const traceDepthScore = computeTraceDepth(anchor);

  // 跨模块加权（0 - 0.2）
  const crossModuleBonus = anchor.isCrossModule ? 0.2 : 0;

  // 多入口覆盖（0 - 0.15）
  const entryPointTypes = new Set(
    anchor.traceSources.flatMap((s) => s.entryPoints.map((e) => e.kind)),
  );
  const multiEntryPointBonus = Math.min(0.15, entryPointTypes.size * 0.05);

  // 表关联密度（0 - 0.1）
  const tableRelationBonus =
    anchor.relatedTables?.length > 0
      ? Math.min(0.1, anchor.relatedTables.length * 0.02)
      : 0;

  return Math.min(
    1,
    traceDepthScore +
      crossModuleBonus +
      multiEntryPointBonus +
      tableRelationBonus,
  );
}
```

---

## 6. Git Commit 信息提取

**提取策略**：

1. 扫描候选涉及的文件（Entity、Mapper、Controller）的 git log
2. 筛选与候选相关的 commit（修改了相关文件）
3. 计算相关度并排序

**相关度计算**：

- 修改了 Entity 文件 → 0.8
- 修改了 Mapper 文件 → 0.7
- 修改了 Controller 文件 → 0.6
- commit message 包含表名/Entity名 → +0.2

---

## 7. 与 CAPABILITY 知识衔接

| Concept 候选字段         | CAPABILITY 使用方式          |
| ------------------------ | ---------------------------- |
| `tracePath.entryPoints`  | 映射为 `EntrySignal`         |
| `tracePath.serviceChain` | `BehaviorSignal` 服务层锚点  |
| `tracePath.mappers`      | `DataSignal` SQL 层锚点      |
| `tableAnchor`            | `DataSignal` 表层锚点        |
| `tracePath.entities`     | `DataSignal` 类型层锚点      |
| `gitCommits`             | `DocSignal` commit 证据      |
| `confidenceBreakdown`    | 映射为 `confidenceBreakdown` |

---

## 8. 文件结构规划

```
src/evidence/extractors/concept/
├── index.ts                    # 主入口
├── parallel-discovery-runner.ts # 并行发现运行器
├── discovery-paths/
│   ├── controller-path.ts      # Controller 追溯途径
│   ├── scheduled-path.ts       # Scheduled 追溯途径
│   ├── mq-consumer-path.ts     # MQ Consumer 追溯途径
│   └── index.ts                # 途径注册
├── trace-path-builder.ts       # 追溯路径构建器
├── table-anchor-aggregator.ts  # 表锚点聚合器
├── service-call-cluster.ts     # Service 调用链聚类
├── table-relation-supplement.ts # 表关联补充
├── git-commit-enhancer.ts      # Git commit 增强器
├── business-domain-definer.ts  # 业务域边界划定
├── types.ts                    # 类型定义
└── language-adapters/
    ├── java-adapter.ts         # Java 语言适配
    └── index.ts
```

---

## 9. 实现优先级

**第一批（核心）**：

1. `types.ts` - 类型定义
2. `discovery-paths/controller-path.ts` - Controller 追溯途径
3. `trace-path-builder.ts` - 追溯路径构建器
4. `table-anchor-aggregator.ts` - 表锚点聚合器
5. `parallel-discovery-runner.ts` - 并行发现运行器

**第二批（补充）**：

1. `discovery-paths/scheduled-path.ts` - Scheduled 追溯途径
2. `discovery-paths/mq-consumer-path.ts` - MQ Consumer 追溯途径
3. `service-call-cluster.ts` - Service 调用链聚类
4. `table-relation-supplement.ts` - 表关联补充

**第三批（增强）**：

1. `git-commit-enhancer.ts` - Git commit 增强器
2. `business-domain-definer.ts` - 业务域边界划定
3. 与现有 `concept-extractor.ts` 整合
