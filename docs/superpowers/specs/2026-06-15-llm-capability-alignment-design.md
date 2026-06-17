# 大模型基础能力对齐设计文档

**日期：** 2026-06-15
**项目：** ai-wiki
**目标：** 将大模型基础能力对齐至 CmbCoworkAgent-main 项目

---

## 一、背景与目标

### 1.1 当前项目现状

**核心文件：**

- `src/generation/llm-client.ts`: OpenAI SDK 直接封装
- `llm.config.json`: 单一模型配置文件
- `src/config/model-config.ts`: 配置加载和解析

**现有能力：**

- ✅ 流式和非流式调用
- ✅ 基础的超时和重试机制
- ❌ 无工具调用能力
- ❌ 无上下文压缩机制
- ❌ 无多模型支持
- ❌ 无对话历史持久化

### 1.2 目标项目参考

**核心文件：**

- `src/main/agent/runtime.ts`: DeepAgents Agent 运行时系统
- `src/main/agent/local-sandbox.ts`: 文件系统工具后端
- `src/main/storage.ts`: 多模型配置管理
- `src/main/routing/index.ts`: 智能路由机制

**目标能力：**

- ✅ 工具调用能力（文件系统工具）
- ✅ 上下文压缩（SummarizationMiddleware）
- ✅ 多模型配置和智能路由

### 1.3 对齐目标

根据需求确认，本次对齐的核心能力：

1. ✅ 工具调用能力（文件系统工具，不含命令执行）
2. ✅ 上下文压缩机制
3. ✅ 多模型支持和智能路由

**不包含：**

- ❌ 命令执行工具
- ❌ CodeGraph MCP 工具集成
- ❌ 工具安全机制（审批、沙箱）
- ❌ MCP 扩展系统
- ❌ 对话历史持久化

---

## 二、整体架构设计

### 2.1 架构演进路径

```
当前架构：
  CLI/API → llm-client.ts → OpenAI SDK → 单次调用
           ↓
         无工具、无历史、单模型

目标架构：
  CLI/API → agent-runtime.ts → DeepAgents Framework
           ↓                    ↓
         工具系统              SummarizationMiddleware
           ↓                    ↓
         文件操作              上下文压缩
           ↓                    ↓
         多模型路由            Token 阈值控制
```

### 2.2 核心模块拆分

| 模块          | 文件路径                             | 职责                             |
| ------------- | ------------------------------------ | -------------------------------- |
| Agent Runtime | `src/agent-runtime/runtime.ts`       | Agent 组装、工具集成、中间件配置 |
| 文件系统工具  | `src/agent-runtime/file-tools.ts`    | 文件操作工具后端实现             |
| 多模型配置    | `src/config/multi-model-config.ts`   | 多模型配置加载和管理             |
| 智能路由      | `src/agent-runtime/routing/index.ts` | 模型选择策略                     |

---

## 三、工具调用能力设计

### 3.1 文件系统工具列表

**基础工具：**

1. `ls` - 列出目录内容
2. `read_file` - 读取文件内容
3. `write_file` - 写入文件
4. `edit_file` - 编辑文件（diff-based）
5. `glob` - 文件模式匹配搜索
6. `grep` - 文件内容搜索（支持多文件）

**工具配置示例：**

```typescript
const filesystemMiddleware = createFilesystemMiddleware({
  backend: new FileBackend({
    rootDir: workspacePath,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    encoding: "utf-8",
  }),
});
```

### 3.2 工具实现方式

使用 DeepAgents 的 `createFilesystemMiddleware`，配置：

- `backend`: 文件操作后端（自定义实现）
- `systemPrompt`: 文件系统使用提示词

**关键配置：**

```typescript
interface FileBackendConfig {
  rootDir: string; // 工作目录根路径
  maxFileSize: number; // 最大文件大小限制
  encoding: string; // 默认编码
  virtualMode: false; // 真实文件系统（非虚拟）
}
```

---

## 四、上下文压缩能力设计

### 4.1 SummarizationMiddleware 核心机制

**触发条件：**

- Token 数达到阈值（如 75% 上下文窗口）
- 基于模型配置的 maxTokens 计算

**保留策略：**

- 保留最近 10% 的对话历史（keepTokens）
- 摘要历史对话，提取关键信息

**配置示例：**

```typescript
const summarizationOptions = {
  model: modelInstance,
  backend: stateBackend,
  historyPathPrefix: ".aiwiki/conversation_history",
  trigger: { type: "tokens", value: triggerTokens },
  keep: { type: "tokens", value: keepTokens },
  summaryPrompt: AIWIKI_SUMMARY_PROMPT,
  truncateArgsSettings: {
    trigger: { type: "tokens", value: triggerTokens },
    keep: { type: "tokens", value: keepTokens },
    maxLength: 2000,
  },
};
```

