# database slice 先构建图数据设计

## 背景

当前 `generate --slice database:<table>` 的主流程里，存在一条显式分支：

- 若当前是 `database-only slice`
- 则跳过 `ensureIndex(...)`

代码位置在：

- [src/cli/generate.ts](</D:/workspace/ai-wiki/src/cli/generate.ts>)

当前逻辑明确写了：

- `For database-only slices, we can skip the embedded engine entirely`

这导致一个结果：

- 用户执行：

```powershell
rkg generate --slice database:user --llm-config .\llm.config.json
```

时，即使目标仓库还没有图数据，也不会先做 embedded analyze / index

而是直接走：

- MyBatis 解析
- DB bundle 组装
- LLM 生成

这和用户预期不一致。用户希望：

- 即使只生成单表 DB 知识
- 也应先保证图数据已建立

因为后续 DB 知识、caller 关系、代码上下文、以及其它知识对象都应该建立在统一图索引之上。

## 目标

调整 `generate --slice database:<table>` 的行为：

- 不再跳过图数据构建
- 默认先确保目标仓库 embedded index 已存在
- 若索引不存在，则先分析
- 若索引已存在，则复用现有索引
- 若传 `--force-analyze`，则显式重建索引

## 非目标

本次不做：

- 改 DB 对象 schema
- 改 LLM prompt
- 改日志结构
- 改 `bootstrap-knowledge/` 目录结构
- 改 companion `music-education-core` 的发现逻辑

## 现状问题

当前的 special case 带来 3 个问题：

### 1. 行为不一致

普通 `generate` 会先建立图数据，再做知识生成。  
但 `database-only slice` 会绕过这一步。

这让用户很难理解：

- 为什么有的命令会先分析
- 有的却不会

### 2. 语义不一致

项目定位是：

- 内嵌解析引擎
- 统一图数据
- 再基于图数据和代码证据生成知识

但 `database-only slice` 现在相当于：

- 绕过统一索引层
- 直接走局部证据提取

这破坏了整体架构的一致性。

### 3. 不利于后续 DB 能力增强

后续如果要让 DB 知识更多依赖图关系，例如：

- table -> mapper method
- mapper method -> caller service
- caller -> route/process

那么 `database-only slice` 也应该建立在已存在的图数据之上。

## 设计原则

### 1. generate 的索引前置行为必须统一

不应再根据 slice 类型决定“要不要建图”。  
`generate` 的统一前置条件应该是：

- 先确保目标仓库 index 可用

### 2. 单表生成只缩小知识生成范围，不缩小索引前置条件

`--slice database:<table>` 的意义应该是：

- 只生成这一张表的知识对象

而不是：

- 切换成一条绕过索引层的特殊执行路径

### 3. 保持增量友好

本次不要求每次都强制重建索引。  
应遵循：

- 有索引：直接复用
- 无索引：自动构建
- `--force-analyze`：强制重建

## 方案选择

### 方案 A：保留当前跳过逻辑

- 优点：单表启动更快
- 缺点：不满足用户预期，破坏架构一致性

不采用。

### 方案 B：database slice 也统一走 ensureIndex

- 优点：
  - 行为一致
  - 符合“先建图后生成知识”的心智模型
  - 有利于后续 DB 上下文增强
- 缺点：
  - 单表生成前置步骤会变长

采用本方案。

### 方案 C：默认跳过，但加 `--with-index`

- 优点：保留速度
- 缺点：命令面复杂，用户心智负担高

不采用。

## 行为设计

当前：

```ts
const isDatabaseOnly = sliceFilter?.kind === 'database' && sliceFilter.target.length > 0;

if (!mockMode && !isDatabaseOnly) {
  await ensureIndex(repoPath, { force: options.forceAnalyze });
}
```

调整为：

- 取消 `database-only` 的跳过分支
- 统一改成：

```ts
if (!mockMode) {
  await ensureIndex(repoPath, { force: options.forceAnalyze });
}
```

## companion repo 行为

本次先不扩展到自动为 companion repo 单独建索引。

原因：

- 当前用户问题聚焦在“主仓库为什么没先建图”
- companion repo 的实体/调用证据目前仍可保持现有策略

也就是说：

- 这次只保证目标 `--repo` 对应仓库先建图

## 日志与输出

不需要新增新格式。  
但执行日志中应该能体现：

- 是否检测到现有 index
- 是否触发了 analyze
- 是否因为 `--force-analyze` 重建

使用现有 logger 即可。

## 验证要求

至少验证：

1. 对一个尚未建立索引的仓库执行：

```powershell
rkg generate --slice database:user --llm-config .\llm.config.json
```

应先建立图数据，再生成 DB 知识。

2. 对一个已有索引的仓库执行同样命令：

- 不重复重建
- 直接进入生成

3. 传 `--force-analyze` 时：

- 即使已有索引，也会先重建

4. `music-education-app` 或 `music-education-admin` 的单表生成不回退

## 验收标准

满足以下条件即算完成：

- `database-only slice` 不再绕过 `ensureIndex`
- `generate` 对所有 slice 类型的索引前置行为一致
- 单表 DB 生成仍可用
- `--force-analyze` 对 database slice 生效
