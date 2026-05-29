# Knowledge Read Runtime Hardening Design

## 背景

`Knowledge Agent Read Runtime` 已经实现了第一版 LangGraph skeleton：

- `src/agent-read-runtime/graph-runtime.ts`
- `src/agent-read-runtime/local-read-tools.ts`
- `src/agent-read-runtime/context-budget.ts`
- `src/agent-read-runtime/trace.ts`
- `tests/unit/agent-read-runtime/*`

当前验证结果：

- `npm run typecheck` 通过
- `npm run build` 通过
- `npm test` 通过

但代码审查发现，当前实现还不能作为稳定补读 runtime 使用。它已经具备模块边界和基础工具，但关键失败路径没有闭环。

## 发现的问题

### 1. 预算耗尽路径不能产生结构化终态

当前流程中，工具调用后如果预算耗尽，graph 会路由到 `output_validate`。但 `output_validate` 只是透传 state，且此时 `finalText` 可能为空。

结果是：

- graph 结束后从最后一条 `ToolMessage` 取文本
- `parseKnowledgeReadAgentOutput()` 尝试把工具输出解析成 JSON
- 运行时抛出 `Agent output is not valid JSON`

这违反了目标：预算耗尽时应返回可控的 `insufficientEvidence: true` 结果。

### 2. 输出修复节点没有实现

当前 state 中有 `repairAttempts`，但没有 `repair_output` 节点。

结果是：

- 模型输出非 JSON 时直接失败
- schema 不匹配时直接失败
- `withRetry()` 包住的是 graph 调用，不会修复 graph 结束后的 parse 错误

这违反了目标：最终 JSON 解析失败时允许一次修复。

### 3. 搜索工具边界过宽

`search_repo_text` 会递归遍历仓库下所有非 `node_modules` / `.git` / `dist` 文件，并按 UTF-8 读取。

风险：

- 读取大文件导致慢或内存压力
- 二进制文件被当作文本尝试读取
- 没有遵守项目 ignore 规则
- 搜索范围比第一阶段需要的更宽

### 4. Trace 与预算统计口径不一致

`BudgetState.totalToolResultChars` 只记录被接受的工具结果文本。

`KnowledgeReadTrace.totalToolResultChars` 统计所有 tool event 的 `returnedChars`，包括预算错误字符串。

结果是 trace 不能作为预算审计的可靠来源。

### 5. Graph 级行为测试不足

现有测试覆盖：

- parser helper
- route helper
- local tool handler
- budget helper
- trace helper

缺失：

- 完整 graph 的模型工具调用循环
- 工具调用后预算耗尽的终态
- 非 JSON 输出修复
- schema 错误修复

## 目标

本轮 hardening 目标：

1. 预算耗尽时返回合法 `KnowledgeReadResult`
2. 最终输出非法时进入一次修复节点
3. 搜索工具只读取安全、有限、文本化的文件
4. Trace 与预算统计口径一致
5. 增加 graph 级单元测试，覆盖真实状态流转

## 非目标

本轮不做：

1. 不接入业务知识对象生成
2. 不增加 MCP
3. 不增加 `deepagents`
4. 不增加 shell 执行能力
5. 不引入长期 memory
6. 不实现 graph checkpoint 持久化
7. 不把文本搜索升级为完整代码索引查询

## 目标架构调整

当前 graph：

```text
START
  -> model_decide
  -> tool_execute
  -> budget_check
  -> output_validate
  -> END
```

调整后 graph：

```text
START
  -> model_decide
  -> tool_execute
  -> budget_check
  -> force_insufficient_output
  -> output_validate
  -> repair_output
  -> END
```

### 节点语义

`model_decide`

- 调用模型
- 如果模型请求工具，进入 `tool_execute`
- 如果模型返回最终文本，进入 `output_validate`

`tool_execute`

- 执行允许的本地只读工具
- 将工具 observation 写回 messages
- 更新 trace 和预算

`budget_check`

- 如果预算仍可用，回到 `model_decide`
- 如果预算耗尽且没有 `finalText`，进入 `force_insufficient_output`
- 如果已有 `finalText`，进入 `output_validate`

