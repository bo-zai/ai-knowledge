/**
 * LLM Claims Provider 工厂函数
 */

import OpenAI from "openai";
import type { LlmClaimsProvider } from "./knowledge-generator.js";
import type { LlmCallInput, LlmCallResult } from "./llm-types.js";
import {
  generateWithClient,
  generateWithMessages,
  createOpenAiClient,
} from "./llm-client.js";
import type { ModelConfig } from "../config/model-config.js";

/**
 * 创建 Claims Provider
 *
 * 统一接口，支持两种调用方式：
 * - Legacy: (systemPrompt, userPrompt)
 * - Messages: ({ messages }) 多轮对话
 *
 * @param client - OpenAI 客户端实例
 * @param model - 模型名称
 * @returns LlmClaimsProvider 实例
 */
export function createOpenAiClaimsProvider(
  client: OpenAI,
  model: string,
): LlmClaimsProvider {
  const handler = async (
    systemOrInput: string | LlmCallInput,
    userPrompt?: string,
  ): Promise<LlmCallResult> => {
    // 检测调用模式
    if (typeof systemOrInput === "string" && userPrompt !== undefined) {
      // Legacy: (systemPrompt, userPrompt)
      const result = await generateWithClient(
        client,
        model,
        systemOrInput,
        userPrompt,
      );
      return {
        rawText: result.text,
        model,
        usage: { promptTokens: 0, completionTokens: result.chunks },
      };
    }

    if (typeof systemOrInput === "object") {
      const input = systemOrInput as LlmCallInput;

      if (input.messages && input.messages.length > 0) {
        // Messages 数组模式
        const result = await generateWithMessages(
          client,
          model,
          input.messages,
        );
        return {
          rawText: result.text,
          model,
          usage: { promptTokens: 0, completionTokens: result.chunks },
        };
      }

      if (input.systemPrompt !== undefined && input.userPrompt !== undefined) {
        // V2 Legacy 模式
        const result = await generateWithClient(
          client,
          model,
          input.systemPrompt,
          input.userPrompt,
        );
        return {
          rawText: result.text,
          model,
          usage: { promptTokens: 0, completionTokens: result.chunks },
        };
      }

      throw new Error(
        "Invalid LlmCallInput: must provide messages or systemPrompt+userPrompt",
      );
    }

    throw new Error(
      "Invalid arguments: provide (systemPrompt, userPrompt) or LlmCallInput",
    );
  };

  return handler as LlmClaimsProvider;
}

/**
 * 从 ModelConfig 创建 OpenAI 客户端和 Provider
 */
export function createOpenAiClientAndProvider(config: ModelConfig): {
  client: OpenAI;
  provider: LlmClaimsProvider;
} {
  const client = createOpenAiClient(config);
  const provider = createOpenAiClaimsProvider(client, config.model);
  return { client, provider };
}
