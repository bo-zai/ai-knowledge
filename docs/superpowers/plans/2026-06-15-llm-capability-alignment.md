# LLM 基础能力对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入工具调用、上下文压缩、多模型支持能力，对齐 CmbCoworkAgent-main 项目

**Architecture:** 引入 DeepAgents + LangChain 框架，构建 Agent 运行时系统，集成文件系统工具和 SummarizationMiddleware，实现多模型配置和智能路由

**Tech Stack:** DeepAgents 1.8.1, LangChain 1.2.28, @langchain/langgraph 1.2.0

---

## 文件结构规划

### 新增文件

| 文件路径                                        | 职责                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `src/agent-runtime/runtime.ts`                  | Agent 运行时系统，组装 Agent、工具、中间件               |
| `src/agent-runtime/file-backend.ts`             | 文件系统后端实现，提供 ls、read、write、edit、glob、grep |
| `src/agent-runtime/file-tools.ts`               | 文件工具定义和配置                                       |
| `src/agent-runtime/middleware.ts`               | 中间件配置（Summarization、工具编排）                    |
| `src/agent-runtime/routing/index.ts`            | 模型路由系统（Layer 1-3 路由逻辑）                       |
| `src/agent-runtime/routing/types.ts`            | 路由系统类型定义                                         |
| `src/config/multi-model-config.ts`              | 多模型配置加载和管理                                     |
| `src/shared/retrying-fetch.ts`                  | 统一重试机制封装                                         |
| `multi-models.json`                             | 多模型配置文件                                           |
| `tests/unit/agent-runtime/runtime.test.ts`      | Agent 运行时测试                                         |
| `tests/unit/agent-runtime/file-backend.test.ts` | 文件后端测试                                             |
| `tests/unit/config/multi-model-config.test.ts`  | 多模型配置测试                                           |
| `tests/unit/shared/retrying-fetch.test.ts`      | 重试机制测试                                             |

### 修改文件

| 文件路径                       | 修改内容                  |
| ------------------------------ | ------------------------- |
| `src/generation/llm-client.ts` | 重构为 Agent 模式调用入口 |
| `src/config/defaults.ts`       | 新增 LLM 运行时默认配置   |
| `package.json`                 | 新增依赖包                |

---

## 阶段一：基础框架搭建

### Task 1: 安装依赖包

**Files:**

- Modify: `package.json`

- [ ] **Step 1: 添加依赖包**

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

在 package.json 的 dependencies 部分添加以上依赖。

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 所有依赖成功安装

- [ ] **Step 3: 验证依赖安装**

Run: `npm ls deepagents @langchain/core langchain`
Expected: 显示已安装的版本号

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add DeepAgents and LangChain dependencies"
```

---

### Task 2: 创建配置文件结构

**Files:**

- Create: `multi-models.json`
- Create: `src/config/multi-model-config.ts`

- [ ] **Step 1: 创建 multi-models.json 配置文件**

```json
{
  "models": [
    {
      "id": "default-model",
      "name": "默认模型",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "apiKey": "${OPENAI_API_KEY}",
      "maxTokens": 128000,
      "tier": "premium"
    }
  ],
  "routingMode": "pinned",
  "defaultModel": "default-model"
}
```

- [ ] **Step 2: 创建 multi-model-config.ts 类型定义**

```typescript
import type { z } from "zod";

export interface MultiModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
  tier?: "premium" | "economy";
  interleavedThinking?: boolean;
}

export interface MultiModelsFile {
  models: MultiModelConfig[];
  routingMode: "auto" | "pinned";
  defaultModel?: string;
}

export interface RoutingContext {
  taskSource: "chat" | "scheduler" | "optimizer";
  message?: string;
  threadId?: string;
  requestedModelId?: string;
  routingMode: "auto" | "pinned";
}

export interface RoutingResult {
  resolvedModelId: string;
  resolvedTier: "premium" | "economy";
  routeReason: string;
  layer: "pinned" | "layer1" | "layer2" | "layer3";
}
```

- [ ] **Step 3: 创建配置加载函数**

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../shared/logger.js";

const MULTI_MODELS_FILE = "multi-models.json";

export function loadMultiModelsFile(
  projectRoot: string,
): MultiModelsFile | null {
  const configPath = join(projectRoot, MULTI_MODELS_FILE);

  if (!existsSync(configPath)) {
    logger.warn(`Multi-models config file not found: ${configPath}`);
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as MultiModelsFile;

    if (!parsed.models || parsed.models.length === 0) {
      logger.warn("No models configured in multi-models.json");
      return null;
    }

    logger.info(`Loaded ${parsed.models.length} model configurations`);
    return parsed;
  } catch (error) {
    logger.error(`Failed to load multi-models config: ${error}`);
    return null;
  }
}
```

- [ ] **Step 4: 创建环境变量解析函数**

```typescript
export function resolveApiKey(apiKey: string): string {
  // 支持 ${ENV_VAR} 格式
  const envPattern = /^\$\{(.+)\}$/;

  if (envPattern.test(apiKey)) {
    const envVar = apiKey.match(envPattern)?.[1];
    if (!envVar) {
      throw new Error(`Invalid API key format: ${apiKey}`);
    }

    const resolved = process.env[envVar];
    if (!resolved) {
      throw new Error(`Environment variable not found: ${envVar}`);
    }

    return resolved;
  }

  // 直接返回 API key
  return apiKey;
}
```

- [ ] **Step 5: 创建模型配置验证**

