---
title: LLM 配置优化设计
date: 2026-06-05
status: draft
---

## 概述

优化 CLI generate 命令的 LLM 配置方式：

1. 去掉 `--model`、`--base-url`、`--api-key-env` 三个 CLI 参数
2. 在配置文件中增加并发参数、超时参数、重试次数
3. 集中管理默认值，避免魔法数字散落

## 配置文件结构

新的 `llm.config.json` 结构：

```json
{
  "model": "qianfan-code-latest",
  "baseUrl": "https://qianfan.baidubce.com/v2/coding",
  "apiKey": "...",
  "concurrency": 3,
  "timeout": 120,
  "maxRetries": 3
}
```

**字段说明：**
| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | 否 | `gpt-4o` | LLM 模型名称 |
| `baseUrl` | string | 否 | `https://api.openai.com/v1` | API 基础 URL |
| `apiKey` | string | 否 | 空 | API 密钥（直接提供） |
| `apiKeyEnv` | string | 否 | `OPENAI_API_KEY` | API 密钥环境变量名 |
| `concurrency` | number | 否 | 3 | 全局 LLM 并发数 |
| `timeout` | number | 否 | 120 | 单次调用超时（秒） |
| `maxRetries` | number | 否 | 3 | 最大重试次数 |

**单位约定：**

- 配置文件中 `timeout` 单位为秒（用户友好）
- 内部使用 `timeoutMs` 单位为毫秒（代码友好）

## 默认值集中管理

创建/扩展 `src/config/defaults.ts`：

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

**使用位置：**

- `model-config.ts` - 配置加载时引用
- `llm-json-client.ts` - 默认参数引用
- `generate.ts` - 并发控制引用

## 类型定义

扩展 `src/config/model-config.ts`：

```typescript
import { LLM_DEFAULTS } from "./defaults.js";

export interface LlmConfigFile {
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;

  concurrency?: number;
  timeout?: number;
  maxRetries?: number;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
  concurrency: number;
  timeoutMs: number; // 内部使用毫秒
  maxRetries: number;
}
```

## 配置加载逻辑

更新 `resolveModelConfig` 函数：

```typescript
export function resolveModelConfig(input: {
  fileConfig?: LlmConfigFile;
}): ModelConfig {
  const fileConfig = input.fileConfig;

  // 验证可选字段
  if (
    fileConfig?.concurrency !== undefined &&
    (typeof fileConfig.concurrency !== "number" || fileConfig.concurrency < 1)
  ) {
    logger.warn("Invalid concurrency value, using default");
    fileConfig.concurrency = undefined;
  }

  if (
    fileConfig?.timeout !== undefined &&
    (typeof fileConfig.timeout !== "number" || fileConfig.timeout < 1)
  ) {
    logger.warn("Invalid timeout value, using default");
    fileConfig.timeout = undefined;
  }

  // 单位转换：秒 → 毫秒
  const timeoutSeconds = fileConfig?.timeout ?? LLM_DEFAULTS.timeoutSeconds;
  const timeoutMs = timeoutSeconds * 1000;

  return {
    baseUrl: fileConfig?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    apiKey: fileConfig?.apiKey ?? "",
    apiKeyEnv: fileConfig?.apiKeyEnv ?? LLM_DEFAULTS.apiKeyEnv,
    model: fileConfig?.model ?? LLM_DEFAULTS.model,
    concurrency: fileConfig?.concurrency ?? LLM_DEFAULTS.concurrency,
    timeoutMs,
    maxRetries: fileConfig?.maxRetries ?? LLM_DEFAULTS.maxRetries,
  };
}
```

**加载策略：**

- 用户指定 `--llm-config <path>`：加载指定配置文件
- 用户未指定：直接使用 `LLM_DEFAULTS`
- 不自动查找 `./llm.config.json`

**删除的函数：**

- `loadDefaultLlmConfigFile` - 不再需要自动查找默认配置文件

## CLI 改动

**删除的参数（`cli/index.ts`）：**

- `--model <name>`
- `--base-url <url>`
- `--api-key-env <name>`

**保留的参数：**

- `--llm-config <path>` - 指定配置文件路径

**使用示例：**

```bash
# 使用默认配置
rkg generate

# 使用自定义配置
rkg generate --llm-config ./my-llm-config.json
```

## 参数传递链路

```
CLI (index.ts)
  ↓ --llm-config (可选)
generate.ts
  ↓ loadLlmConfigFile (如果指定)
  ↓ resolveModelConfig → ModelConfig
并发控制 / LLM 调用
  ↓ 使用 concurrency、timeoutMs、maxRetries
```

**generate.ts 改动要点：**

```typescript
// 加载配置（仅当指定时）
const fileConfig = options.llmConfig
  ? await loadLlmConfigFile(options.llmConfig)
  : undefined;

const modelConfig = resolveModelConfig({ fileConfig });

// 并发控制：替换硬编码 pLimit(2)、pLimit(3)
const limit = pLimit(modelConfig.concurrency);

// LLM 调用：传入配置参数
const llmResult = await callLlmForJson({
  ...,
  maxRetries: modelConfig.maxRetries,
  timeout: modelConfig.timeoutMs,
});
```

## 错误处理

**配置文件加载错误：**

- 文件不存在：抛出错误，终止生成
- JSON 解析失败：抛出解析错误

**配置值验证：**
| 场景 | 处理方式 |
|------|----------|
| `concurrency` 为 0 或负数 | 警告 + 使用默认值 3 |
| `timeout` 为 0 或负数 | 警告 + 使用默认值 120 |
| `maxRetries` 为 0 或负数 | 警告 + 使用默认值 3 |
| 配置文件缺少可选字段 | 使用对应默认值 |

**日志提示：**

- 使用默认配置：`logger.info('Using default LLM configuration')`
- 加载自定义配置：`logger.info('Using LLM config from: <path>')`

## 测试策略

**配置加载测试：**

- 有 `--llm-config` 时正确加载
- 无 `--llm-config` 时使用默认值
- 配置文件不存在时抛出错误

**默认值测试：**

- `LLM_DEFAULTS` 各字段值正确
- 单位转换（秒 → 毫秒）正确

**边界值测试：**

- 无效 `concurrency` → 回退默认值
- 无效 `timeout` → 回退默认值
- 无效 `maxRetries` → 回退默认值

**集成测试：**

- 并发控制实际生效
- 超时机制正确中断
- 重试次数符合配置

## 改动文件清单

| 文件                                | 改动类型  | 说明                                 |
| ----------------------------------- | --------- | ------------------------------------ |
| `src/cli/index.ts`                  | 修改      | 删除 3 个 CLI 参数                   |
| `src/cli/generate.ts`               | 修改      | 简化配置加载逻辑                     |
| `src/config/model-config.ts`        | 修改      | 扩展类型、更新加载逻辑、删除自动查找 |
| `src/config/defaults.ts`            | 修改/创建 | 添加 LLM_DEFAULTS                    |
| `src/generation/llm-json-client.ts` | 修改      | 接收外部配置参数                     |
| `src/generation/generate.ts`        | 修改      | 使用配置并发数替代硬编码             |
