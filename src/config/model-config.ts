import type OpenAI from 'openai';

import { fileExists, readText } from '../shared/fs.js';
import { LLM_DEFAULTS } from './defaults.js';

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

export async function loadDefaultLlmConfigFile(cwd = process.cwd()): Promise<LlmConfigFile | undefined> {
  const defaultPath = `${cwd}/llm.config.json`;
  if (!(await fileExists(defaultPath))) {
    return undefined;
  }

  return loadLlmConfigFile(defaultPath);
}

export function resolveModelConfig(input: {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  fileConfig?: LlmConfigFile;
  env?: Record<string, string | undefined>;
}): ModelConfig {
  const env = input.env ?? process.env;
  const apiKeyEnv = input.apiKeyEnv ?? input.fileConfig?.apiKeyEnv ?? 'OPENAI_API_KEY';
  const apiKey = input.apiKey ?? input.fileConfig?.apiKey ?? env[apiKeyEnv] ?? '';

  return {
    baseUrl: input.baseUrl ?? input.fileConfig?.baseUrl ?? 'https://api.openai.com/v1',
    apiKey,
    apiKeyEnv,
    model: input.model ?? input.fileConfig?.model ?? 'gpt-4o',
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
