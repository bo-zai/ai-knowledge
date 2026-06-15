# Agent Runtime 使用指南

Agent Runtime 是 RKG (Repo Knowledge Generator) 项目中的核心组件，负责在知识生成过程中与 LLM 进行交互，通过受控的工具调用读取仓库证据。

## 快速开始

### 基本使用

```typescript
import { runKnowledgeReadRuntime } from 'rkg/agent-read-runtime';

const result = await runKnowledgeReadRuntime({
  repoPath: '/path/to/your/repo',
  instruction: '查找 UserService 类的定义和主要方法',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
});

console.log(result.answer);
console.log(result.evidenceRefs);
```

### 运行结果

`runKnowledgeReadRuntime` 返回以下结构：

```typescript
interface KnowledgeReadResult {
  answer: string;                  // LLM 生成的回答
  evidenceRefs: EvidenceRef[];     // 证据引用列表
  insufficientEvidence: boolean;   // 是否证据不足
  toolCallsUsed: number;           // 使用的工具调用次数
  trace: KnowledgeReadTrace;       // 执行追踪信息
}
```

## 配置说明

### 运行时输入配置

```typescript
interface KnowledgeReadRuntimeInput {
  repoPath: string;                // 仓库路径（必填）
  instruction: string;             // 查询指令（必填）
  initialContext?: string;         // 初始上下文（可选）
  model: string;                   // LLM 模型名称
  baseUrl: string;                 // LLM API 地址
  apiKey: string;                  // API 密钥
  limits?: Partial<KnowledgeReadLimits>; // 预算限制（可选）
}
```

### 预算限制配置

默认限制值：

```typescript
const DEFAULT_KNOWLEDGE_READ_LIMITS = {
  maxToolCalls: 8,                 // 最大工具调用次数
  maxToolResultChars: 12_000,      // 单次工具返回最大字符数
  maxTotalToolResultChars: 40_000, // 总工具返回最大字符数
  maxFileWindowLines: 240,         // 单次文件读取最大行数
  searchResultLimit: 30,           // 搜索结果最大条数
  maxSearchFileBytes: 512_000,     // 搜索文件最大字节数
};
```

自定义限制示例：

```typescript
const result = await runKnowledgeReadRuntime({
  repoPath: '/path/to/repo',
  instruction: '查询...',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  limits: {
    maxToolCalls: 5,
    maxToolResultChars: 8_000,
  },
});
```

## 核心能力

### 1. 文件工具集

Agent Runtime 提供五种受控的本地读取工具：

| 工具名称 | 功能描述 |
|---------|---------|
| `read_file_window` | 读取指定文件指定行范围的内容 |
| `search_repo_text` | 在仓库中搜索文本，返回匹配行 |
| `read_symbol_definition` | 搜索符号定义位置 |
| `read_symbol_references` | 搜索符号引用位置 |
| `read_related_tests` | 搜索与路径或符号相关的测试 |

#### 工具参数示例

**read_file_window**

```typescript
{
  path: 'src/service.ts',      // 相对路径
  startLine: 10,               // 起始行号
  endLine: 20                  // 结束行号
}
```

**search_repo_text**

```typescript
{
  query: 'UserService',        // 搜索文本
  limit: 10                    // 结果限制（可选）
}
```

**read_symbol_definition**

```typescript
{
  symbol: 'formatUser',        // 符号名称
  limit: 5                     // 结果限制（可选）
}
```

**read_symbol_references**

```typescript
{
  symbol: 'findById',          // 符号名称
  limit: 10                    // 结果限制（可选）
}
```

**read_related_tests**

```typescript
{
  path: 'src/service.ts',      // 文件路径（可选）
  symbol: 'UserService',       // 符号名称（可选）
  limit: 5                     // 结果限制（可选）
}
```

### 2. 上下文压缩

通过预算限制机制控制 LLM 的上下文消耗：

- **工具调用次数限制**：防止无限循环调用
- **单次结果截断**：超过限制时自动截断并标记 `[truncated]`
- **总字符预算**：累计控制总返回内容量

当预算耗尽时，运行时自动返回 `insufficientEvidence: true`。

### 3. 多模型路由

支持 OpenAI-compatible API，可配置不同的模型服务：

```typescript
// OpenAI
{
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
}

// Azure OpenAI
{
  model: 'gpt-4o',
  baseUrl: 'https://your-resource.openai.azure.com/openai/deployments/gpt-4o',
  apiKey: process.env.AZURE_OPENAI_KEY,
}

// 其他兼容服务
{
  model: 'glm-5',
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
}
```

## 使用示例

### 示例 1：查找函数定义

```typescript
const result = await runKnowledgeReadRuntime({
  repoPath: '/workspace/my-project',
  instruction: '查找 formatUser 函数的定义并描述其功能',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
});

if (result.insufficientEvidence) {
  console.log('证据不足，无法完成查询');
} else {
  console.log('回答:', result.answer);
  console.log('证据:');
  result.evidenceRefs.forEach(ref => {
    console.log(`  ${ref.file}:${ref.startLine}-${ref.endLine} - ${ref.note}`);
  });
}
```

### 示例 2：提供初始上下文

