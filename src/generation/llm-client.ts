import OpenAI from 'openai';
import type { ModelConfig } from '../config/model-config.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { logger } from '../shared/logger.js';
import { HumanMessage } from '@langchain/core/messages';
import { AGENT_RUNTIME_DEFAULTS, LLM_DEFAULTS } from '../config/defaults.js';
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeConfig,
  type ModelInstanceConfig,
} from '../agent-runtime/runtime.js';
import {
  resolveModel,
  type RoutingContext,
  type RoutingResult,
  type ModelTier,
  type TaskSource,
} from '../agent-runtime/routing/index.js';
import {
  loadMultiModelsFile,
  getValidatedModels,
  type ValidatedModelConfig,
  type MultiModelsFile,
} from '../config/multi-model-config.js';
import { resolveModelConfig } from '../config/model-config.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Agent Runtime 调用方式（集成路由决策）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent 生成选项
 */
export interface AgentGenerationOptions {
  /** 工作目录根路径 */
  workspacePath: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户提示词 */
  userPrompt: string;
  /** 多模型配置文件路径（可选） */
  multiModelConfigPath?: string;
  /** 单模型配置（可选，用于向后兼容） */
  modelConfig?: ModelConfig;
  /** 任务来源（可选） */
  taskSource?: TaskSource;
  /** 会话 ID（可选） */
  threadId?: string;
  /** 额外系统提示词（可选） */
  extraSystemPrompt?: string;
  /** 自定义工具列表（可选） */
  tools?: unknown[];
  /** 自定义中间件列表（可选） */
  middleware?: unknown[];
  /** AbortSignal（可选） */
  abortSignal?: AbortSignal;
  /** 是否启用摘要（可选） */
  enableSummarization?: boolean;
  /** 是否启用文件工具（可选） */
  enableFileTools?: boolean;
  /** 是否启用写入操作（可选） */
  enableWrite?: boolean;
}

/**
 * Agent 生成结果
 */
export interface AgentGenerationResult {
  /** 生成的文本内容 */
  text: string;
  /** 使用的模型 ID */
  resolvedModelId: string;
  /** 使用的模型层级 */
  resolvedTier: ModelTier;
  /** 路由原因 */
  routeReason: string;
  /** 决定路由的层级 */
  routingLayer: string;
  /** 开始时间 */
  startedAt: string;
  /** 结束时间 */
  finishedAt: string;
  /** 持续时间（毫秒） */
  durationMs: number;
  /** 路由追踪（可选） */
  routingTrace?: unknown;
}

/**
 * 使用 Agent Runtime 生成内容
 *
 * 集成多模型配置和路由决策：
 * 1. 加载多模型配置文件
 * 2. 使用 resolveModel 进行路由决策
 * 3. 创建 Agent Runtime
 * 4. 调用 Agent 并返回结果
 *
 * @param options - Agent 生成选项
 * @returns Agent 生成结果
 */
