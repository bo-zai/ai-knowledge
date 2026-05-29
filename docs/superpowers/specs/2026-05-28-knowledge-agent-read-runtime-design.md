# Knowledge Agent Read Runtime Design

## 背景

当前项目的知识对象生成链路已经具备基础结构：

- `src/cli/generate.ts` 负责生成编排
- `src/generation/object-generators/*` 负责不同对象类型的 prompt
- `src/evidence/*` 负责提取结构化证据
- `src/schemas/*` 负责运行时 schema 校验
- `src/packaging/*` 负责知识包落盘

现在的问题不在于是否能调用 LLM，而在于：知识对象需要基于目标仓库代码生成，直接把大量代码一次性塞给模型会超出上下文预算，也会让模型失焦。项目需要一层受控的 agent runtime，让模型在生成前能有限补读本地代码，但不能让模型自由扫描整个仓库或决定知识包结构。

## 外部参考结论

对 `D:\workspace\CmbCoworkAgent-main` 的调查显示，它不是纯自研 agent，也不是简单接入一个框架。它采用：

- `langchain.createAgent` 作为主 agent loop
- `deepagents` 提供 filesystem、subagent、skills、memory、summarization 等中间件
- `@langchain/langgraph` 提供图执行和 checkpoint 相关能力
- `@langchain/mcp-adapters` 接入 MCP
- 项目自定义大量 runtime glue code，例如沙箱、审批、hook、trace、MCP capability service

本项目不应照搬这套重 runtime。`ai-wiki` 当前只需要模型补读代码的基础能力，不需要桌面 coding agent 的完整能力。

## 目标

第一阶段实现一个 **Knowledge Agent Read Runtime**，用于支持 LLM 在受控范围内补读本地仓库代码。

目标能力：

1. 使用活跃开源框架承接 agent loop 和 tool calling
2. 提供本地只读工具，让模型按需读取代码证据
3. 限制工具调用次数、单次返回大小和累计上下文预算
4. 记录每次补读的输入、输出摘要、耗时和错误
5. 输出结构化结果，明确区分已获得证据和证据不足
6. 暂不接入具体业务知识对象生成，先把补读基础能力做稳定

## 非目标

第一阶段不做：

1. 不实现 MCP server
2. 不接入外部 MCP connector
3. 不引入 `deepagents`
4. 不实现 subagent
5. 不实现长期 memory
6. 不实现人工审批系统
7. 不提供写文件工具
8. 不提供 shell 执行工具
9. 不改变现有 `bootstrap-knowledge/` 包结构
10. 不把知识对象 schema 交给 LLM 决定

## 框架选择

### 选型

第一阶段使用 `@langchain/langgraph` 作为主 runtime。

建议依赖：

```json
{
  "dependencies": {
    "@langchain/core": "^1",
    "@langchain/langgraph": "^1",
    "@langchain/openai": "^1"
  }
}
```

项目已经使用 `zod`，本地工具 schema 继续使用现有 `zod`。

### 理由

选择 LangGraph 的原因：

1. 社区活跃度高，TypeScript 支持成熟
2. 本项目需要的是受控状态机，而不是开放聊天 agent
3. 补读流程天然包含 `模型决策 -> 工具执行 -> 预算检查 -> 输出校验 -> 修复/停止`
4. 预算、trace、失败分支和证据不足分支可以作为显式节点建模
5. 后续评测需要 replay、checkpoint、with/without/stale 对比，LangGraph 的状态模型更合适

### 为什么不用 `LangChain createAgent` 作为主入口

`LangChain createAgent` 适合快速构建预置 tool-calling agent，但本项目的核心要求是程序控制流程：

1. 每轮工具调用后必须检查预算
2. 输出不合法时必须进入修复节点
3. 证据不足必须进入明确终态
4. trace 需要按节点和工具调用稳定记录
5. 后续对象生成也会是多阶段 workflow

这些要求用 LangGraph 更直接。`createAgent` 可以作为未来局部工具，但第一阶段不作为主 runtime。

### 暂不选择的内容

