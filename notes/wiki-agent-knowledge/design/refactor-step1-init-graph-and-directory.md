# generate 命令重构 — Step 1: 初始化图数据与目录体系

## 定位

本文档是 generate 命令重构的第一步 spec 和 plan。

后续步骤（知识生成流水线改造、对象模型改造、catalog.yaml 改造等）不在本文档范围内。

## 目标

把"初始化图数据"和"初始化目录体系"从流水线内部抽出，变成 generate 命令的两个显式前置阶段。

## 现状问题

### 问题 1: 图数据初始化被埋在流水线内部

当前 `ensureIndex()` 在两个地方被调用：

- `src/cli/generate.ts` 第 154 行：capability 流水线入口前
- `src/knowledge/db-knowledge-pipeline.ts`：DB 流水线内部的 `prepareKnowledgeGeneration()`

问题：
- 两条流水线各自做图初始化，逻辑重复
- 如果 DB 先跑、Capability 后跑，图数据可能被初始化两次
- 无法在初始化完成后向用户报告图状态

### 问题 2: 目录结构在 write 阶段才创建

当前 `writeKnowledgePackage()` 在生成完成后才：
1. 清空 `bootstrap-knowledge/`
2. 创建目录结构
3. 写入文件

问题：
- 目录创建和文件写入耦合在一起
- 如果生成中途失败，目录状态不确定
- 无法提前验证输出路径的合法性

### 问题 3: 目录结构按对象类型组织

当前输出结构：

```text
bootstrap-knowledge/
├── catalog.yaml
├── capabilities/
│   └── CAP-GOODS-BROWSE.md
├── views/capabilities/
│   └── CAP-GOODS-BROWSE.md
├── objects/
│   ├── terms/TERM-*.yaml
│   ├── capabilities/CAP-*.yaml
│   ├── flows/FLOW-*.yaml
│   ├── modules/MOD-*.yaml
│   ├── contracts/CON-*.yaml
│   ├── validation/VER-*.yaml
│   └── open/OPEN-*.yaml
├── evidence/index.jsonl
├── reports/generation.json
└── debug/
```

按设计文档 `03-document-architecture.md` 的目标结构：

```text
bootstrap-knowledge/
├── catalog.yaml
├── objects/
│   ├── {域名}/
│   │   └── {中文标题}.md
│   └── _共享/
│       └── {共享对象}.md
├── evidence/
└── reports/
```

## Step 1 Spec

### 输入

- `repoPath: string` — 目标仓库路径
- `outputRoot: string` — 输出根目录
- `forceAnalyze?: boolean` — 是否强制重新分析

### 输出

- 图数据已就绪（LadybugDB 索引可用）
- 目录骨架已创建（空目录结构，不含知识文件）
- `GraphStatus` — 图数据的初始化结果

### 阶段 1: 初始化图数据

```text
initGraphData(repoPath, forceAnalyze) → GraphStatus
```

职责：
- 检查图数据库是否已存在
- 如果不存在或 `forceAnalyze` 为 true，运行完整分析
- 如果已存在且不需要强制，跳过
- 返回图状态（节点数、边数、分析时间等）

GraphStatus 定义：

```typescript
interface GraphStatus {
  status: 'created' | 'reused' | 'reanalyzed';
  nodeCount: number;
  edgeCount: number;
  analyzedAt: string;        // ISO 时间戳
  analysisDuration?: number; // 毫秒
}
```

约束：
- 只调用一次，不重复初始化
- 如果分析失败，抛出错误，不继续后续阶段
- 不依赖任何流水线（DB/Capability 的图初始化逻辑统一收归这里）

### 阶段 2: 初始化目录体系

```text
initDirectoryStructure(outputRoot) → PackageLayout
```

职责：
- 清空旧的 `bootstrap-knowledge/`（安全校验：basename 必须是 `bootstrap-knowledge`）
- 创建新目录骨架
- 返回布局描述

PackageLayout 定义：

```typescript
interface PackageLayout {
  packageRoot: string;       // {outputRoot}/bootstrap-knowledge
  objectsDir: string;        // {packageRoot}/objects
  sharedDir: string;         // {packageRoot}/objects/_共享
  evidenceDir: string;       // {packageRoot}/evidence
  reportsDir: string;        // {packageRoot}/reports
  catalogPath: string;       // {packageRoot}/catalog.yaml
}
```

约束：
- 清空操作必须有 basename 安全检查
- 只创建目录骨架，不写入任何知识文件
- `catalog.yaml` 在此阶段不创建（后续阶段写入）
- 域目录（`objects/{域名}/`）在此阶段不创建（因为还不知道有哪些域）

### 整体流程

```text
runGenerate(options)
  ├─ resolveParams(options)
  │    ├─ resolveTargetRepo()
  │    ├─ resolveGenerateScope()
  │    └─ resolveModelConfig()
  │
  ├─ Step 1a: initGraphData(repoPath, forceAnalyze)
  │    └─ 返回 GraphStatus，打印图状态摘要
  │
  ├─ Step 1b: initDirectoryStructure(outputRoot)
  │    └─ 返回 PackageLayout，打印目录结构
  │
  ├─ (后续步骤) 知识生成流水线
  │    ├─ runDbPipeline()  — 使用已初始化的图数据
  │    └─ runCapabilityPipeline()  — 使用已初始化的图数据
  │
  └─ (后续步骤) 写入知识文件
       └─ 使用 PackageLayout 写入文件到正确位置
```