### 4.2 自定义摘要提示词

针对 ai-wiki 项目的需求设计摘要提示词：

```typescript
const AIWIKI_SUMMARY_PROMPT = `
你的任务是为正在进行的 ai-wiki 知识图谱生成项目创建详细的延续摘要。

下一个模型调用将使用你的摘要来继续工作。请编写一个密集、实用的工程交接文档，保留难以或昂贵的恢复细节。不要包含私有的推理或分析草稿。

覆盖以下部分：

1. Primary Request and Intent
   - 捕获用户的显式请求、修正、决策和当前期望。
   - 保留确切的日期、分支名称、提交哈希、模型名称、文件路径、配置值和引用的用户措辞（当它们重要时）。

2. Current Work State
   - 描述在压缩之前正在处理的内容。
   - 分离已完成的工作、进行中的工作和剩余的工作。
   - 包括变更是否已提交、推送、仅在工作树中或尚未完成。

3. Files and Code Sections
   - 列出检查、修改或创建的文件。
   - 对于每个重要文件，包括相关的符号、常量、函数或代码路径以及它们为什么重要。
   - 仅在确切的行文模棱两可时才包括短代码片段。

4. Commands and Outputs
   - 记录有意义的命令运行及其结果。
   - 包括测试/类型检查失败、已知无关失败以及已完成的验证。

5. Technical Decisions and Constraints
   - 捕获假设、权衡、被拒绝的方法、提供商/模型限制、路由/摘要/token-budget 推理和兼容性约束。

6. Errors, Fixes, and Warnings
   - 记录遇到的错误、根本原因、修复或缓解措施以及下一个模型应避免重复的内容。

7. Pending Next Step
   - 仅在直接跟随最新用户请求时才列出具体的下一步行动。
   - 如果最新的用户请求已完成，请说明并且不要发明无关的下一步。

要简洁的要点，高信息密度。对技术状态要详尽，但避免通用叙述。如果用户使用中文，请为面向用户的细节和回复上下文细节保留中文措辞。

对话摘要：
{conversation}

摘要：
`;
```

### 4.3 Token 阈值计算策略

根据模型的 maxTokens 动态计算：

```typescript
const SUMMARY_KEEP_RATIO = 0.1; // 保留 10%
const SUMMARY_INPUT_RATIO = 0.65; // 输入 token 占 65%
const SUMMARY_INPUT_TOKEN_CAP = 700_000; // 输入 token 上限

const triggerTokens = Math.floor(maxTokens * 0.75); // 75% 触发
const keepTokens = Math.max(Math.floor(maxTokens * SUMMARY_KEEP_RATIO), 4_000);
const trimForSummary = Math.min(
  SUMMARY_INPUT_TOKEN_CAP,
  Math.floor(maxTokens * SUMMARY_INPUT_RATIO),
);
const toolEvictLimit = Math.min(
  20_000,
  Math.max(Math.floor(maxTokens * 0.08), 6_000),
);
```

---

## 五、多模型支持设计

### 5.1 配置文件结构

**配置文件路径：** `multi-models.json`

```json
{
  "models": [
    {
      "id": "premium-model",
      "name": "Claude Opus 4",
      "baseUrl": "https://api.anthropic.com/v1",
      "model": "claude-opus-4-20250514",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "maxTokens": 200000,
      "tier": "premium",
      "interleavedThinking": true
    },
    {
      "id": "economy-model",
      "name": "Claude Sonnet 4",
      "baseUrl": "https://api.anthropic.com/v1",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "maxTokens": 64000,
      "tier": "economy"
    },
    {
      "id": "openai-model",
      "name": "GPT-4o",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o-2024-11-20",
      "apiKey": "${OPENAI_API_KEY}",
      "maxTokens": 128000,
      "tier": "premium"
    }
  ],
  "routingMode": "auto",
  "defaultModel": "premium-model"
}
```

### 5.2 模型配置管理

**核心函数：**

```typescript
interface MultiModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string; // 支持环境变量引用 ${ENV_VAR}
  maxTokens: number;
  tier?: "premium" | "economy";
  interleavedThinking?: boolean;
}

export function loadMultiModelConfig(): MultiModelConfig[];
export function getModelByTier(
  tier: "premium" | "economy",
): MultiModelConfig | null;
export function resolveApiKey(config: MultiModelConfig): string;
```

### 5.3 智能路由机制

**路由策略：**

参考目标项目的三层路由机制：

1. **Layer 1**：用户显式指定模型
2. **Layer 2**：基于任务特征自动路由
3. **Layer 3**：基于历史反馈调整