`force_insufficient_output`

- 不再调用模型
- 生成一个合法 JSON 字符串：

```json
{
  "answer": "Evidence budget was exhausted before enough evidence could be confirmed.",
  "evidence_refs": [],
  "insufficient_evidence": true
}
```

`output_validate`

- 解析 `finalText`
- schema 通过则进入 `END`
- schema 失败且未修复过则进入 `repair_output`
- schema 失败且已修复过则抛出结构化错误

`repair_output`

- 调用模型一次
- 输入原始输出和 schema 错误
- 要求只返回合法 JSON
- 然后回到 `output_validate`

## Graph 状态调整

建议扩展 state：

```ts
interface GraphRuntimeState {
  messages: Array<HumanMessage | AIMessage | ToolMessage>;
  finalText?: string;
  parsedOutput?: KnowledgeReadAgentOutput;
  validationError?: string;
  budgetExceeded: boolean;
  repairAttempts: number;
}
```

最终 `runKnowledgeReadRuntime()` 不再在 graph 外调用 `parseKnowledgeReadAgentOutput(finalText)`。

它应从最终 state 读取 `parsedOutput`，再转换为 `KnowledgeReadResult`。

## 搜索工具边界

新增文件过滤策略：

1. 跳过目录：
   - `.git`
   - `node_modules`
   - `dist`
   - `build`
   - `coverage`
   - `.knowledge`
   - `bootstrap-knowledge`

2. 跳过大文件：
   - 默认 `maxSearchFileBytes: 512_000`

3. 跳过明显二进制扩展：
   - `.png`
   - `.jpg`
   - `.jpeg`
   - `.gif`
   - `.webp`
   - `.ico`
   - `.pdf`
   - `.zip`
   - `.gz`
   - `.exe`
   - `.dll`
   - `.wasm`

4. 读取前检查 `stat.size`

5. 读取后如果包含 `\0`，视为二进制并跳过

本轮不要求完整解析 `.gitignore`。后续如要更严格，可接入现有 `src/config/ignore-service.ts`。

## Trace 口径

Trace 应明确区分：

- `returnedChars`
  - 实际返回给模型的文本长度

- `acceptedBudgetChars`
  - 计入预算的字符数

`KnowledgeReadTrace.totalToolResultChars` 应来自 `acceptedBudgetChars` 汇总，而不是 `returnedChars`。

## 测试策略

### 单元测试

继续保留已有 helper 测试。

新增测试：

1. `force_insufficient_output`
   - 输入预算耗尽 state
   - 输出合法 JSON
   - `insufficient_evidence = true`

2. `validate_output`
   - 合法 JSON -> 产生 `parsedOutput`
   - 非 JSON -> 产生 `validationError`

3. `route_after_validation`
   - 有 `parsedOutput` -> `END`
   - 有 `validationError` 且 `repairAttempts = 0` -> `repair_output`
   - 有 `validationError` 且 `repairAttempts = 1` -> 抛错或 failed

4. 搜索工具跳过大文件和二进制文件

5. trace 汇总使用 `acceptedBudgetChars`

### Graph 级测试

增加一个可注入 fake model 的 graph runner，至少覆盖：

1. 模型先请求工具，再返回合法 JSON
2. 模型一直请求工具直到预算耗尽，runtime 返回 `insufficientEvidence: true`
3. 模型先返回非 JSON，repair 后返回合法 JSON

为了测试可控，`runKnowledgeReadRuntime()` 应拆出内部构建函数，允许传入 fake model：

```ts
export interface KnowledgeReadRuntimeDeps {
  model: RunnableLike;
}
```

对外 API 仍保持不变。

## 验收标准

完成后必须满足：

1. `npm run typecheck` 通过
2. `npm run build` 通过
3. `npm test` 通过
4. 新增 graph 级测试能证明预算耗尽不会抛 JSON parse 错误
5. 新增 graph 级测试能证明非 JSON 输出会修复一次
6. 搜索工具不会读取超过 `maxSearchFileBytes` 的文件
7. 搜索工具不会读取明显二进制文件
8. Trace 的 `totalToolResultChars` 与预算接受字符数一致

