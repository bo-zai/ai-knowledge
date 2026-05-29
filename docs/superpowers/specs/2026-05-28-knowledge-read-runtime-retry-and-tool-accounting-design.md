# Knowledge Read Runtime Retry And Tool Accounting Design

## 背景

`Knowledge Read Runtime` hardening 后，已经补齐：

- 预算耗尽时返回结构化 `insufficientEvidence: true`
- 输出校验和一次 repair
- 搜索文件边界
- trace 与预算统计口径
- graph 级 fake model 测试

验证结果：

- `npm run typecheck` 通过
- `npm run build` 通过
- `npm test` 通过

代码审查仍发现两个剩余风险：

1. schema validation 失败会被 `withRetry()` 包住，导致整个 graph 重跑
2. unknown tool 调用不进入预算和 trace

这两个问题都属于 runtime 控制边界，不涉及业务知识生成。

## 问题 1：Validation Failure 会触发整图重试

当前 `runKnowledgeReadRuntime()` 用 `withRetry()` 包住整个 `graph.invoke(...)`。

当模型输出非法 JSON，且一次 repair 后仍然非法时，`failed` node 抛错。这个错误会被 `withRetry()` 捕获，导致整个 graph 重新执行。

风险：

- 同一错误可能重复跑 3 次
- 工具调用可能重复执行
- 成本和 trace 膨胀
- “只 repair 一次”的语义被整图重试弱化

目标行为：

- provider/network/transient model 调用错误可以重试
- schema validation terminal failure 不应整图重试
- repair 失败后应直接返回一个明确错误

## 问题 2：Unknown Tool 不计入预算和 Trace

当前模型请求未知工具时，runtime 返回 `unknown tool: name` 的 `ToolMessage`。

但 unknown tool 不经过 `recordToolCall()`：

- 不消耗 `maxToolCalls`
- 不进入 trace
- 模型若持续请求未知工具，只能依赖 LangGraph recursion limit 停止

目标行为：

- 每个模型发出的 tool call 都必须进入预算
- unknown tool 也必须进入 trace
- unknown tool 应返回可恢复 observation
- 超过 `maxToolCalls` 后进入 `force_insufficient_output`

## 目标

本轮目标：

1. 将 schema validation failure 标记为不可重试错误
2. 避免 `withRetry()` 重跑整个 graph 的 deterministic validation failure
3. unknown tool 调用消耗工具预算
4. unknown tool 调用写入 trace
5. 增加测试覆盖这两个行为

## 非目标

本轮不做：

1. 不改知识对象生成链路
2. 不引入 MCP
3. 不新增工具类型
4. 不重构所有 retry 策略
5. 不实现 LangGraph checkpoint
6. 不改变 public `runKnowledgeReadRuntime(input)` API

## 设计

### Runtime Validation Error

新增错误类型：

```ts
export class KnowledgeReadValidationError extends Error {
  readonly retryable = false;
}
```

`failed` node 抛出该错误。

`runKnowledgeReadRuntime()` 不再直接使用当前 `withRetry()` 包住整个 graph，改为：

```ts
try {
  response = await withRetry(
    () => graph.invoke(...),
    { maxRetries: 3, delayMs: 1000, shouldRetry: isRetryableKnowledgeReadError },
  );
} catch (error) {
  if (error instanceof KnowledgeReadValidationError) {
    throw error;
  }
  throw error;
}
```

如果现有 `withRetry()` 不支持 `shouldRetry`，本轮不要扩展全局 `withRetry()`；在 `graph-runtime.ts` 内实现局部 helper：

```ts
async function retryGraphInvoke<T>(fn: () => Promise<T>): Promise<T>
```

该 helper 只在非 `KnowledgeReadValidationError` 时重试。

### Unknown Tool Accounting

新增 helper：

```ts
function recordUnknownToolCall(...)
```

行为：

- 先调用 `recordToolCall(budget)`
- 如果预算已满，返回预算错误文本
- 否则返回 `unknown tool: name`
- 记录 trace：
  - `toolName`: unknown tool name
  - `returnedChars`: observation 长度
  - `acceptedBudgetChars`: `0`
  - `error`: `unknown tool`

unknown tool 不计入 `totalToolResultChars`，因为没有产生有效证据，但它必须计入 `toolCallsUsed`。

## 验收标准

完成后必须满足：

1. repair 后仍非法 JSON 时，fake model 调用次数不超过 2 次
2. repair 后仍非法 JSON 时，抛出 `KnowledgeReadValidationError`
3. unknown tool 调用后 `toolCallsUsed` 增加
4. unknown tool 调用写入 trace
5. unknown tool 连续请求会被 `maxToolCalls` 截断并返回 `insufficientEvidence: true`
6. `npm run typecheck` 通过
7. `npm run build` 通过
8. `npm test` 通过

