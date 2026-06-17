# LLM 配置优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 CLI 的 LLM 参数，扩展配置文件支持并发、超时、重试，集中管理默认值。

**Architecture:** 配置从 CLI 参数改为配置文件加载，默认值集中在 `LLM_DEFAULTS` 常量，配置传递链路简化为 `CLI → generate.ts → resolveModelConfig → 并发控制/LLM调用`。

**Tech Stack:** TypeScript, Commander CLI, p-limit 并发控制

---

## Task 1: 添加 LLM 默认值常量

**Files:**

- Modify: `src/config/defaults.ts`
- Test: 无（常量无需测试）

- [ ] **Step 1: 检查 defaults.ts 现有内容**

Run: 读取 `src/config/defaults.ts` 查看现有结构

- [ ] **Step 2: 添加 LLM_DEFAULTS 常量**

```typescript
/** LLM 配置默认值 */
export const LLM_DEFAULTS = {
  model: "gpt-4o",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",

  concurrency: 3,
  timeoutSeconds: 120,
  maxRetries: 3,
};
```

将此常量添加到 `defaults.ts` 文件末尾。

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/config/defaults.ts
git commit -m "feat(config): add LLM_DEFAULTS constant for centralized defaults"
```

---

## Task 2: 扩展类型定义

**Files:**

- Modify: `src/config/model-config.ts`
- Test: 无（类型定义变更，后续测试验证）

- [ ] **Step 1: 添加 import**

在 `model-config.ts` 顶部添加：

```typescript
import { LLM_DEFAULTS } from "./defaults.js";
```

- [ ] **Step 2: 扩展 LlmConfigFile 接口**

修改 `LlmConfigFile` 接口，添加新字段：

```typescript
export interface LlmConfigFile {
  /** LLM 模型名称 */
  model?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** API 密钥环境变量名 */
  apiKeyEnv?: string;
  /** API 密钥（直接提供，可选） */
  apiKey?: string;

  /** 全局 LLM 并发数 */
  concurrency?: number;
  /** 单次调用超时（秒） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}
```

- [ ] **Step 3: 扩展 ModelConfig 接口**

修改 `ModelConfig` 接口，添加新字段：

```typescript
export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
  /** 全局并发数 */
  concurrency: number;
  /** 超时（毫秒，内部使用） */
  timeoutMs: number;
  /** 最大重试次数 */
  maxRetries: number;
}
```

- [ ] **Step 4: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/config/model-config.ts
git commit -m "feat(config): extend LlmConfigFile and ModelConfig with concurrency, timeout, maxRetries"
```

---

## Task 3: 重写 resolveModelConfig 函数

**Files:**

- Modify: `src/config/model-config.ts`
- Test: 创建 `tests/config/model-config.test.ts`

- [ ] **Step 1: 创建测试文件**

创建 `tests/config/model-config.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { resolveModelConfig } from "../../src/config/model-config.js";
import { LLM_DEFAULTS } from "../../src/config/defaults.js";

describe("resolveModelConfig", () => {
  it("should use defaults when no file config provided", () => {
    const result = resolveModelConfig({});
    expect(result.model).toBe(LLM_DEFAULTS.model);
    expect(result.baseUrl).toBe(LLM_DEFAULTS.baseUrl);
    expect(result.apiKeyEnv).toBe(LLM_DEFAULTS.apiKeyEnv);
    expect(result.concurrency).toBe(LLM_DEFAULTS.concurrency);
    expect(result.timeoutMs).toBe(LLM_DEFAULTS.timeoutSeconds * 1000);
    expect(result.maxRetries).toBe(LLM_DEFAULTS.maxRetries);
  });

  it("should override values from file config", () => {
    const result = resolveModelConfig({
      fileConfig: {
        model: "custom-model",
        concurrency: 5,
        timeout: 60,
        maxRetries: 2,
      },
    });
    expect(result.model).toBe("custom-model");
    expect(result.concurrency).toBe(5);
    expect(result.timeoutMs).toBe(60000);
    expect(result.maxRetries).toBe(2);
  });

  it("should fallback to defaults for invalid concurrency", () => {
    const result = resolveModelConfig({
      fileConfig: { concurrency: 0 },
    });
    expect(result.concurrency).toBe(LLM_DEFAULTS.concurrency);
  });

  it("should fallback to defaults for invalid timeout", () => {
    const result = resolveModelConfig({
      fileConfig: { timeout: -1 },
    });
    expect(result.timeoutMs).toBe(LLM_DEFAULTS.timeoutSeconds * 1000);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/config/model-config.test.ts`