```typescript
export function validateModelConfig(config: MultiModelConfig): void {
  if (!config.id || !config.id.trim()) {
    throw new Error("Model ID is required");
  }

  if (!config.baseUrl || !config.baseUrl.trim()) {
    throw new Error("Base URL is required");
  }

  if (!config.model || !config.model.trim()) {
    throw new Error("Model name is required");
  }

  // 验证 URL 格式
  try {
    new URL(config.baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${config.baseUrl}`);
  }
}

export function getValidatedModels(
  configFile: MultiModelsFile,
): MultiModelConfig[] {
  return configFile.models.map((config) => {
    validateModelConfig(config);
    return {
      ...config,
      apiKey: resolveApiKey(config.apiKey),
    };
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add multi-models.json src/config/multi-model-config.ts
git commit -m "feat: add multi-model configuration system"
```

---

### Task 3: 创建重试机制基础

**Files:**

- Create: `src/shared/retrying-fetch.ts`

- [ ] **Step 1: 定义重试配置类型**

```typescript
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  perAttemptTimeoutMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 6,
  baseDelayMs: 1000,
  perAttemptTimeoutMs: 60000,
};

const RETRYABLE_NON_5XX_STATUS = new Set([408, 409, 429, 432, 433]);

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_NON_5XX_STATUS.has(status);
}
```

- [ ] **Step 2: 实现指数退避计算**

```typescript
function computeBackoffDelay(attempt: number, baseDelayMs: number): number {
  // attempt is 1-based: 1s, 2s, 4s, 8s with jitter
  const base = baseDelayMs * Math.pow(2, attempt - 1);
  return Math.round(base * (1 + Math.random()));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
```

- [ ] **Step 3: 实现统一重试 Fetch**

```typescript
export function createRetryingFetch(
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): typeof fetch {
  const { maxAttempts, baseDelayMs, perAttemptTimeoutMs } = config;

  return async (input, init) => {
    const parentSignal = (init?.signal ?? undefined) as AbortSignal | undefined;
    let lastError: unknown = undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (parentSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Per-attempt AbortController
      const attemptCtrl = new AbortController();
      const onParentAbort = (): void => {
        attemptCtrl.abort(
          parentSignal?.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      parentSignal?.addEventListener("abort", onParentAbort, { once: true });

      const timeoutHandle = setTimeout(() => {
        attemptCtrl.abort(
          new DOMException("Per-attempt timeout", "TimeoutError"),
        );
      }, perAttemptTimeoutMs);

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
        parentSignal?.removeEventListener("abort", onParentAbort);
      };

      try {
        const res = await fetch(input, { ...init, signal: attemptCtrl.signal });
        cleanup();

        if (!isRetryableStatus(res.status)) {
          return res;
        }

        // Exhausted retries
        if (attempt >= maxAttempts) {
          return res;
        }

        // Drain body before retry
        try {
          await res.arrayBuffer();
        } catch {
          // ignore
        }

        const delay = computeBackoffDelay(attempt, baseDelayMs);
        console.warn(
          `[Retry] HTTP ${res.status}, retry ${attempt}/${maxAttempts - 1} after ${delay}ms`,
        );

        await sleep(delay, parentSignal);
        continue;
      } catch (err) {
        cleanup();

        if (parentSignal?.aborted) {
          throw err;
        }

        lastError = err;
        if (attempt >= maxAttempts) {
          throw err;
        }

        const delay = computeBackoffDelay(attempt, baseDelayMs);
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Retry] Network error "${reason}", retry ${attempt}/${maxAttempts - 1} after ${delay}ms`,
        );

        await sleep(delay, parentSignal);
        continue;
      }
    }

    throw lastError ?? new Error("Retrying fetch: unexpected loop exit");
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/retrying-fetch.ts
git commit -m "feat: add unified retry mechanism with exponential backoff"
```

---

## 阶段二：文件系统工具集成

### Task 4: 创建文件后端基础

**Files:**

- Create: `src/agent-runtime/file-backend.ts`

- [ ] **Step 1: 定义文件后端接口**

```typescript
import {
  FilesystemBackend,
  type FileInfo,
  type EditResult,
  type GrepMatch,
} from "deepagents";
import { logger } from "../shared/logger.js";

export interface FileBackendConfig {
  rootDir: string;
  maxFileSizeMb?: number;
  encoding?: BufferEncoding;
}

export class FileBackend implements FilesystemBackend {
  private rootDir: string;
  private maxFileSizeBytes: number;
  private encoding: BufferEncoding;

  constructor(config: FileBackendConfig) {
    this.rootDir = config.rootDir;
    this.maxFileSizeBytes = (config.maxFileSizeMb ?? 10) * 1024 * 1024;
    this.encoding = config.encoding ?? "utf-8";

    logger.info(`FileBackend initialized for: ${this.rootDir}`);
  }

  // 实现将在后续步骤中添加
}
```

- [ ] **Step 2: 实现 ls 方法**

```typescript
import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

async ls(dirPath: string): Promise<FileInfo[]> {
  const absolutePath = this.resolvePath(dirPath);

  if (!this.isWithinRoot(absolutePath)) {
    throw new Error(`Path outside root directory: ${dirPath}`);
  }

  const entries = readdirSync(absolutePath, { withFileTypes: true });

  return entries.map(entry => ({
    name: entry.name,
    path: join(dirPath, entry.name),
    type: entry.isDirectory() ? 'directory' : 'file',
    size: entry.isFile() ? statSync(join(absolutePath, entry.name)).size : 0
  }));
}

private resolvePath(relativePath: string): string {
  return join(this.rootDir, relativePath);
}

private isWithinRoot(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  const rootNormalized = this.rootDir.replace(/\\/g, '/');
  return normalized.startsWith(rootNormalized);
}
```

- [ ] **Step 3: 实现 read_file 方法**

```typescript
import { readFileSync, statSync } from 'fs';

async read_file(filePath: string): Promise<string> {
  const absolutePath = this.resolvePath(filePath);

  if (!this.isWithinRoot(absolutePath)) {
    throw new Error(`Path outside root directory: ${filePath}`);
  }

  const stats = statSync(absolutePath);

  if (stats.size > this.maxFileSizeBytes) {
    throw new Error(`File too large: ${filePath} (${stats.size} bytes)`);
  }

  const content = readFileSync(absolutePath, this.encoding);
  logger.debug(`Read file: ${filePath} (${stats.size} bytes)`);

  return content;
}
```

- [ ] **Step 4: 实现 write_file 方法**

```typescript
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

async write_file(filePath: string, content: string): Promise<{ path: string; bytes: number }> {
  const absolutePath = this.resolvePath(filePath);

  if (!this.isWithinRoot(absolutePath)) {
    throw new Error(`Path outside root directory: ${filePath}`);
  }

  // 确保目录存在
  const dir = dirname(absolutePath);
  mkdirSync(dir, { recursive: true });

  writeFileSync(absolutePath, content, this.encoding);

  const bytes = Buffer.byteLength(content, this.encoding);
  logger.debug(`Write file: ${filePath} (${bytes} bytes)`);

  return { path: filePath, bytes };
}
```

- [ ] **Step 5: 实现 edit_file 方法**

```typescript
import { readFileSync, writeFileSync } from 'fs';

async edit_file(
  filePath: string,
  oldString: string,
  newString: string
): Promise<EditResult> {
  const absolutePath = this.resolvePath(filePath);

  if (!this.isWithinRoot(absolutePath)) {
    throw new Error(`Path outside root directory: ${filePath}`);
  }

  const content = readFileSync(absolutePath, this.encoding);

  if (!content.includes(oldString)) {
    throw new Error(`Old string not found in file: ${filePath}`);
  }

  // 替换所有匹配（参考目标项目：replace_all 默认 false）
  const newContent = content.replace(oldString, newString);
  writeFileSync(absolutePath, newContent, this.encoding);

  logger.debug(`Edit file: ${filePath}`);

  return {
    path: filePath,
    originalContent: content,
    newContent: newContent,
    changes: 1
  };
}
```

- [ ] **Step 6: 实现 glob 方法**

```typescript
import fg from 'fast-glob';

async glob(pattern: string, dirPath?: string): Promise<string[]> {
  const searchDir = dirPath ? this.resolvePath(dirPath) : this.rootDir;

  if (dirPath && !this.isWithinRoot(searchDir)) {
    throw new Error(`Path outside root directory: ${dirPath}`);
  }

  const matches = await fg(pattern, {
    cwd: searchDir,
    absolute: false,
    onlyFiles: true
  });

  logger.debug(`Glob pattern "${pattern}" found ${matches.length} files`);

  return matches;
}
```

- [ ] **Step 7: 实现 grep 方法**

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';

async grep(
  pattern: string,
  dirPath?: string,
  filePath?: string
): Promise<GrepMatch[]> {
  const searchDir = filePath
    ? this.resolvePath(filePath)
    : dirPath
      ? this.resolvePath(dirPath)
      : this.rootDir;

  if (!this.isWithinRoot(searchDir)) {
    throw new Error(`Path outside root directory`);
  }

  const files = filePath
    ? [filePath]
    : await fg('**/*', { cwd: searchDir, onlyFiles: true });

  const matches: GrepMatch[] = [];

  for (const file of files) {
    try {
      const absolutePath = filePath ? searchDir : join(searchDir, file);
      const content = readFileSync(absolutePath, this.encoding);

      // 逐行搜索（literal 匹配，不支持 regex）
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(pattern)) {
          matches.push({
            file: filePath ? filePath : file,
            line: i + 1,
            content: lines[i]
          });
        }
      }
    } catch {
      // 跳过无法读取的文件
      continue;
    }
  }

  logger.debug(`Grep pattern "${pattern}" found ${matches.length} matches`);

  return matches;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/agent-runtime/file-backend.ts
git commit -m "feat: implement FileBackend with ls, read, write, edit, glob, grep"
```

---

### Task 5: 创建文件工具配置

**Files:**

- Create: `src/agent-runtime/file-tools.ts`

- [ ] **Step 1: 创建文件系统工具中间件**

```typescript
import { createFilesystemMiddleware } from "deepagents";
import { FileBackend } from "./file-backend.js";
import { logger } from "../shared/logger.js";

export interface FileToolsConfig {
  rootDir: string;
  maxFileSizeMb?: number;
  enableWrite?: boolean;
}

export function createFileToolsMiddleware(config: FileToolsConfig) {
  const backend = new FileBackend({
    rootDir: config.rootDir,
    maxFileSizeMb: config.maxFileSizeMb,
  });

  logger.info(`Creating filesystem middleware for: ${config.rootDir}`);

  // 使用 DeepAgents 的 createFilesystemMiddleware
  const middleware = createFilesystemMiddleware({
    backend,
    // 禁用 execute 工具（根据需求：不需要命令执行）
    tools: ["ls", "read_file", "write_file", "edit_file", "glob", "grep"],
  });

  return middleware;
}
```

- [ ] **Step 2: 创建工具提示词**

```typescript
export function getFileToolsSystemPrompt(rootDir: string): string {
  return `
你拥有文件系统访问能力。所有文件路径必须使用绝对路径。

### 系统环境
- 工作目录根路径: ${rootDir}

### 可用工具
- ls: 列出目录内容
  用法: ls("${rootDir}/src")
- read_file: 读取文件内容
  用法: read_file("${rootDir}/src/index.ts")
- write_file: 写入文件
  用法: write_file("${rootDir}/src/new.ts", "文件内容")
- edit_file: 编辑文件（替换文本）
  用法: edit_file("${rootDir}/src/index.ts", "旧文本", "新文本")
- glob: 文件模式搜索
  用法: glob("**/*.ts")
- grep: 文件内容搜索（literal 匹配）
  用法: grep("pattern", "${rootDir}/src")

### 文件操作原则
1. 所有路径必须是绝对路径
2. read_file 有文件大小限制（10MB）
3. edit_file 必须精确匹配旧文本
4. grep 仅支持 literal 文本匹配（不支持正则）
`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent-runtime/file-tools.ts
git commit -m "feat: add filesystem tools middleware and system prompt"
```

---

## 阶段三：上下文压缩集成

### Task 6: 创建摘要配置

**Files:**

- Create: `src/agent-runtime/middleware.ts`

- [ ] **Step 1: 定义摘要配置类型**

```typescript
import { createSummarizationMiddleware } from "deepagents";

export interface SummarizationConfig {
  maxTokens: number;
  triggerRatio?: number;
  keepRatio?: number;
  historyPathPrefix?: string;
}

export function computeSummarizationThresholds(config: SummarizationConfig) {
  const triggerRatio = config.triggerRatio ?? 0.75;
  const keepRatio = config.keepRatio ?? 0.1;

  const triggerTokens = Math.floor(config.maxTokens * triggerRatio);
  const keepTokens = Math.max(Math.floor(config.maxTokens * keepRatio), 4000);
  const toolEvictLimit = Math.min(
    20000,
    Math.max(Math.floor(config.maxTokens * 0.08), 6000),
  );
  const trimForSummary = Math.min(700000, Math.floor(config.maxTokens * 0.65));

  return {
    triggerTokens,
    keepTokens,
    toolEvictLimit,
    trimForSummary,
  };
}
```

- [ ] **Step 2: 创建自定义摘要提示词**

```typescript
const AIWIKI_SUMMARY_PROMPT = `
你的任务是为正在进行的 ai-wiki 知识图谱生成项目创建详细的延续摘要。

下一个模型调用将使用你的摘要来继续工作。请编写一个密集、实用的工程交接文档，保留难以或昂贵的恢复细节。

覆盖以下部分：

1. Primary Request and Intent
   - 捕获用户的显式请求、修正、决策和当前期望。
   - 保留确切的日期、分支名称、提交哈希、模型名称、文件路径、配置值。

2. Current Work State
   - 描述在压缩之前正在处理的内容。
   - 分离已完成的工作、进行中的工作和剩余的工作。

3. Files and Code Sections
   - 列出检查、修改或创建的文件。
   - 对于每个重要文件，包括相关的符号、常量、函数或代码路径。

4. Commands and Outputs
   - 记录有意义的命令运行及其结果。
   - 包括测试/类型检查失败、已知无关失败以及已完成的验证。

5. Technical Decisions and Constraints
   - 捕获假设、权衡、被拒绝的方法、提供商/模型限制。

6. Errors, Fixes, and Warnings
   - 记录遇到的错误、根本原因、修复或缓解措施。

7. Pending Next Step
   - 仅在直接跟随最新用户请求时才列出具体的下一步行动。

要简洁的要点，高信息密度。如果用户使用中文，请为面向用户的细节保留中文措辞。

对话摘要：
{conversation}

摘要：
`;
```

- [ ] **Step 3: 创建摘要中间件**

```typescript
import type { StateBackend } from "deepagents";

export function createSummarizationMiddlewareWrapper(
  config: SummarizationConfig,
  backend: StateBackend,
) {
  const thresholds = computeSummarizationThresholds(config);

  return createSummarizationMiddleware({
    model: undefined, // 将在 runtime.ts 中动态设置
    backend,
    historyPathPrefix:
      config.historyPathPrefix ?? ".aiwiki/conversation_history",
    trigger: { type: "tokens", value: thresholds.triggerTokens },
    keep: { type: "tokens", value: thresholds.keepTokens },
    summaryPrompt: AIWIKI_SUMMARY_PROMPT,
    truncateArgsSettings: {
      trigger: { type: "tokens", value: thresholds.triggerTokens },
      keep: { type: "tokens", value: thresholds.keepTokens },
      maxLength: 2000,
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/agent-runtime/middleware.ts
git commit -m "feat: add summarization middleware with custom prompt"
```

---

## 阶段四：多模型支持

### Task 7: 创建路由系统基础

**Files:**

- Create: `src/agent-runtime/routing/types.ts`
- Create: `src/agent-runtime/routing/index.ts`

- [ ] **Step 1: 创建路由类型定义**

```typescript
export interface RoutingContext {
  taskSource: "chat" | "scheduler" | "optimizer";
  message?: string;
  threadId?: string;
  requestedModelId?: string;
  routingMode: "auto" | "pinned";
}

export interface RoutingResult {
  resolvedModelId: string;
  resolvedTier: "premium" | "economy";
  routeReason: string;
  layer: "pinned" | "layer1" | "layer2" | "layer3";
}

export interface ThreadRoutingState {
  lastResolvedTier?: "premium" | "economy";
  lastResolvedModelId?: string;
  lastRoutedAt?: number;
  lastRunOutcome?: "success" | "error" | "cancelled";
  lastToolCallCount?: number;
  lastToolErrorCount?: number;
  premiumStickyUntil?: number;
  forcePremiumUntil?: number;
}
```

- [ ] **Step 2: 创建路由常量和正则**

```typescript
// Layer 2: 任务特征识别
const PREMIUM_TASK_PATTERN =
  /\b(工具|文件|执行|调试|排查|重构|查看|检查|搜索)\b/i;
const ECONOMY_TASK_PATTERN = /\b(写|实现|生成|创建|解释|说明|翻译)\b/i;

// 文件路径检测
const FILE_PATH_PATTERN =
  /(?:^|[\s`"'(])(src\/|app\/|lib\/|[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|md))/;

// 短消息阈值
const ECONOMY_THRESHOLD = 4;
```

- [ ] **Step 3: 实现 Layer 1 路由（用户显式指定）**

```typescript
import type { MultiModelConfig } from "../../config/multi-model-config.js";

export function routeLayer1(
  context: RoutingContext,
  models: MultiModelConfig[],
): RoutingResult | null {
  // 用户显式指定模型 ID
  if (context.requestedModelId) {
    const model = models.find((m) => m.id === context.requestedModelId);
    if (model) {
      return {
        resolvedModelId: model.id,
        resolvedTier: model.tier ?? "premium",
        routeReason: "User specified model",
        layer: "pinned",
      };
    }
  }

  // pinned 模式：使用默认模型
  if (context.routingMode === "pinned") {
    const defaultModel = models[0];
    return {
      resolvedModelId: defaultModel.id,
      resolvedTier: defaultModel.tier ?? "premium",
      routeReason: "Pinned mode: default model",
      layer: "pinned",
    };
  }

  return null;
}
```

- [ ] **Step 4: 实现 Layer 2 路由（任务特征识别）**

```typescript
function requiresToolCapability(message: string): boolean {
  if (PREMIUM_TASK_PATTERN.test(message)) return true;
  if (FILE_PATH_PATTERN.test(message)) return true;
  return false;
}

function scoreSocialEconomy(trimmed: string): {
  result: "economy" | "uncertain";
  score: number;
} {
  // 太长不可能是纯社交
  if (trimmed.length > 40) return { result: "uncertain", score: -1 };

  let score = 0;

  if (trimmed.length <= 10) score += 2;
  else if (trimmed.length <= 25) score += 1;

  if (!/[?？!！:：]/.test(trimmed)) score += 1;

  if (!/[a-zA-Z]{2,}/.test(trimmed)) score += 1;

  if (!/\b(为什么|怎么|如何|帮|什么是|报错|错误|bug)\b/i.test(trimmed))
    score += 2;

  if (/[?？]/.test(trimmed)) score -= 3;

  return {
    result: score >= ECONOMY_THRESHOLD ? "economy" : "uncertain",
    score,
  };
}

export function routeLayer2(
  context: RoutingContext,
  models: MultiModelConfig[],
): RoutingResult | null {
  if (!context.message) return null;

  const message = context.message.trim();

  // 需要工具能力 → premium
  if (requiresToolCapability(message)) {
    const premiumModel = models.find((m) => m.tier === "premium") ?? models[0];
    return {
      resolvedModelId: premiumModel.id,
      resolvedTier: "premium",
      routeReason: "Task requires tool capability",
      layer: "layer2",
    };
  }

  // 简单任务 → economy
  const economyScore = scoreSocialEconomy(message);
  if (economyScore.result === "economy") {
    const economyModel = models.find((m) => m.tier === "economy");
    if (economyModel) {
      return {
        resolvedModelId: economyModel.id,
        resolvedTier: "economy",
        routeReason: `Social/simple message (score: ${economyScore.score})`,
        layer: "layer2",
      };
    }
  }

  return null;
}
```

- [ ] **Step 5: 实现 Layer 3 路由（默认 fallback）**

```typescript
export function routeLayer3(
  context: RoutingContext,
  models: MultiModelConfig[],
): RoutingResult {
  // 默认使用 premium 模型
  const defaultModel = models.find((m) => m.tier === "premium") ?? models[0];

  return {
    resolvedModelId: defaultModel.id,
    resolvedTier: defaultModel.tier ?? "premium",
    routeReason: "Default: uncertain task routing",
    layer: "layer3",
  };
}
```

- [ ] **Step 6: 实现完整路由流程**

```typescript
import { logger } from "../../shared/logger.js";

export function resolveModel(
  context: RoutingContext,
  models: MultiModelConfig[],
): RoutingResult {
  logger.debug(
    `Routing request: source=${context.taskSource}, mode=${context.routingMode}`,
  );

  // Layer 1: 用户指定或 pinned 模式
  const layer1 = routeLayer1(context, models);
  if (layer1) {
    logger.info(`Routing Layer 1: ${layer1.resolvedModelId}`);
    return layer1;
  }

  // Layer 2: 任务特征识别
  const layer2 = routeLayer2(context, models);
  if (layer2) {
    logger.info(
      `Routing Layer 2: ${layer2.resolvedModelId} (${layer2.routeReason})`,
    );
    return layer2;
  }

  // Layer 3: 默认 fallback
  const layer3 = routeLayer3(context, models);
  logger.info(`Routing Layer 3: ${layer3.resolvedModelId}`);

  return layer3;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/agent-runtime/routing/types.ts src/agent-runtime/routing/index.ts
git commit -m "feat: implement model routing system with 3-layer strategy"
```

---

## 阶段五：Agent 运行时组装

### Task 8: 创建 Agent Runtime 核心

**Files:**

- Create: `src/agent-runtime/runtime.ts`

- [ ] **Step 1: 创建 Agent Runtime 配置类型**

```typescript
import type { MultiModelConfig } from "../config/multi-model-config.js";

export interface AgentRuntimeConfig {
  projectRoot: string;
  modelConfig: MultiModelConfig;
  enableFileTools?: boolean;
  enableSummarization?: boolean;
  abortSignal?: AbortSignal;
}

export interface AgentRuntimeOptions extends AgentRuntimeConfig {
  // 运行时可选配置
  threadId?: string;
  extraSystemPrompt?: string;
}
```

- [ ] **Step 2: 创建模型实例工厂**

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { createRetryingFetch } from "../shared/retrying-fetch.js";

export function createModelInstance(config: MultiModelConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    maxRetries: 0, // 使用自定义重试机制
    configuration: {
      baseURL: config.baseUrl,
      fetch: createRetryingFetch(),
    },
  });
}
```

- [ ] **Step 3: 创建 StateBackend**

```typescript
import { StateBackend } from "deepagents";

export function createStateBackend(projectRoot: string): StateBackend {
  return new StateBackend({
    rootDir: projectRoot,
  });
}
```

- [ ] **Step 4: 创建 Agent 组装函数**

```typescript
import { createAgent } from "langchain";
import {
  createFileToolsMiddleware,
  getFileToolsSystemPrompt,
} from "./file-tools.js";
import { createSummarizationMiddlewareWrapper } from "./middleware.js";
import { logger } from "../shared/logger.js";

export async function createAgentRuntime(options: AgentRuntimeOptions) {
  const {
    projectRoot,
    modelConfig,
    enableFileTools = true,
    enableSummarization = true,
    abortSignal,
  } = options;

  logger.info(`Creating Agent runtime for: ${projectRoot}`);
  logger.info(`Model: ${modelConfig.model} (${modelConfig.tier ?? "premium"})`);

  // 创建模型实例
  const model = createModelInstance(modelConfig);

  // 创建 StateBackend
  const backend = createStateBackend(projectRoot);

  // 组装中间件
  const middleware = [];

  // 文件工具中间件
  if (enableFileTools) {
    const fileMiddleware = createFileToolsMiddleware({
      rootDir: projectRoot,
    });
    middleware.push(fileMiddleware);
  }

  // 摘要中间件
  if (enableSummarization) {
    const summarizationConfig = {
      maxTokens: modelConfig.maxTokens ?? 128000,
    };
    const summarizationMiddleware = createSummarizationMiddlewareWrapper(
      summarizationConfig,
      backend,
    );
    middleware.push(summarizationMiddleware);
  }

  // 系统提示词
  let systemPrompt = "";
  if (enableFileTools) {
    systemPrompt += getFileToolsSystemPrompt(projectRoot);
  }

  if (options.extraSystemPrompt) {
    systemPrompt += "\n\n" + options.extraSystemPrompt;
  }

  // 创建 Agent
  const agent = createAgent({
    model,
    systemPrompt,
    middleware,
    // 不使用 checkpointer（根据需求：不需要对话历史持久化）
  });

  logger.info("Agent runtime created successfully");

  return agent;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/agent-runtime/runtime.ts
git commit -m "feat: implement Agent runtime with file tools and summarization"
```

---

### Task 9: 重构现有调用入口

**Files:**

- Modify: `src/generation/llm-client.ts`

- [ ] **Step 1: 创建新的 Agent 调用函数**

```typescript
import {
  createAgentRuntime,
  type AgentRuntimeOptions,
} from "../agent-runtime/runtime.js";
import { resolveModel } from "../agent-runtime/routing/index.js";
import {
  loadMultiModelsFile,
  getValidatedModels,
} from "../config/multi-model-config.js";
import { logger } from "../shared/logger.js";

export interface AgentGenerationOptions {
  projectRoot: string;
  message: string;
  systemPrompt?: string;
  threadId?: string;
  requestedModelId?: string;
}

export async function generateWithAgent(options: AgentGenerationOptions) {
  const { projectRoot, message, systemPrompt, threadId, requestedModelId } =
    options;

  // 加载多模型配置
  const configFile = loadMultiModelsFile(projectRoot);
  if (!configFile) {
    throw new Error("Multi-model configuration not found");
  }

  const models = getValidatedModels(configFile);

  // 路由决策
  const routingContext = {
    taskSource: "chat" as const,
    message,
    threadId,
    requestedModelId,
    routingMode: configFile.routingMode,
  };

  const routingResult = resolveModel(routingContext, models);
  const selectedModel = models.find(
    (m) => m.id === routingResult.resolvedModelId,
  );

  if (!selectedModel) {
    throw new Error(`Model not found: ${routingResult.resolvedModelId}`);
  }

  logger.info(
    `Selected model: ${selectedModel.model} (${routingResult.routeReason})`,
  );

  // 创建 Agent Runtime
  const agentOptions: AgentRuntimeOptions = {
    projectRoot,
    modelConfig: selectedModel,
    enableFileTools: true,
    enableSummarization: true,
    threadId,
    extraSystemPrompt: systemPrompt,
  };

  const agent = await createAgentRuntime(agentOptions);

  // 调用 Agent
  const result = await agent.invoke({
    input: message,
  });

  return {
    text: result.output,
    modelId: selectedModel.id,
    routing: routingResult,
  };
}
```

- [ ] **Step 2: 保持原有函数兼容**

```typescript
// 保留原有的 generateWithClient 函数以兼容旧代码
export async function generateWithClient(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmGenerationResult> {
  const startedAt = new Date().toISOString();
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Try streaming first
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: 0,
      stream: true,
    });

    let text = "";
    let chunks = 0;
    let firstChunkAt: string | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        if (!firstChunkAt) {
          firstChunkAt = new Date().toISOString();
        }
        text += delta;
        chunks++;
      }
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    if (text.trim()) {
      return {
        text,
        mode: "streaming",
        startedAt,
        firstChunkAt,
        finishedAt,
        durationMs,
        chunks,
      };
    }

    return await nonStreamingFallback(
      client,
      model,
      messages,
      startedAt,
      "Empty streaming response",
    );
  } catch (streamError) {
    const errorMsg =
      streamError instanceof Error ? streamError.message : String(streamError);
    logger.warn(`LLM streaming failed, fallback to non-streaming: ${errorMsg}`);
    return await nonStreamingFallback(
      client,
      model,
      messages,
      startedAt,
      errorMsg,
    );
  }
}
```

- [ ] **Step 3: 更新默认配置**

```typescript
// src/config/defaults.ts 新增
export const AGENT_RUNTIME_DEFAULTS = {
  enableFileTools: true,
  enableSummarization: true,
  defaultRoutingMode: "pinned",
};
```

- [ ] **Step 4: Commit**

```bash
git add src/generation/llm-client.ts src/config/defaults.ts
git commit -m "feat: integrate Agent runtime into existing generation module"
```

---

## 阶段六：测试和验证

### Task 10: 创建单元测试

**Files:**

- Create: `tests/unit/agent-runtime/file-backend.test.ts`
- Create: `tests/unit/config/multi-model-config.test.ts`
- Create: `tests/unit/shared/retrying-fetch.test.ts`

- [ ] **Step 1: 创建 FileBackend 测试**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { FileBackend } from "../../../src/agent-runtime/file-backend.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

describe("FileBackend", () => {
  const testDir = join(process.cwd(), "test-workspace");
  let backend: FileBackend;

  beforeEach(() => {
    // 创建测试目录
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "test.txt"), "Hello World");
    mkdirSync(join(testDir, "subdir"), { recursive: true });

    backend = new FileBackend({ rootDir: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should list directory contents", async () => {
    const files = await backend.ls("/");
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.name === "test.txt")).toBe(true);
  });

  it("should read file content", async () => {
    const content = await backend.read_file("test.txt");
    expect(content).toBe("Hello World");
  });

  it("should write file content", async () => {
    const result = await backend.write_file("new.txt", "New content");
    expect(result.path).toBe("new.txt");
    expect(result.bytes).toBeGreaterThan(0);

    const content = await backend.read_file("new.txt");
    expect(content).toBe("New content");
  });

  it("should edit file content", async () => {
    const result = await backend.edit_file("test.txt", "Hello", "Hi");
    expect(result.changes).toBe(1);

    const content = await backend.read_file("test.txt");
    expect(content).toBe("Hi World");
  });

  it("should glob files", async () => {
    const matches = await backend.glob("*.txt");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.includes("test.txt"))).toBe(true);
  });

  it("should grep content", async () => {
    const matches = await backend.grep("Hello");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].content).toContain("Hello");
  });

  it("should reject path outside root", async () => {
    await expect(backend.read_file("../outside.txt")).rejects.toThrow(
      "outside root",
    );
  });
});
```

- [ ] **Step 2: 创建多模型配置测试**

```typescript
import { describe, it, expect } from "vitest";
import {
  loadMultiModelsFile,
  resolveApiKey,
  validateModelConfig,
  getValidatedModels,
} from "../../../src/config/multi-model-config.js";
import { writeFileSync } from "fs";
import { join } from "path";

describe("MultiModelConfig", () => {
  const testConfigPath = join(process.cwd(), "test-multi-models.json");

  beforeEach(() => {
    const testConfig = {
      models: [
        {
          id: "test-model",
          name: "Test Model",
          baseUrl: "https://api.test.com/v1",
          model: "test-model-v1",
          apiKey: "${TEST_API_KEY}",
          maxTokens: 100000,
          tier: "premium",
        },
      ],
      routingMode: "auto",
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig));
    process.env.TEST_API_KEY = "test-key-123";
  });

  afterEach(() => {
    rmSync(testConfigPath, { force: true });
    delete process.env.TEST_API_KEY;
  });

  it("should load config file", () => {
    const config = loadMultiModelsFile(process.cwd());
    expect(config).not.toBeNull();
    expect(config?.models.length).toBe(1);
  });

  it("should resolve API key from env", () => {
    const resolved = resolveApiKey("${TEST_API_KEY}");
    expect(resolved).toBe("test-key-123");
  });

  it("should validate model config", () => {
    const validConfig = {
      id: "valid",
      baseUrl: "https://api.valid.com",
      model: "valid-model",
      apiKey: "key",
    };

    expect(() => validateModelConfig(validConfig)).not.toThrow();
  });

  it("should reject invalid config", () => {
    const invalidConfig = {
      id: "",
      baseUrl: "invalid-url",
      model: "",
      apiKey: "",
    };

    expect(() => validateModelConfig(invalidConfig)).toThrow();
  });
});
```

- [ ] **Step 3: 创建重试机制测试**

```typescript
import { describe, it, expect } from "vitest";
import {
  createRetryingFetch,
  isRetryableStatus,
  computeBackoffDelay,
} from "../../../src/shared/retrying-fetch.js";

describe("RetryingFetch", () => {
  it("should identify retryable status codes", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it("should compute exponential backoff", () => {
    const delay1 = computeBackoffDelay(1, 1000);
    expect(delay1).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeLessThanOrEqual(2000);

    const delay2 = computeBackoffDelay(2, 1000);
    expect(delay2).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeLessThanOrEqual(4000);
  });

  it("should retry on network error", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Network error");
      }
      return new Response("OK", { status: 200 });
    };

    const retryingFetch = createRetryingFetch({
      maxAttempts: 5,
      baseDelayMs: 100,
    });
    // 模拟 fetch
    global.fetch = mockFetch;

    const result = await retryingFetch("http://test.com");
    expect(result.status).toBe(200);
    expect(attempts).toBe(3);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add tests/unit/agent-runtime/file-backend.test.ts tests/unit/config/multi-model-config.test.ts tests/unit/shared/retrying-fetch.test.ts
git commit -m "feat: add unit tests for agent runtime components"
```

---

### Task 11: 创建集成测试

**Files:**

- Create: `tests/integration/agent-runtime.test.ts`

- [ ] **Step 1: 创建 Agent Runtime 集成测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentRuntime } from "../../../src/agent-runtime/runtime.js";
import {
  loadMultiModelsFile,
  getValidatedModels,
} from "../../../src/config/multi-model-config.js";
import { resolveModel } from "../../../src/agent-runtime/routing/index.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

describe("Agent Runtime Integration", () => {
  const testDir = join(process.cwd(), "test-integration");
  const configPath = join(testDir, "multi-models.json");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });

    const config = {
      models: [
        {
          id: "test-model",
          name: "Test Model",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKey: process.env.OPENAI_API_KEY ?? "test-key",
          maxTokens: 100000,
          tier: "premium",
        },
      ],
      routingMode: "pinned",
    };

    writeFileSync(configPath, JSON.stringify(config));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create agent runtime", async () => {
    const configFile = loadMultiModelsFile(testDir);
    const models = getValidatedModels(configFile!);
    const model = models[0];

    const agent = await createAgentRuntime({
      projectRoot: testDir,
      modelConfig: model,
    });

    expect(agent).toBeDefined();
  });

  it("should route to correct model", () => {
    const configFile = loadMultiModelsFile(testDir);
    const models = getValidatedModels(configFile!);

    const routing = resolveModel(
      {
        taskSource: "chat",
        message: "查看 src/index.ts 文件",
        routingMode: "auto",
      },
      models,
    );

    expect(routing.resolvedTier).toBe("premium");
    expect(routing.layer).toBe("layer2");
  });

  it("should handle file operations", async () => {
    writeFileSync(join(testDir, "test.txt"), "Hello");

    const configFile = loadMultiModelsFile(testDir);
    const models = getValidatedModels(configFile!);
    const model = models[0];

    const agent = await createAgentRuntime({
      projectRoot: testDir,
      modelConfig: model,
    });

    // 测试 Agent 是否能处理文件操作请求
    // 注意：此测试需要真实的模型 API，在 CI 中可以 mock
    const result = await agent.invoke({
      input: "读取 test.txt 文件内容",
    });

    expect(result.output).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npm run test:integration`
Expected: 测试通过（或跳过，如果无真实 API）

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agent-runtime.test.ts
git commit -m "feat: add integration tests for agent runtime"
```

---

## 最终提交和文档

### Task 12: 更新文档

**Files:**

- Modify: `README.md`
- Create: `docs/agent-runtime-guide.md`

- [ ] **Step 1: 创建 Agent Runtime 使用指南**

````markdown
# Agent Runtime 使用指南

## 快速开始

### 1. 配置多模型

创建 `multi-models.json` 文件：

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "apiKey": "${OPENAI_API_KEY}",
      "maxTokens": 128000,
      "tier": "premium"
    }
  ],
  "routingMode": "pinned"
}
```
````

### 2. 使用 Agent Runtime

```typescript
import { generateWithAgent } from "./src/generation/llm-client.js";

const result = await generateWithAgent({
  projectRoot: "/path/to/project",
  message: "查看 src/index.ts 文件内容",
  systemPrompt: "你是一个代码助手",
});

console.log(result.text);
console.log(result.routing); // 路由决策信息
```

## 核心能力

### 文件工具

- `ls`: 列出目录
- `read_file`: 读取文件
- `write_file`: 写入文件
- `edit_file`: 编辑文件
- `glob`: 文件搜索
- `grep`: 内容搜索

### 上下文压缩

- 自动触发摘要（75% token 阈值）
- 保留最近对话历史（10%）
- 工具参数自动截断

### 多模型路由

- Layer 1: 用户指定或 pinned 模式
- Layer 2: 任务特征识别
- Layer 3: 默认 fallback

## 配置说明

### routingMode

- `pinned`: 使用固定模型（默认）
- `auto`: 根据任务特征自动选择

### tier

- `premium`: 高能力模型（支持工具调用）
- `economy`: 经济模型（简单任务）

## 示例

### 文件操作

```typescript
await generateWithAgent({
  projectRoot: process.cwd(),
  message: "读取 src/config.ts 文件并解释主要功能",
});
```

### 多模型路由

```typescript
// 使用 economy 模型处理简单任务
await generateWithAgent({
  projectRoot: process.cwd(),
  message: "翻译这段文字",
  routingMode: "auto",
});
```

````

- [ ] **Step 2: 更新 README**

在 README 中添加 Agent Runtime 说明部分。

- [ ] **Step 3: Commit**

```bash
git add docs/agent-runtime-guide.md README.md
git commit -m "docs: add Agent Runtime usage guide"
````

---

## 实施检查清单

### 完成后验证

- [ ] 所有依赖已安装且版本正确
- [ ] multi-models.json 配置文件已创建
- [ ] 文件工具正常工作（ls、read、write、edit、glob、grep）
- [ ] 上下文压缩中间件正确配置
- [ ] 多模型路由按预期工作（Layer 1-3）
- [ ] 统一重试机制已集成
- [ ] 所有单元测试通过
- [ ] Agent Runtime 能正常调用
- [ ] 文档已更新

### 性能指标

- 文件工具响应时间 < 100ms（本地文件）
- 模型路由决策时间 < 50ms
- 摘要触发不影响正常响应时间

### 安全检查

- 文件路径限制在 rootDir 内
- API key 通过环境变量管理
- 无敏感信息泄露风险

---

**实施总工期：10-14 天**

**风险等级：中等（新框架引入，需仔细测试）**
