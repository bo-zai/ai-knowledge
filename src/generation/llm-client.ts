import OpenAI from 'openai';
import type { ModelConfig } from '../config/model-config.js';

export function createOpenAiClient(config: ModelConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}

export async function generateWithClient(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
  });
  return response.choices[0]?.message?.content ?? '';
}