**Layer 2 路由规则（简化版）：**

```typescript
// Premium 任务特征：
const PREMIUM_TASK_PATTERN = /\b(工具|文件|执行|调试|排查|重构)\b/i;

// Economy 任务特征：
const ECONOMY_TASK_PATTERN = /\b(写|实现|生成|创建|解释|说明|翻译)\b/i;

function determineTierByTask(message: string): "premium" | "economy" {
  if (PREMIUM_TASK_PATTERN.test(message)) return "premium";
  if (ECONOMY_TASK_PATTERN.test(message)) return "economy";
  return "premium"; // 默认使用 premium
}
```

---

## 六、统一重试机制设计

### 7.1 RetryingFetch 封装

参考目标项目的统一重试机制：

```typescript
const RETRYABLE_NON_5XX_STATUS = new Set([408, 409, 429, 432, 433]);
const DEFAULT_RETRY_MAX_ATTEMPTS = 6;
const RETRY_BASE_DELAY_MS = 1000;
const PER_ATTEMPT_TIMEOUT_MS = 60_000;

function createRetryingFetch(
  maxAttempts: number = DEFAULT_RETRY_MAX_ATTEMPTS,
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Per-attempt AbortController
      const attemptCtrl = new AbortController();
      const timeoutHandle = setTimeout(() => {
        attemptCtrl.abort(
          new DOMException("Per-attempt timeout", "TimeoutError"),
        );
      }, PER_ATTEMPT_TIMEOUT_MS);

      try {
        const res = await fetch(input, { ...init, signal: attemptCtrl.signal });
        clearTimeout(timeoutHandle);

        if (!isRetryableStatus(res.status)) return res;

        // Drain body before retry
        await res.arrayBuffer();

        const delay = computeBackoffDelay(attempt);
        await sleep(delay, parentSignal);
        continue;
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (parentSignal?.aborted) throw err;

        const delay = computeBackoffDelay(attempt);
        await sleep(delay, parentSignal);
        continue;
      }
    }
  };
}
```

### 7.2 指数退避策略

```typescript
function computeBackoffDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.round(base * (1 + Math.random())); // 添加 jitter
}
```

---

## 七、文件结构调整

### 8.1 新增文件清单

| 文件路径                             | 说明              |
| ------------------------------------ | ----------------- |
| `src/agent-runtime/runtime.ts`       | Agent 运行时系统  |
| `src/agent-runtime/file-tools.ts`    | 文件系统工具实现  |
| `src/agent-runtime/routing/index.ts` | 智能路由系统      |
| `src/config/multi-model-config.ts`   | 多模型配置管理    |
| `multi-models.json`                  | 多模型配置文件    |
| `src/shared/state-backend.ts`        | StateBackend 实现 |

### 8.2 现有文件调整

| 文件路径                       | 调整内容                  |
| ------------------------------ | ------------------------- |
| `src/generation/llm-client.ts` | 重构为 Agent 模式调用入口 |
| `llm.config.json`              | 保留作为单模型配置的兼容  |
| `package.json`                 | 新增依赖                  |
| `src/config/defaults.ts`       | 更新默认配置              |

---

## 八、依赖变更

### 9.1 新增依赖

```json
{
  "dependencies": {
    "deepagents": "^1.8.1",
    "@langchain/core": "^1.1.29",
    "@langchain/langgraph": "^1.2.0",
    "@langchain/openai": "^1.2.11",
    "langchain": "^1.2.28"
  }
}
```

### 9.2 依赖说明

| 包名                   | 版本    | 用途               |
| ---------------------- | ------- | ------------------ |
| `deepagents`           | ^1.8.1  | Agent 框架核心     |
| `@langchain/core`      | ^1.1.29 | LangChain 核心抽象 |
| `@langchain/langgraph` | ^1.2.0  | 对话状态管理       |
| `@langchain/openai`    | ^1.2.11 | OpenAI 模型适配    |
| `langchain`            | ^1.2.28 | LangChain 完整包   |

---

## 十、实施路径

### 10.1 分阶段实施计划

#### **阶段一：基础框架搭建（2-3天）**

**目标：**

- 安装依赖
- 创建基础文件结构
- 实现基础 Agent Runtime

**关键任务：**

1. 安装依赖包
2. 创建 `src/agent-runtime/runtime.ts`
3. 实现基础的 `createDeepAgent` 函数
4. 创建 `src/shared/state-backend.ts`

#### **阶段二：文件系统工具集成（3-4天）**

**目标：**

- 实现文件系统工具后端
- 集成 createFilesystemMiddleware

**关键任务：**