暂不使用 `deepagents`：

- 它会同时引入 filesystem、subagent、memory、skills、summarization 等能力
- 本项目第一阶段只需要只读补读工具
- 引入过重 runtime 会让知识生成边界变得不清晰

暂不使用 MCP：

- 当前诉求是本地仓库代码补读
- 本地工具函数已经足够
- MCP 适合跨进程、跨客户端、跨项目复用，不是第一阶段必要条件

## 总体架构

目标链路：

```text
caller
  -> KnowledgeReadRuntime
    -> LangGraph StateGraph
      -> model_decide
      -> tool_execute
      -> budget_check
      -> output_validate
      -> repair_output
    -> local read tools
  -> KnowledgeReadResult
```

第一阶段不进入现有对象生成主链。它先作为一个独立模块存在，供后续对象生成器调用。

## 模块边界

建议新增目录：

```text
src/agent-read-runtime/
├── index.ts
├── types.ts
├── context-budget.ts
├── local-read-tools.ts
├── graph-runtime.ts
└── trace.ts
```

### `types.ts`

定义 runtime 的稳定输入输出契约。

核心类型：

```ts
export interface KnowledgeReadRuntimeInput {
  repoPath: string;
  instruction: string;
  initialContext?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  limits?: Partial<KnowledgeReadLimits>;
}

export interface KnowledgeReadLimits {
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalToolResultChars: number;
  maxFileWindowLines: number;
}

export interface KnowledgeReadResult {
  answer: string;
  evidenceRefs: EvidenceRef[];
  insufficientEvidence: boolean;
  toolCallsUsed: number;
  trace: KnowledgeReadTrace;
}
```

### `context-budget.ts`

负责预算判断和裁剪策略。

第一阶段按字符数控制，不做 token encoder。原因是当前项目尚未引入统一 tokenizer，字符预算足以支撑第一阶段的安全边界。

默认限制建议：

```ts
export const DEFAULT_KNOWLEDGE_READ_LIMITS = {
  maxToolCalls: 8,
  maxToolResultChars: 12_000,
  maxTotalToolResultChars: 40_000,
  maxFileWindowLines: 240,
} as const;
```

### `local-read-tools.ts`

提供本地只读工具。

第一批工具：

1. `read_file_window`
   - 输入：相对路径、起始行、结束行
   - 输出：带行号的文本窗口
   - 限制：只能读取 `repoPath` 内文件

2. `search_repo_text`
   - 输入：文本 query、limit
   - 输出：匹配文件、行号、行文本
   - 限制：不返回整文件内容

3. `read_symbol_definition`
   - 输入：symbol name
   - 输出：候选定义片段
   - 第一阶段可基于文本搜索和窗口读取实现
   - 后续可接入 `engine/query`

4. `read_symbol_references`
   - 输入：symbol name、limit
   - 输出：引用位置摘要和局部行
   - 第一阶段可基于文本搜索实现
   - 后续可接入图索引

5. `read_related_tests`
   - 输入：文件路径或 symbol name
   - 输出：测试文件候选和匹配行
   - 第一阶段基于路径名、symbol name 和 `tests/` 搜索

### `graph-runtime.ts`

封装 LangGraph 工作流。

职责：

1. 创建 `ChatOpenAI`
2. 创建本地 tools
3. 定义 `KnowledgeReadGraphState`
4. 构建 `StateGraph`
5. 执行一次补读任务
6. 将最终状态转换为 `KnowledgeReadResult`

模型配置沿用当前 OpenAI-compatible 配置：

- `baseUrl`
- `apiKey`
- `model`

### `trace.ts`

记录本次补读运行的过程。

trace 不保存完整超大工具输出，只保存：

- tool name
- arguments
- returned chars
- truncated flag
- durationMs
- error
- evidence refs

## Agent 指令约束

系统指令必须明确：

1. 只能使用工具读取本地代码证据
2. 不能要求读取整个仓库
3. 不能把推测写成事实
4. 证据不足时必须设置 `insufficientEvidence: true`
5. 最终输出必须是 JSON
6. `evidenceRefs` 必须引用工具返回的文件和行号

