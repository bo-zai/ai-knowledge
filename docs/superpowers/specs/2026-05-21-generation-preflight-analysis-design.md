# 知识生成命令统一前置图数据检查设计

## 背景

上一版修复只针对：

- `generate --slice database:<table>`

去讨论是否跳过 `ensureIndex(...)`。

这个范围太窄，不符合真实使用预期。  
用户的目标不是“修一个 database slice 特判”，而是：

- **执行任何知识生成命令前，都先检查目标仓库是否已经生成图数据**
- **若没有，则先生成图数据**
- **再执行实际知识生成操作**

这意味着，真正应该设计的是：

- **知识生成前置阶段（preflight analysis check）**

而不是只修某个 slice 分支。

## 目标

为所有“生成知识”的命令建立统一前置规则：

1. 先解析目标仓库
2. 检查是否已有可用图数据
3. 若无图数据，则先执行分析/建图
4. 若已有图数据，则复用
5. 若显式要求强制重建，则重建
6. 在上述步骤完成后，才进入知识生成

## 非目标

本次不做：

- 修改 DB 对象 schema
- 修改 LLM prompt
- 修改知识包目录结构
- 修改日志文件格式
- 为 companion repo 设计新的多仓分析协议

## 现状问题

当前 `generate` 主流程里，前置图数据检查不是统一策略，而是嵌在局部分支里：

- 有些路径会先 `ensureIndex(...)`
- 有些路径会绕过它

这带来的问题是：

### 1. 行为分散

是否先建图，不是由“命令是否进入知识生成”决定，而是由某个 slice 分支决定。  
这会让行为不可预测。

### 2. 架构不一致

系统定位应该是：

- 先有统一图数据
- 再基于图数据和代码证据生成知识

但当前某些路径绕过统一前置步骤，破坏了这个边界。

### 3. 后续扩展困难

以后无论生成：

- DB
- FLOW
- CON
- MOD
- TERM

都应共享同一套“目标仓库索引状态检查”流程。  
如果继续把逻辑散在 slice 分支里，后面每加一种生成路径都会重复犯同样的问题。

## 设计原则

### 1. 生成前检查应按“命令级”而非“slice级”

是否需要先检查图数据，应该由：

- “当前命令是否执行知识生成”

来决定，而不是由：

- “当前生成哪一类 slice”

来决定。

### 2. 图数据检查必须成为统一 preflight

知识生成命令进入主生成逻辑前，必须先经过一个统一 preflight 阶段。

### 3. slice 只影响生成范围，不影响前置条件

`--slice database:auth_menu` 的意义应该只是：

- 只生成 `auth_menu` 的知识

而不是：

- 切换成一条不同的前置执行路径

### 4. 继续支持索引复用

前置检查不等于每次强制重建。  
应保持：

- 已有索引：复用
- 无索引：自动建立
- `--force-analyze`：强制重建

## 方案选择

### 方案 A：保留现有按 slice 分支决定是否建图

- 优点：局部改动少
- 缺点：继续维持不一致行为

不采用。

### 方案 B：把 `ensureIndex(...)` 抬升为 generate 统一 preflight

- 优点：
  - 规则一致
  - 命令行为可预测
  - 后续扩展更自然
- 缺点：
  - 单表生成前可能会多一次索引检查

采用本方案。

### 方案 C：引入单独 `prepare` 命令，由用户先手动执行

- 优点：显式
- 缺点：增加用户负担，不符合“一条命令直接生成”的体验

不采用。

## 设计结果

## 统一 preflight 阶段

为所有知识生成命令建立统一前置阶段，例如：

```text
resolve target repo
-> preflight analysis check
-> slice discovery / evidence build
-> object generation
-> package write
```

### preflight analysis check 的职责

输入：

- `repoPath`
- `forceAnalyze`
- `mockMode`

输出：

- `analysisState`
  - `reused`
  - `created`
  - `rebuilt`
  - `skipped_for_mock`

### 规则

1. 若 `mockMode`，允许跳过
2. 否则：
   - 先检查索引是否存在
   - 无索引时自动建图
   - 有索引时复用
   - `--force-analyze` 时强制重建

## 作用范围

本次规则覆盖：

- 当前 `generate` 命令

并要求实现方式可复用，便于将来若新增其它知识生成命令时，直接复用同一个 preflight。

## 建议实现边界

不要继续把 `ensureIndex(...)` 直接散写在 `runGenerate(...)` 的具体分支里。  
应提取一个统一能力，例如：

- `prepareKnowledgeGeneration(...)`
- 或 `ensureAnalysisReady(...)`

建议放在：

- `src/query/`
- 或 `src/shared/`

但必须是：

- 结构化返回
- 不依赖 slice 类型判断

## generate 命令的新行为

进入 `runGenerate(...)` 后：

1. 解析 repo
2. 执行 preflight analysis check
3. 记录分析状态
4. 再继续：
   - build db bundles
   - discover slices
   - generate objects

也就是说：

- `database-only slice`
- `route slice`
- `full generate`

都先经过同一前置检查。

## 日志要求

不要求改日志文件结构，但至少应通过现有 logger 输出：

- 是否检测到现有图数据
- 是否复用
- 是否新建
- 是否因 `--force-analyze` 重建

这样用户手动执行时能明确看到：

- “现在是在先检查图数据”
- “而不是直接开始生成”

## 验证要求

至少验证以下几种情况：

1. 无索引仓库执行：

```powershell
generate --slice database:auth_menu
```

应先建图，再生成。

2. 有索引仓库执行：

```powershell
generate --slice database:auth_menu
```

应复用已有图数据，再生成。

3. 全量生成执行：

```powershell
generate
```

同样先做图数据检查。

4. `--force-analyze` 执行：

应先重建图数据，再生成。

## 验收标准

满足以下条件即算完成：

- 任何知识生成命令在进入生成主逻辑前，都先执行统一图数据检查
- 不再由 slice 分支决定是否建图
- 现有 `generate` 命令行为一致化
- 单表和全量生成都不回退
