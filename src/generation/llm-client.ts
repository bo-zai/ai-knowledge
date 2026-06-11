import OpenAI from 'openai';
import type { ModelConfig } from '../config/model-config.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { logger } from '../shared/logger.js';

export function createOpenAiClient(config: ModelConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
  });
}

/**
 * LLM generation result with streaming metadata.
 */
export interface LlmGenerationResult {
  text: string;
  mode: 'streaming' | 'non_streaming_fallback';
  startedAt: string;
  firstChunkAt?: string;
  finishedAt: string;
  durationMs: number;
  chunks: number;
  streamError?: string;
}

/**
 * Generate completion with streaming-first approach.
 * Falls back to non-streaming if streaming fails.
 */
export async function generateWithClient(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmGenerationResult> {
  const startedAt = new Date().toISOString();
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Try streaming first
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: 0,
      stream: true,
    });

    let text = '';
    let chunks = 0;
    let firstChunkAt: string | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
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

    // Check if we got any content
    if (text.trim()) {
      return {
        text,
        mode: 'streaming',
        startedAt,
        firstChunkAt,
        finishedAt,
        durationMs,
        chunks,
      };
    }

    // Empty response - fallback to non-streaming
    return await nonStreamingFallback(client, model, messages, startedAt, 'Empty streaming response');
  } catch (streamError) {
    // Streaming failed - fallback to non-streaming
    const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
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

/**
 * Non-streaming fallback helper.
 */
async function nonStreamingFallback(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  startedAt: string,
  streamError: string,
): Promise<LlmGenerationResult> {
  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0,
    });

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    logger.debug(`LLM non-streaming fallback succeeded in ${durationMs}ms`);

    return {
      text: response.choices[0]?.message?.content ?? '',
      mode: 'non_streaming_fallback',
      startedAt,
      finishedAt,
      durationMs,
      chunks: 0,
      streamError,
    };
  } catch (nonStreamError) {
    const errorMsg = nonStreamError instanceof Error ? nonStreamError.message : String(nonStreamError);
    logger.error(`LLM non-streaming fallback failed: ${errorMsg}`);
    // 向上抛出异常，由调用者处理
    throw nonStreamError;
  }
}