### 与现有代码的映射

| 现有位置 | 改造方式 |
|---|---|
| `src/cli/generate.ts` 第 154 行 `ensureIndex()` | 移到 Step 1a |
| `src/knowledge/db-knowledge-pipeline.ts` 中的 `prepareKnowledgeGeneration()` | 移到 Step 1a |
| `src/packaging/knowledge-package-writer.ts` 中的 `fs.rm()` + `fs.mkdir()` | 移到 Step 1b |
| `src/query/index-service.ts` 的 `ensureIndex()` / `hasIndex()` | 保持不变，被 Step 1a 调用 |

### 不改动

- 图分析引擎（`src/engine/`）不变
- 索引服务（`src/query/index-service.ts`）不变
- 知识生成流水线逻辑不变（后续步骤改）
- catalog.yaml 格式不变（后续步骤改）
- 知识对象格式不变（后续步骤改）

## Step 1 Plan

### Task 1: 新增 `initGraphData()` 函数

位置：`src/knowledge/init-graph.ts`（新文件）

实现要点：
- 调用 `hasIndex(repoPath)` 检查索引是否存在
- 如果存在且 `forceAnalyze` 为 false → 返回 `{ status: 'reused', ... }`
- 如果不存在或 `forceAnalyze` 为 true → 调用 `runAnalysis(repoPath)` → 返回 `{ status: 'created' | 'reanalyzed', ... }`
- 查询 LadybugDB 获取 nodeCount 和 edgeCount
- 记录分析耗时

### Task 2: 新增 `initDirectoryStructure()` 函数

位置：`src/knowledge/init-directory.ts`（新文件）

实现要点：
- 构造 `packageRoot = path.resolve(outputRoot, 'bootstrap-knowledge')`
- basename 安全检查（必须是 `bootstrap-knowledge`）
- `fs.rm(packageRoot, { recursive: true, force: true })`
- 创建目录骨架：
  - `{packageRoot}/objects/`
  - `{packageRoot}/objects/_共享/`
  - `{packageRoot}/evidence/`
  - `{packageRoot}/reports/`
- 返回 `PackageLayout`

### Task 3: 改造 `runGenerate()` 入口

位置：`src/cli/generate.ts`

改动：
- 在 `runGenerateOrchestration()` 之前，插入 Step 1a 和 Step 1b
- 将 `GraphStatus` 和 `PackageLayout` 传入 orchestration
- 打印初始化状态日志

改动前：

```text
runGenerate()
  ├─ resolveParams
  └─ runGenerateOrchestration()
       ├─ ensureIndex()     ← 图初始化在内部
       ├─ runDb / runCap
       └─ writePackage()    ← 目录创建在内部
```

改动后：

```text
runGenerate()
  ├─ resolveParams
  ├─ initGraphData()        ← 新增：显式图初始化
  ├─ initDirectoryStructure() ← 新增：显式目录初始化
  └─ runGenerateOrchestration()
       ├─ runDb / runCap    ← 不再做图初始化
       └─ writePackage()    ← 不再创建目录，只写文件
```

### Task 4: 改造 `generate-orchestrator.ts`

位置：`src/knowledge/generate-orchestrator.ts`

改动：
- `GenerateOrchestrationInput` 新增 `graphStatus` 和 `layout` 字段
- 移除 `runDb` / `runCapability` 内部的图初始化调用
- `writePackage` 不再清空目录，直接使用 `layout` 写入文件

### Task 5: 改造 `runDbKnowledgePipeline()`

位置：`src/knowledge/db-knowledge-pipeline.ts`

改动：
- 移除 `prepareKnowledgeGeneration()` 调用（图数据已由 Step 1a 初始化）
- 新增 `graphStatus` 入参，复用已有索引

### Task 6: 改造 capability 入口

位置：`src/cli/generate.ts` 的 `runCapability` 闭包

改动：
- 移除第 154 行的 `ensureIndex()` 和第 155-157 行的 `hasIndex()` 检查
- 图数据已由 Step 1a 初始化

### Task 7: 改造 `writeKnowledgePackage()`

位置：`src/packaging/knowledge-package-writer.ts`

改动：
- 移除 `fs.rm()` 和 `fs.mkdir(packageRoot)` 调用
- 接受 `PackageLayout` 参数，使用已创建的目录
- 写入文件时仍用 `fs.mkdir(path.dirname(fullPath), { recursive: true })` 保证子目录存在（因为域目录在写入时才创建）

### Task 8: 更新测试

- 为 `initGraphData()` 编写单元测试（mock `hasIndex` 和 `runAnalysis`）
- 为 `initDirectoryStructure()` 编写单元测试（验证目录骨架、basename 安全检查）
- 更新 `generate-orchestrator` 相关测试
- 更新 `knowledge-package-writer` 相关测试

### Task 9: 更新文档

- 更新 `AGENTS.md` 中 generate 命令的流程描述
- 更新 `CLAUDE.md` 中的相关说明

## 验证方式

1. `npm run typecheck` — 类型检查通过
2. `npm run build` — 构建通过
3. `npm test` — 所有测试通过
4. 手动验证：
   - 运行 `generate --knowledge capability --model test-mock` 到一个测试仓库
   - 确认 `bootstrap-knowledge/` 目录结构正确
   - 确认图数据只初始化一次（日志中无重复分析）
   - 确认目录骨架在知识生成之前创建
