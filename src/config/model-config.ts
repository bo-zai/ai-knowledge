import type OpenAI from 'openai';

import { fileExists, readText } from '../shared/fs.js';

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  model: string;
}

export interface LlmConfigFile {
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
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
