import type OpenAI from 'openai';

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function resolveModelConfig(input: Partial<ModelConfig>): ModelConfig {
  return {
    baseUrl: input.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: input.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    model: input.model ?? 'gpt-4o',
  };
}

export function createOpenAiClient(config: ModelConfig): OpenAI {
  // 动态导入避免副作用
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpenAI = require('openai').default;
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}