建议最终输出 schema：

```ts
export const KnowledgeReadAgentOutputSchema = z.object({
  answer: z.string(),
  evidence_refs: z.array(z.object({
    file: z.string(),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    note: z.string(),
  })),
  insufficient_evidence: z.boolean(),
});
```

## 安全边界

本地读取工具必须满足：

1. 所有路径先 `resolve(repoPath, inputPath)`
2. resolved path 必须仍在 `repoPath` 内
3. 拒绝绝对路径逃逸
4. 拒绝读取目录
5. 拒绝读取二进制文件
6. 单次读取行数不能超过 `maxFileWindowLines`
7. 单次工具结果不能超过 `maxToolResultChars`
8. 累计工具结果不能超过 `maxTotalToolResultChars`

## 错误处理

工具错误应返回给模型可理解的信息，而不是直接中断整个 runtime。

可恢复错误：

- 文件不存在
- 路径越界
- 行号越界
- 搜索无结果
- 单次结果被裁剪

不可恢复错误：

- 模型调用失败且重试耗尽
- LangChain agent 初始化失败
- 输出不是合法 JSON 且修复重试失败

## 重试策略

第一阶段只做两类重试：

1. 模型调用失败
   - 使用现有 `src/generation/retry.ts`
   - 默认最多 3 次

2. 最终 JSON 解析失败
   - 追加一次修复提示
   - 要求模型只返回合法 JSON
   - 修复仍失败则抛出结构化错误

不对每个工具调用做复杂重试。

## Graph 节点设计

### `model_decide`

输入：

- 当前 instruction
- initial context
- 已有 tool observations
- 剩余预算摘要

输出：

- 继续调用工具
- 或输出最终 JSON

### `tool_execute`

执行模型请求的本地只读工具。

规则：

- 工具名必须在 allowlist 内
- 工具参数必须通过 zod schema
- 工具错误进入 observation，不直接终止 graph

### `budget_check`

检查：

- `toolCallsUsed`
- `totalToolResultChars`
- 单次工具结果是否被裁剪

若预算耗尽，进入 `output_validate`，并要求模型给出 `insufficient_evidence: true`。

### `output_validate`

解析模型最终 JSON，并用 `KnowledgeReadAgentOutputSchema` 校验。

若通过，进入 `success`。

若失败，进入 `repair_output`。

### `repair_output`

只允许修复一次。

输入：

- 原始模型输出
- schema 错误

输出：

- 合法 JSON
- 或 `failed`

## Graph 状态

建议状态字段：

```ts
export interface KnowledgeReadGraphState {
  repoPath: string;
  instruction: string;
  initialContext?: string;
  observations: string[];
  pendingToolCalls: PendingToolCall[];
  finalText?: string;
  parsedOutput?: KnowledgeReadAgentOutput;
  toolCallsUsed: number;
  totalToolResultChars: number;
  repairAttempts: number;
  trace: KnowledgeReadTrace;
  error?: string;
}
```

第一阶段可以不启用持久化 checkpoint，但状态结构必须为后续 checkpoint 保持稳定。

## 后续接入方式

第一阶段完成后，现有对象生成器可以逐步接入：

```text
build evidence bundle
  -> call KnowledgeReadRuntime for missing evidence
  -> merge evidence refs
  -> build object prompt
  -> generate object JSON
  -> schema validate
  -> render package
```

但这个接入不属于第一阶段。

## 验收标准

第一阶段完成后必须满足：

1. 项目能通过 `npm run typecheck`
2. 项目能通过 `npm test`
3. 能在测试 fixture 上运行一次补读任务
4. agent 能调用本地只读工具读取代码窗口
5. 路径逃逸会被拒绝
6. 工具返回会按限制裁剪
7. 最终输出包含 `answer`、`evidenceRefs`、`insufficientEvidence`、`trace`
8. 不产生任何文件写入、shell 执行或 MCP 调用
9. 补读流程由 LangGraph 显式节点控制，不依赖 `createAgent` 的预置循环
