# OpenAI-Compatible Streaming Design

## 背景

当前项目的大模型调用仍然是一次性非流式请求。

直接证据在：

- [src/generation/llm-client.ts](/D:/workspace/ai-wiki/src/generation/llm-client.ts)

当前实现：

- 使用 `client.chat.completions.create(...)`
- 不传 `stream: true`
- 等完整响应返回后一次性取 `response.choices[0].message.content`

这会带来几个问题：

1. 首 token 延迟不可见
2. 流式 provider 无法被充分利用
3. 长响应中途失败时，没有部分响应与过程证据
4. 日志只能记录最终文本，无法记录流式阶段的时间与事件

## Claude-Code 调查结论

`D:\workspace\Claude-Code` 的真实流式调用并不是“外层 UI 模拟流”，而是 API 调用层直接开启流式。

关键证据：

- [src/services/api/claude.ts:1822](/D:/workspace/Claude-Code/src/services/api/claude.ts:1822)
  - `anthropic.beta.messages.create({ ...params, stream: true }, ...).withResponse()`
- [src/services/api/claude.ts:752](/D:/workspace/Claude-Code/src/services/api/claude.ts:752)
  - `queryModelWithStreaming(...)` 定义为 `async generator`
- [src/services/api/claude.ts:863](/D:/workspace/Claude-Code/src/services/api/claude.ts:863)
  - 出现非流式 fallback：`anthropic.beta.messages.create(...)`
- [src/services/api/claude.ts:2350](/D:/workspace/Claude-Code/src/services/api/claude.ts:2350)
  - 流式空响应触发 fallback
- [src/services/api/claude.ts:2464](/D:/workspace/Claude-Code/src/services/api/claude.ts:2464)
  - 流式错误时支持 fallback 到非流式
- [src/services/api/claude.ts:2607](/D:/workspace/Claude-Code/src/services/api/claude.ts:2607)
  - 流式端点 404 时 fallback 到非流式

从这个实现可以提炼出 3 个对本项目最有价值的原则：

1. `streaming-first`
   - 默认优先流式
2. `same final contract`
   - 上层仍然拿到完整文本，不要求上层全部改成事件驱动
3. `fallback-safe`
   - 流式失败时可安全回退到非流式

## 目标

为当前项目增加 **OpenAI-compatible 流式调用能力**，并满足：

1. 默认使用流式调用
2. 维持当前上层调用接口基本稳定
3. 流式不支持或失败时回退到非流式
4. 调试日志中记录流式阶段信息
5. 不改变 `bootstrap-knowledge` 的对象 schema 和包结构

## 非目标

这次不做：

1. 不改对象生成 prompt 设计
2. 不改 `DB / CON / FLOW / MOD / TERM` schema
3. 不把整个生成链重写成实时 UI 输出
4. 不引入新的 provider 抽象层
5. 不把调用从 `chat.completions` 切到 `responses` API

原因：

- 当前项目已基于 `chat.completions` 和 OpenAI-compatible 网关稳定工作
- 第一阶段最稳的做法是：**在现有 API 面上加 streaming**

## 设计总览

### 当前状态

当前调用链：

`generate.ts -> generateWithClient() -> chat.completions.create() -> string`

### 目标状态

改为：

`generate.ts -> generateWithClient() -> stream-first wrapper -> final string`

也就是：

- 上层 `generate.ts` 不直接感知 provider 的 stream 细节
- `llm-client.ts` 内部负责：
  - 发起流式请求
  - 累积 chunk
  - 拼成最终文本
  - 记录 streaming metadata
  - 必要时 fallback 到非流式

## 新的调用契约

### 现有函数

当前：

```ts
generateWithClient(
  client,
  model,
  systemPrompt,
  userPrompt,
): Promise<string>
```

### 目标

保留上层简单用法，但底层返回更丰富结果。

建议新增：

```ts
interface LlmGenerationResult {
  text: string;
  mode: 'streaming' | 'non_streaming_fallback';
  startedAt: string;
  firstChunkAt?: string;
  finishedAt: string;
  durationMs: number;
  chunks: number;
  streamError?: string;
}
```

新的主函数：

```ts
generateWithClient(
  client,
  model,
  systemPrompt,
  userPrompt,
): Promise<LlmGenerationResult>
```

这样做的原因：

- 当前 `generate.ts` 已经有完整的 debug trace 结构
- 它需要的不再只是最终文本，还需要知道：
  - 是流式还是 fallback
  - 花了多久
  - 有没有首 chunk
  - 中途是否流式失败

## 流式实现策略

### 方案选择

本项目第一阶段只实现：

- `chat.completions.create({ stream: true })`

不切到 `responses.stream()`。

原因：

1. 现有 provider 是 OpenAI-compatible
2. 当前代码已经基于 `chat.completions`
3. 迁移成本最小
4. 与现有 prompt / 输出解析兼容

### 流式读取方式

`openai` SDK 的 chat completion stream 通常可作为 async iterable 消费。