Expected: FAIL - resolveModelConfig 参数不匹配

- [ ] **Step 3: 重写 resolveModelConfig**

修改 `resolveModelConfig` 函数：

```typescript
import { logger } from "../shared/logger.js";

export function resolveModelConfig(input: {
  fileConfig?: LlmConfigFile;
}): ModelConfig {
  const fileConfig = input.fileConfig;

  // 验证并发数
  let concurrency = fileConfig?.concurrency ?? LLM_DEFAULTS.concurrency;
  if (
    typeof fileConfig?.concurrency !== "number" ||
    fileConfig.concurrency < 1
  ) {
    if (fileConfig?.concurrency !== undefined) {
      logger.warn(
        `Invalid concurrency value (${fileConfig.concurrency}), using default ${LLM_DEFAULTS.concurrency}`,
      );
    }
    concurrency = LLM_DEFAULTS.concurrency;
  }

  // 验证超时
  let timeoutSeconds = fileConfig?.timeout ?? LLM_DEFAULTS.timeoutSeconds;
  if (typeof fileConfig?.timeout !== "number" || fileConfig.timeout < 1) {
    if (fileConfig?.timeout !== undefined) {
      logger.warn(
        `Invalid timeout value (${fileConfig.timeout}), using default ${LLM_DEFAULTS.timeoutSeconds}`,
      );
    }
    timeoutSeconds = LLM_DEFAULTS.timeoutSeconds;
  }

  // 验证重试次数
  let maxRetries = fileConfig?.maxRetries ?? LLM_DEFAULTS.maxRetries;
  if (typeof fileConfig?.maxRetries !== "number" || fileConfig.maxRetries < 1) {
    if (fileConfig?.maxRetries !== undefined) {
      logger.warn(
        `Invalid maxRetries value (${fileConfig.maxRetries}), using default ${LLM_DEFAULTS.maxRetries}`,
      );
    }
    maxRetries = LLM_DEFAULTS.maxRetries;
  }

  // 单位转换：秒 → 毫秒
  const timeoutMs = timeoutSeconds * 1000;

  return {
    baseUrl: fileConfig?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    apiKey: fileConfig?.apiKey ?? "",
    apiKeyEnv: fileConfig?.apiKeyEnv ?? LLM_DEFAULTS.apiKeyEnv,
    model: fileConfig?.model ?? LLM_DEFAULTS.model,
    concurrency,
    timeoutMs,
    maxRetries,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/config/model-config.test.ts`
Expected: PASS

- [ ] **Step 5: 删除 loadDefaultLlmConfigFile 函数**

删除 `loadDefaultLlmConfigFile` 函数及其相关代码（约 6-8 行）。

- [ ] **Step 6: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/config/model-config.ts tests/config/model-config.test.ts
git commit -m "feat(config): rewrite resolveModelConfig with validation, remove loadDefaultLlmConfigFile"
```

---

## Task 4: 删除 CLI 参数

**Files:**

- Modify: `src/cli/index.ts`

- [ ] **Step 1: 删除三个 CLI 参数定义**

删除以下三行：

```typescript
.option('--model <name>', 'LLM model name')
.option('--base-url <url>', 'LLM API base URL')
.option('--api-key-env <name>', 'Environment variable for API key')
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): remove --model, --base-url, --api-key-env parameters"
```

---

## Task 5: 简化 generate.ts 配置加载

**Files:**

- Modify: `src/cli/generate.ts`

- [ ] **Step 1: 删除 GenerateOptions 中的旧字段**

修改 `GenerateOptions` 接口，删除三个字段：

```typescript
interface GenerateOptions {
  repo?: string;
  path?: string;
  knowledge?: string;
  target?: string;
  out?: string;
  llmConfig?: string;
  forceAnalyze?: boolean;
  verbose?: boolean;
  logFile?: string;
}
```

删除：`model?: string;`, `baseUrl?: string;`, `apiKeyEnv?: string;`

- [ ] **Step 2: 简化配置加载逻辑**

找到配置加载代码块（约 558-576 行），替换为：

```typescript
// Load model config
const fileConfig = options.llmConfig
  ? await loadLlmConfigFile(options.llmConfig)
  : undefined;

const modelConfig = resolveModelConfig({ fileConfig });

const apiKey =
  modelConfig.apiKey || getEnvVarOptional(modelConfig.apiKeyEnv) || "";
const finalConfig: ModelConfig = {
  ...modelConfig,
  apiKey,
};

const mockMode = isMockModel(finalConfig.model);

