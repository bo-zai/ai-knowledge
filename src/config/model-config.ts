import type OpenAI from 'openai';

import { fileExists, readText } from '../shared/fs.js';
import { LLM_DEFAULTS } from './defaults.js';
import { logger } from '../shared/logger.js';

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

export async function loadLlmConfigFile(configPath: string): Promise<LlmConfigFile> {
  if (!(await fileExists(configPath))) {
    throw new Error(`LLM config file not found: ${configPath}`);
  }

  const content = await readText(configPath);
  const parsed = JSON.parse(content) as LlmConfigFile | null;
  return parsed ?? {};
}

export function resolveModelConfig(input: {
  fileConfig?: LlmConfigFile;
}): ModelConfig {
  const fileConfig = input.fileConfig;

  // 验证并发数
  let concurrency = fileConfig?.concurrency ?? LLM_DEFAULTS.concurrency;
  if (typeof fileConfig?.concurrency !== 'number' || fileConfig.concurrency < 1) {
    if (fileConfig?.concurrency !== undefined) {
      logger.warn(`Invalid concurrency value (${fileConfig.concurrency}), using default ${LLM_DEFAULTS.concurrency}`);
    }
    concurrency = LLM_DEFAULTS.concurrency;
  }

  // 验证超时
  let timeoutSeconds = fileConfig?.timeout ?? LLM_DEFAULTS.timeoutSeconds;
  if (typeof fileConfig?.timeout !== 'number' || fileConfig.timeout < 1) {
    if (fileConfig?.timeout !== undefined) {
      logger.warn(`Invalid timeout value (${fileConfig.timeout}), using default ${LLM_DEFAULTS.timeoutSeconds}`);
    }
    timeoutSeconds = LLM_DEFAULTS.timeoutSeconds;
  }

  // 验证重试次数
  let maxRetries = fileConfig?.maxRetries ?? LLM_DEFAULTS.maxRetries;
  if (typeof fileConfig?.maxRetries !== 'number' || fileConfig.maxRetries < 1) {
    if (fileConfig?.maxRetries !== undefined) {
      logger.warn(`Invalid maxRetries value (${fileConfig.maxRetries}), using default ${LLM_DEFAULTS.maxRetries}`);
    }
    maxRetries = LLM_DEFAULTS.maxRetries;
  }

  // 单位转换：秒 → 毫秒
  const timeoutMs = timeoutSeconds * 1000;

  return {
    baseUrl: fileConfig?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    apiKey: fileConfig?.apiKey ?? LLM_DEFAULTS.apiKey,
    apiKeyEnv: fileConfig?.apiKeyEnv ?? LLM_DEFAULTS.apiKeyEnv,
    model: fileConfig?.model ?? LLM_DEFAULTS.model,
    concurrency,
    timeoutMs,
    maxRetries,
  };
}

export async function createOpenAiClient(config: ModelConfig): Promise<OpenAI> {
  const mod = await import('openai');
  const OpenAI = mod.default;
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}