第一阶段按这种模式实现：

```ts
const stream = await client.chat.completions.create({
  model,
  messages,
  temperature: 0,
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? '';
  // accumulate
}
```

### chunk 累积

累积规则：

1. 只拼接文本 delta
2. 忽略空 chunk
3. 记录：
   - 开始时间
   - 第一块到达时间
   - 最终结束时间
   - chunk 数量
4. 最终拼成 `text`

## fallback 设计

### 为什么需要 fallback

OpenAI-compatible 网关常见情况：

1. 支持非流式，不支持流式
2. 流式端点实现不完整
3. 网关空流结束
4. 中途断流
5. provider 限流或 404/5xx

所以需要模仿 Claude-Code 的核心策略：

- **streaming-first**
- **non-streaming fallback**

### 触发 fallback 的条件

第一阶段建议只覆盖这些明确条件：

1. 流式请求抛异常
2. 流式成功建立但没有任何文本 chunk
3. 流式返回结束后拼接文本为空

### fallback 行为

fallback 时重新发：

```ts
client.chat.completions.create({
  model,
  messages,
  temperature: 0,
})
```

并返回：

- `mode: 'non_streaming_fallback'`
- `streamError`

### 不做的高级策略

这次不做：

1. 流式 idle timer
2. 中途 stall 检测
3. chunk 级 timeout instrumentation
4. provider-specific 404 heuristics

这些可以后续再加。

## 与当前日志系统的集成

当前项目已有：

- `.knowledge/<repoId>/<YYYY-MM-DD>.log`

并记录：

- request system/user prompt
- response raw text
- parsed output
- validation result

### 这次要新增的日志字段

每个 slice trace 新增：

```ts
response: {
  rawText?: string;
  parsedOutput?: unknown;
  warnings?: unknown[];
  llm?: {
    mode: 'streaming' | 'non_streaming_fallback';
    startedAt: string;
    firstChunkAt?: string;
    finishedAt: string;
    durationMs: number;
    chunks: number;
    streamError?: string;
  };
}
```

### 日志目标

这样后续排查时能回答：

1. provider 有没有真的进入 streaming
2. 首 chunk 用了多久
3. 总耗时多久
4. 是否 fallback
5. fallback 原因是什么

## 对 `generate.ts` 的影响

`generate.ts` 这次只做最小改动：

1. 接收 `LlmGenerationResult`
2. `rawText` 改成 `result.text`
3. `trace.response` 写入 `llm` 元数据
4. 其余对象解析、schema 校验、落盘流程不变

也就是说：

- streaming 只替换 LLM 调用层
- 不改对象构建主链

## CLI 与配置

第一阶段不强制新增新参数，但建议支持一个可选开关：

- `streaming?: boolean`

优先级：

1. CLI 参数
2. `llm.config.json`
3. 默认 `true`

原因：

- 有些 OpenAI-compatible provider 虽然号称兼容，但 streaming 实际不可用
- 需要允许用户快速关闭 streaming

如果要最小化实现，也可以第一阶段不暴露 CLI 参数，只在代码里默认启用 streaming 并自动 fallback。

## 验证范围

这次实现后的最小验证应覆盖：

1. mock / test model 路径不回退
2. 真正的 OpenAI-compatible provider 流式路径可走通
3. 流式失败时能 fallback
4. 最终对象生成结果与当前非流式路径等价

### 重点回归对象

继续用这 3 张真实表：

- `auth_menu`
- `mall_category`
- `music_user`

验证方式：

1. 跑单表 `generate --slice database:<table>`
2. 检查对象能成功落盘
3. 检查 `.knowledge/<repoId>/<date>.log`
   - 能看到 streaming 元数据
   - 若 fallback，能看到原因

## 验收标准

实现完成后，以下条件同时满足才算通过：

1. `generateWithClient` 默认优先流式调用
2. 上层仍能拿到完整文本并正常 parse
3. 流式失败时自动 fallback 到非流式
4. debug 日志能明确区分：
   - streaming success
   - non-streaming fallback
5. 三张真实表单表生成不回退

## 风险

### 1. OpenAI-compatible streaming 事件格式差异

不同网关可能：

- chunk 结构不同
- 结束方式不同
- 空 delta 较多

缓解：

- 第一阶段只读取 `choices[0].delta.content`
- 为空就跳过

### 2. fallback 双重调用带来额外成本

流式失败后再非流式，会多一次请求成本。

缓解：

- 在日志里明确记录 fallback
- 先只在失败时才 fallback

### 3. 当前日志体积进一步变大

流式元数据加入后日志会更丰富。

缓解：

- 只记录聚合元数据，不记录每个 chunk 全量内容

## 结论

这次应当把当前项目的 LLM 层改成：

- **流式优先**
- **结果仍返回完整文本**
- **失败自动回退非流式**
- **日志记录 streaming/fallback 元数据**

这样既能借鉴 `Claude-Code` 的成熟模式，又不会把当前项目一次性改成复杂的事件驱动架构。