logger.info(
  `Using LLM config: model=${finalConfig.model}, concurrency=${finalConfig.concurrency}, timeout=${finalConfig.timeoutMs}ms`,
);
```

- [ ] **Step 3: 更新后续使用 modelConfig 的代码**

搜索 `modelConfig` 变量的使用位置，确保使用 `finalConfig`。

主要位置：

- 约 606 行：`archClientConfig: ModelConfig` → 使用 `finalConfig`
- 约 657-661 行：`clientConfig` → 使用 `finalConfig`
- 约 768-773 行：`orchestrationInput.llm` → 简化

- [ ] **Step 4: 简化 orchestrationInput.llm**

修改：

```typescript
const orchestrationInput: GenerateOrchestrationInput = {
  repoPath,
  outputRoot,
  scope,
  graphStatus,
  layout,
  forceAnalyze: options.forceAnalyze,
  verbose: options.verbose,
  llm: {
    llmConfig: options.llmConfig,
  },
};
```

- [ ] **Step 5: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/cli/generate.ts
git commit -m "feat(cli): simplify config loading, use centralized defaults"
```

---

## Task 6: 更新并发控制使用配置值

**Files:**

- Modify: `src/cli/generate.ts`

- [ ] **Step 1: 替换 Layer 3 并发硬编码**

找到约 135 行：

```typescript
const limit = pLimit(2);
```

替换为：

```typescript
const limit = pLimit(finalConfig.concurrency);
```

- [ ] **Step 2: 替换 Layer 5 并发硬编码**

找到约 219 行：

```typescript
const generateLimit = pLimit(3);
```

替换为：

```typescript
const generateLimit = pLimit(finalConfig.concurrency);
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/cli/generate.ts
git commit -m "feat(cli): use config concurrency instead of hardcoded values"
```

---

## Task 7: 更新 llm-json-client 使用配置参数

**Files:**

- Modify: `src/generation/llm-json-client.ts`

- [ ] **Step 1: 添加 import**

在文件顶部添加：

```typescript
import { LLM_DEFAULTS } from "../config/defaults.js";
```

- [ ] **Step 2: 更新 DEFAULT_TIMEOUT_MS 和 DEFAULT_MAX_RETRIES**

找到约 98-100 行：

```typescript
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 3;
```

替换为：

```typescript
const DEFAULT_TIMEOUT_MS = LLM_DEFAULTS.timeoutSeconds * 1000;
const DEFAULT_MAX_RETRIES = LLM_DEFAULTS.maxRetries;
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/generation/llm-json-client.ts
git commit -m "feat(llm): use LLM_DEFAULTS for timeout and maxRetries defaults"
```

---

## Task 8: 验证整体功能

**Files:**

- 无文件改动

- [ ] **Step 1: 运行完整测试**

Run: `npx vitest run`
Expected: 所有测试通过

- [ ] **Step 2: 验证 CLI 帮助信息**

Run: `npx rkg generate --help`
Expected: 不显示 `--model`, `--base-url`, `--api-key-env`

- [ ] **Step 3: 手动验证配置加载（可选）**

创建临时配置文件测试：

```json
{
  "model": "test-model",
  "concurrency": 5,
  "timeout": 60
}
```

Run: `npx rkg generate --llm-config ./test-config.json --verbose`
Expected: 日志显示正确配置值

---

## Task 9: 最终提交整理

**Files:**

- 无文件改动

- [ ] **Step 1: 查看所有改动**

Run: `git log --oneline -10`
Expected: 7 个提交

- [ ] **Step 2: 确认无遗漏**

检查所有文件改动：

- `src/config/defaults.ts` - LLM_DEFAULTS 添加
- `src/config/model-config.ts` - 类型扩展、函数重写
- `src/cli/index.ts` - CLI 参数删除
- `src/cli/generate.ts` - 配置简化、并发更新
- `src/generation/llm-json-client.ts` - 默认值引用

---

## 总结

改动完成后的配置链路：

```
用户 --llm-config (可选)
  ↓
loadLlmConfigFile → fileConfig
  ↓
resolveModelConfig({ fileConfig })
  ↓
ModelConfig (concurrency, timeoutMs, maxRetries)
  ↓
并发控制 pLimit(modelConfig.concurrency)
LLM 调用 callLlmForJson(maxRetries, timeout)
```

**关键改动点：**

1. 默认值集中在 `LLM_DEFAULTS`
2. CLI 参数减少，简化用户使用
3. 配置文件支持并发、超时、重试
4. 并发控制从硬编码改为配置驱动