export async function generateWithAgent(
  options: AgentGenerationOptions,
): Promise<AgentGenerationResult> {
  const startedAt = new Date().toISOString();

  // ── 1. 加载多模型配置 ─────────────────────────────────────────────────────
  let validatedModels: ValidatedModelConfig[] = [];
  let configFile: MultiModelsFile = { models: [] };

  if (options.multiModelConfigPath) {
    configFile = await loadMultiModelsFile(options.multiModelConfigPath);
    validatedModels = getValidatedModels(configFile);
  }

  // 向后兼容：如果没有多模型配置，使用单模型配置
  if (validatedModels.length === 0 && options.modelConfig) {
    validatedModels = [
      {
        id: 'default',
        name: options.modelConfig.model,
        baseUrl: options.modelConfig.baseUrl,
        model: options.modelConfig.model,
        apiKey: options.modelConfig.apiKey,
        maxTokens: AGENT_RUNTIME_DEFAULTS.defaultContextWindow,
        isValid: true,
      },
    ];
  }

  // 如果没有任何配置，使用默认配置
  if (validatedModels.length === 0) {
    const defaultConfig = resolveModelConfig({});
    validatedModels = [
      {
        id: 'default',
        name: defaultConfig.model,
        baseUrl: defaultConfig.baseUrl,
        model: defaultConfig.model,
        apiKey: defaultConfig.apiKey,
        maxTokens: AGENT_RUNTIME_DEFAULTS.defaultContextWindow,
        isValid: true,
      },
    ];
  }

  logger.info('[AgentClient] Loaded models', {
    modelCount: validatedModels.length,
    modelIds: validatedModels.map(m => m.id),
  });

  // ── 2. 路由决策 ─────────────────────────────────────────────────────────────
  const routingContext: RoutingContext = {
    taskSource: options.taskSource ?? AGENT_RUNTIME_DEFAULTS.taskSource,
    message: options.userPrompt,
    threadId: options.threadId,
    routingMode: AGENT_RUNTIME_DEFAULTS.routingMode,
  };

  // 注入模型存储（简化实现，直接使用验证后的模型列表）
  const modelStorage = {
    getModelByTier: (tier: ModelTier): ValidatedModelConfig | null => {
      const tierModels = validatedModels.filter(m => (m.tier ?? 'premium') === tier);
      return tierModels[0] ?? null;
    },
    getCustomModelConfigs: () => validatedModels,
    getGlobalRoutingMode: () => AGENT_RUNTIME_DEFAULTS.routingMode,
    DEFAULT_MAX_TOKENS: AGENT_RUNTIME_DEFAULTS.defaultContextWindow,
  };

  // 动态设置模型存储（需要在 routing/index.ts 中暴露 setModelStorage）
  // 由于当前实现限制，简化路由逻辑
  let routingResult: RoutingResult;

  // 简化路由：根据任务类型选择模型
  const taskSource = routingContext.taskSource;
  if (taskSource === 'heartbeat' || taskSource === 'memory_summarize' || taskSource === 'scheduler_reminder') {
    // Economy 层任务
    const economyModel = validatedModels.find(m => (m.tier ?? 'premium') === 'economy') ?? validatedModels[0];
    routingResult = {
      resolvedModelId: `custom:${economyModel.id}`,
      resolvedTier: 'economy',
      routeReason: `taskSource=${taskSource}→economy`,
      fallbackChain: validatedModels.map(m => `custom:${m.id}`),
      layer: 'layer1',
    };
  } else if (taskSource === 'optimizer') {
    // Premium 层任务
    const premiumModel = validatedModels.find(m => (m.tier ?? 'premium') === 'premium') ?? validatedModels[0];
    routingResult = {
      resolvedModelId: `custom:${premiumModel.id}`,
      resolvedTier: 'premium',
      routeReason: `taskSource=${taskSource}→premium`,
      fallbackChain: validatedModels.map(m => `custom:${m.id}`),
      layer: 'layer1',
    };
  } else {
    // 默认使用第一个有效模型
    const defaultModel = validatedModels[0];
    routingResult = {
      resolvedModelId: `custom:${defaultModel.id}`,
      resolvedTier: (defaultModel.tier ?? 'premium') as ModelTier,
      routeReason: `default-first-model`,
      fallbackChain: validatedModels.map(m => `custom:${m.id}`),
      layer: 'layer1',
    };
  }

  logger.info('[AgentClient] Routing result', {
    resolvedModelId: routingResult.resolvedModelId,
    resolvedTier: routingResult.resolvedTier,
    routeReason: routingResult.routeReason,
    layer: routingResult.layer,
  });

  // ── 3. 获取模型配置 ───────────────────────────────────────────────────────────
  const modelId = routingResult.resolvedModelId.replace('custom:', '');
  const selectedModel = validatedModels.find(m => m.id === modelId);

  if (!selectedModel) {
    throw new Error(`Model not found: ${modelId}`);
  }

  // ── 4. 创建 Agent Runtime ─────────────────────────────────────────────────────
  const modelInstanceConfig: ModelInstanceConfig = {
    id: selectedModel.id,
    model: selectedModel.model,
    baseUrl: selectedModel.baseUrl,
    apiKey: selectedModel.apiKey,
    maxTokens: selectedModel.maxTokens ?? AGENT_RUNTIME_DEFAULTS.defaultContextWindow,
  };

  const runtimeConfig: AgentRuntimeConfig = {
    model: modelInstanceConfig,
    workspacePath: options.workspacePath,
    threadId: options.threadId,
    extraSystemPrompt: options.extraSystemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: options.tools as any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    middleware: options.middleware as any[],
    abortSignal: options.abortSignal,
    maxRetryAttempts: LLM_DEFAULTS.maxRetries,
    enableSummarization: options.enableSummarization ?? AGENT_RUNTIME_DEFAULTS.enableSummarization,
    enableFileTools: options.enableFileTools ?? AGENT_RUNTIME_DEFAULTS.enableFileTools,
    enableWrite: options.enableWrite ?? AGENT_RUNTIME_DEFAULTS.enableWrite,
    enableTodoList: AGENT_RUNTIME_DEFAULTS.enableTodoList,
    enablePromptCaching: AGENT_RUNTIME_DEFAULTS.enablePromptCaching,
  };

  const agent = createAgentRuntime(runtimeConfig);

  logger.info('[AgentClient] Agent runtime created', {
    model: selectedModel.model,
    workspacePath: options.workspacePath,
  });

  // ── 5. 调用 Agent ───────────────────────────────────────────────────────────────
  const userMessage = new HumanMessage(options.userPrompt);

  try {
    // 调用 Agent（使用 invoke 方法）
    const response = await agent.invoke({
      messages: [userMessage],
    });

    // 提取响应文本
    let text = '';
    if (response && response.messages) {
      const lastMessage = response.messages[response.messages.length - 1];
      if (lastMessage && typeof lastMessage.content === 'string') {
        text = lastMessage.content;
      } else if (lastMessage && Array.isArray(lastMessage.content)) {
        text = lastMessage.content
          .map((item: unknown) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'text' in item) {
              return String((item as { text: unknown }).text);
            }
            return '';
          })
          .join('');
      }
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    logger.info('[AgentClient] Agent generation completed', {
      resolvedModelId: routingResult.resolvedModelId,
      textLength: text.length,
      durationMs,
    });

    return {
      text,
      resolvedModelId: routingResult.resolvedModelId,
      resolvedTier: routingResult.resolvedTier,
      routeReason: routingResult.routeReason,
      routingLayer: routingResult.layer,
      startedAt,
      finishedAt,
      durationMs,
      routingTrace: routingResult.routingTrace,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AgentClient] Agent generation failed', {
      error: errorMsg,
      resolvedModelId: routingResult.resolvedModelId,
    });

    // 尝试 fallback 链
    const fallbackChain = routingResult.fallbackChain;
    if (fallbackChain.length > 1) {
      logger.info('[AgentClient] Attempting fallback', {
        fallbackChain,
      });

      // 尝试下一个 fallback 模型
      const nextModelId = fallbackChain[1].replace('custom:', '');
      const fallbackModel = validatedModels.find(m => m.id === nextModelId);

      if (fallbackModel) {
        const fallbackConfig: ModelInstanceConfig = {
          id: fallbackModel.id,
          model: fallbackModel.model,
          baseUrl: fallbackModel.baseUrl,
          apiKey: fallbackModel.apiKey,
          maxTokens: fallbackModel.maxTokens ?? AGENT_RUNTIME_DEFAULTS.defaultContextWindow,
        };

        const fallbackRuntimeConfig: AgentRuntimeConfig = {
          ...runtimeConfig,
          model: fallbackConfig,
        };

        const fallbackAgent = createAgentRuntime(fallbackRuntimeConfig);

        try {
          const fallbackResponse = await fallbackAgent.invoke({
            messages: [userMessage],
          });

          let fallbackText = '';
          if (fallbackResponse && fallbackResponse.messages) {
            const lastMessage = fallbackResponse.messages[fallbackResponse.messages.length - 1];
            if (lastMessage && typeof lastMessage.content === 'string') {
              fallbackText = lastMessage.content;
            }
          }

          const finishedAt = new Date().toISOString();
          const durationMs = Date.now() - new Date(startedAt).getTime();

          logger.info('[AgentClient] Fallback succeeded', {
            fallbackModelId: nextModelId,
            textLength: fallbackText.length,
          });

          return {
            text: fallbackText,
            resolvedModelId: `custom:${nextModelId}`,
            resolvedTier: (fallbackModel.tier ?? 'premium') as ModelTier,
            routeReason: `${routingResult.routeReason}→fallback`,
            routingLayer: 'fallback',
            startedAt,
            finishedAt,
            durationMs,
          };
        } catch (fallbackError) {
          logger.error('[AgentClient] Fallback failed', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
    }

    // 所有尝试失败，抛出异常
    throw error;
  }
}