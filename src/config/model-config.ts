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

export async function createOpenAiClient(config: ModelConfig): Promise<OpenAI> {
  const mod = await import('openai');
  const OpenAI = mod.default;
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}