```typescript
const result = await runKnowledgeReadRuntime({
  repoPath: '/workspace/my-project',
  instruction: '分析 UserService 和 OrderService 的交互关系',
  initialContext: `
已知信息：
- UserService 位于 src/services/user.ts
- OrderService 位于 src/services/order.ts
- 两个服务都使用 DatabaseConnection
`,
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 示例 3：追踪执行过程

```typescript
const result = await runKnowledgeReadRuntime({...});

// 分析执行追踪
console.log('执行时长:', result.trace.durationMs, 'ms');
console.log('工具调用记录:');
result.trace.toolCalls.forEach(call => {
  console.log(`  ${call.toolName}(${JSON.stringify(call.args)})`);
  console.log(`    耗时: ${call.durationMs}ms`);
  console.log(`    返回字符: ${call.returnedChars}`);
  if (call.error) {
    console.log(`    错误: ${call.error}`);
  }
});
```

### 示例 4：使用自定义预算

```typescript
// 严格预算场景
const result = await runKnowledgeReadRuntime({
  repoPath: '/workspace/my-project',
  instruction: '快速查找 main 函数入口',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  limits: {
    maxToolCalls: 3,              // 最多 3 次调用
    maxFileWindowLines: 50,       // 每次最多读 50 行
    searchResultLimit: 5,         // 搜索最多返回 5 条
  },
});
```

## API 参考

### 主函数

```typescript
runKnowledgeReadRuntime(
  input: KnowledgeReadRuntimeInput,
  deps?: { model?: CustomModel }
): Promise<KnowledgeReadResult>
```

### 类型定义

**KnowledgeReadRuntimeInput**

```typescript
interface KnowledgeReadRuntimeInput {
  repoPath: string;
  instruction: string;
  initialContext?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  limits?: Partial<KnowledgeReadLimits>;
}
```

**KnowledgeReadLimits**

```typescript
interface KnowledgeReadLimits {
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalToolResultChars: number;
  maxFileWindowLines: number;
  searchResultLimit: number;
  maxSearchFileBytes: number;
}
```

**KnowledgeReadResult**

```typescript
interface KnowledgeReadResult {
  answer: string;
  evidenceRefs: EvidenceRef[];
  insufficientEvidence: boolean;
  toolCallsUsed: number;
  trace: KnowledgeReadTrace;
}
```

**EvidenceRef**

```typescript
interface EvidenceRef {
  file: string;
  startLine: number;
  endLine: number;
  note: string;
}
```

**KnowledgeReadTrace**

```typescript
interface KnowledgeReadTrace {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  toolCalls: ToolTraceEvent[];
  totalToolResultChars: number;
}
```

**ToolTraceEvent**

```typescript
interface ToolTraceEvent {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  returnedChars: number;
  acceptedBudgetChars: number;
  truncated: boolean;
  error?: string;
}
```

### 辅助函数

```typescript
// 解析预算限制（合并默认值）
resolveKnowledgeReadLimits(
  input?: Partial<KnowledgeReadLimits>
): KnowledgeReadLimits

// 创建预算状态
createBudgetState(
  limits: KnowledgeReadLimits
): BudgetState

// 创建追踪收集器
createTraceCollector(): TraceCollector

// 创建本地读取工具
createLocalReadTools(input: {
  repoPath: string;
  budget: BudgetState;
  trace: TraceCollector;
}): Tool[]

// 解析 Agent 输出
parseKnowledgeReadAgentOutput(
  text: string
): Omit<KnowledgeReadResult, 'toolCallsUsed' | 'trace'>

// 验证最终输出
validateFinalOutput(state: {
  finalText?: string;
  repairAttempts: number;
}): { parsedOutput?: KnowledgeReadAgentOutput; validationError?: string }
```

### 导出常量

```typescript
// 默认预算限制
DEFAULT_KNOWLEDGE_READ_LIMITS: KnowledgeReadLimits

// 输出 Schema（用于 Zod 验证）
KnowledgeReadAgentOutputSchema: ZodSchema<KnowledgeReadAgentOutput>
```

## 错误处理

### KnowledgeReadValidationError

当 Agent 输出无法解析为有效 JSON 时抛出：

```typescript
try {
  const result = await runKnowledgeReadRuntime({...});
} catch (error) {
  if (error instanceof KnowledgeReadValidationError) {
    console.log('输出验证失败:', error.message);
  }
}
```

### 工具错误

工具执行错误会记录在追踪中，不会中断流程：

```typescript
const result = await runKnowledgeReadRuntime({...});

const errors = result.trace.toolCalls.filter(c => c.error);
if (errors.length > 0) {
  console.log('部分工具调用失败:', errors);
}
```

## 安全特性

- **路径边界检查**：禁止读取仓库范围外的文件
- **二进制文件过滤**：自动跳过图片、PDF 等非文本文件
- **敏感目录跳过**：自动跳过 `.git`、`node_modules` 等
- **预算强制**：超限时强制返回 `insufficientEvidence`，防止无限消耗

## 文件过滤规则

自动跳过的目录：

- `.git`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.knowledge`
- `bootstrap-knowledge`

自动跳过的文件扩展名：

- `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`
- `.pdf`
- `.zip`, `.gz`
- `.exe`, `.dll`, `.wasm`