1. 创建 `src/agent-runtime/file-tools.ts`
2. 实现 FileBackend 类
3. 配置文件工具：ls、read、write、edit、glob、grep
4. 测试文件工具功能

#### **阶段三：上下文压缩集成（2-3天）**

**目标：**

- 集成 SummarizationMiddleware
- 实现自定义摘要提示词

**关键任务：**

1. 配置 SummarizationMiddleware
2. 实现 AIWIKI_SUMMARY_PROMPT
3. 配置 token 阈值计算
4. 测试摘要触发机制

#### **阶段四：多模型支持（2-3天）**

**目标：**

- 实现多模型配置系统
- 实现基础路由机制

**关键任务：**

1. 创建 `src/config/multi-model-config.ts`
2. 创建 `multi-models.json` 配置文件
3. 实现 `loadMultiModelConfig` 和 `getModelByTier`
4. 实现基础的 Layer 2 路由规则
5. 测试多模型切换

#### **阶段五：统一重试机制（1-2天）**

**目标：**

- 实现统一重试封装
- 替换现有的简单重试

**关键任务：**

1. 实现 `createRetryingFetch`
2. 配置指数退避和 per-attempt timeout
3. 替换现有的超时配置
4. 测试重试机制

#### **阶段六：集成测试和优化（2-3天）**

**目标：**

- 完整功能测试
- 性能优化

**关键任务：**

1. 编写集成测试
2. 性能测试和优化
3. 文档更新
4. 用户指南编写

---

## 十一、测试策略

### 11.1 单元测试

| 测试文件                                       | 测试内容             |
| ---------------------------------------------- | -------------------- |
| `tests/unit/agent-runtime/runtime.test.ts`     | Agent 组装和工具集成 |
| `tests/unit/agent-runtime/file-tools.test.ts`  | 文件工具功能         |
| `tests/unit/config/multi-model-config.test.ts` | 多模型配置加载       |
| `tests/unit/agent-runtime/routing.test.ts`     | 路由逻辑             |

### 11.2 集成测试

| 测试场景       | 测试内容               |
| -------------- | ---------------------- |
| 文件工具调用   | 完整的文件操作流程     |
| 上下文压缩触发 | Token 阈值触发摘要     |
| 多模型路由     | 不同任务类型的模型选择 |

---

## 十二、性能和资源考虑

### 12.1 内存占用

- SQL.js 完整数据库加载到内存
- 对话历史随时间增长，需要定期清理策略
- 工具调用会增加内存占用

### 12.2 响应延迟

- 工具调用会增加响应时间（文件 IO）
- 摘要触发时会有额外的模型调用

### 12.3 Token 使用优化

- 合理配置 triggerTokens 和 keepTokens
- 工具参数截断减少 token 使用
- 智能路由选择合适的模型节省成本

---

## 十三、风险与缓解措施

### 13.1 技术风险

| 风险                | 缓解措施                           |
| ------------------- | ---------------------------------- |
| DeepAgents API 变化 | 锁定版本，定期更新评估             |
| 工具调用安全性      | 限制文件路径范围，设置文件大小限制 |
| 摘要质量不稳定      | 自定义摘要提示词，定期优化         |

### 13.2 兼容性风险

| 风险                  | 缓解措施                             |
| --------------------- | ------------------------------------ |
| 现有 API 调用方式变化 | 提供兼容层，保留旧的调用方式一段时间 |
| 配置文件格式变化      | 提供配置迁移脚本                     |
| 依赖包冲突            | 仔细测试依赖兼容性                   |

---

## 十四、后续扩展计划

### 14.1 可选扩展能力

本次对齐不包含，但未来可考虑：

1. **MCP 工具集成**
   - 集成外部 MCP 服务
   - 工具动态加载机制

2. **技能系统**
   - 自定义技能定义
   - 技能加载和管理

3. **审批系统**
   - 危险操作审批
   - 权限分级控制

4. **命令执行工具**
   - 沙箱环境隔离
   - 安全执行机制

### 14.2 优化方向

1. **路由算法优化**
   - 更智能的任务特征识别
   - 历史反馈学习

2. **摘要质量优化**
   - 摘要质量评估
   - 提示词迭代优化

3. **性能优化**
   - 工具调用批处理

---

## 十五、总结

本设计文档详细规划了将 ai-wiki 项目的大模型基础能力对齐至 CmbCoworkAgent-main 项目的技术方案。核心对齐能力包括：

1. **工具调用能力**：文件系统工具（ls、read、write、edit、glob、grep）
2. **上下文压缩**：SummarizationMiddleware 和智能摘要
3. **多模型支持**：多模型配置和智能路由

实施路径分为六个阶段，预计总工期为 10-14 天。方案风险可控，采用渐进式引入策略，确保现有功能不受影响。
