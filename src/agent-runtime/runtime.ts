/**
 * Agent Runtime 核心系统
 *
 * 参考 CmbCoworkAgent 的 runtime.ts 实现
 * 组装模型、工具、中间件，创建完整的 Agent 运行时
 */

import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import {
  createFilesystemMiddleware,
  StateBackend,
  createPatchToolCallsMiddleware,
  createSummarizationMiddleware,
  createSubAgentMiddleware,
  GENERAL_PURPOSE_SUBAGENT,
} from "deepagents";
import {
  createAgent,
  createMiddleware,
  todoListMiddleware,
  anthropicPromptCachingMiddleware,
} from "langchain";

import { FileBackend } from "./file-backend.js";
import {
  createFileToolsMiddleware,
  getFileToolsSystemPrompt,
} from "./file-tools.js";
import {
  computeSummarizationThresholds,
  AIWIKI_SUMMARY_PROMPT,
  type SummarizationThresholds,
} from "./middleware.js";
import {
  createRetryingFetch,
  type RetryHooks,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from "../shared/retrying-fetch.js";
import { logger } from "../shared/logger.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import type { ValidatedModelConfig } from "../config/multi-model-config.js";

// ── 类型定义 ───────────────────────────────────────────────────────────────

/**
 * 模型实例配置
 */
export interface ModelInstanceConfig {
  /** 模型 ID */
  id: string;
  /** 模型名称 */
  model: string;
  /** API 基础 URL */
  baseUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 是否启用 interleaved thinking */
  interleavedThinking?: boolean;
}

/**
 * Agent 运行时配置
 */
export interface AgentRuntimeConfig {
  /** 模型配置 */
  model: ModelInstanceConfig;
  /** 工作目录根路径 */
  workspacePath: string;
  /** 会话 ID（可选，用于状态持久化） */
  threadId?: string;
  /** 额外系统提示词（可选） */
  extraSystemPrompt?: string;
  /** 自定义工具列表（可选） */
  tools?: DynamicStructuredTool[];
  /** 自定义中间件列表（可选） */
  middleware?: unknown[];
  /** AbortSignal（可选，用于取消） */
  abortSignal?: AbortSignal;
  /** 重试钩子（可选，用于 UI 显示） */
  retryHooks?: RetryHooks;
  /** 最大重试次数（可选） */
  maxRetryAttempts?: number;
  /** 是否启用摘要（默认 true） */
  enableSummarization?: boolean;
  /** 自定义摘要提示词（可选） */
  customSummaryPrompt?: string;
  /** 是否启用文件工具（默认 true） */
  enableFileTools?: boolean;
  /** 是否启用写入操作（默认 true） */
  enableWrite?: boolean;
  /** 是否启用 todo list 中间件（默认 true） */
  enableTodoList?: boolean;
  /** 是否启用 prompt caching（默认 true） */
  enablePromptCaching?: boolean;
  /** 子代理配置（可选） */
  subagents?: unknown[];
  /** 技能源列表（可选） */
  skills?: string[];
}

/**
 * Agent 运行时选项（简化版）
 */
export interface AgentRuntimeOptions {
  /** 模型配置（使用 ValidatedModelConfig） */
  modelConfig: ValidatedModelConfig;
  /** 工作目录根路径 */
  workspacePath: string;
  /** 额外系统提示词（可选） */
  extraSystemPrompt?: string;
}

/**
 * Agent 运行时实例类型
 *
 * 使用 ReturnType 从 createAgent 返回值推断类型
 */
export type AgentRuntime = ReturnType<typeof createAgent>;

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * 默认历史记录路径前缀
 */
const DEFAULT_HISTORY_PATH_PREFIX = ".aiwiki/conversation_history";

/**
 * 默认上下文窗口大小
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * 基础系统提示词
 */
const BASE_PROMPT =
  "In order to complete the objective that the user asks of you, you have access to a number of standard tools.";

/**
 * 子代理任务提示词
 */
const SEQUENTIAL_TASK_PROMPT = `## \`task\` (subagent spawner)

You have access to a \`task\` tool to launch short-lived subagents that handle isolated tasks. These agents are ephemeral — they live only for the duration of the task and return a single result.

When to use the task tool:
- When a task is complex and multi-step, and can be fully delegated in isolation
- When a task requires focused reasoning or heavy token/context usage that would bloat the orchestrator thread
- When sandboxing improves reliability (e.g. code execution, structured searches, data formatting)
- When you only care about the output of the subagent, and not the intermediate steps

Subagent lifecycle:
1. **Spawn** → Provide clear role, instructions, and expected output
2. **Run** → The subagent completes the task autonomously
3. **Return** → The subagent provides a single structured result
4. **Reconcile** → Incorporate or synthesize the result into the main thread

When NOT to use the task tool:
- If you need to see the intermediate reasoning or steps after the subagent has completed
- If the task is trivial (a few tool calls or simple lookup)
- If delegating does not reduce token usage, complexity, or context switching
- If splitting would add latency without benefit

## Important Task Tool Usage Notes
- **CRITICAL: Only launch ONE subagent at a time.**
- Wait for the current subagent to finish before launching the next.
- Use the \`task\` tool to silo independent tasks within a multi-part objective.`;

// ── 模型实例工厂 ───────────────────────────────────────────────────────────

/**
 * 创建模型实例
 *
 * 参考 CmbCoworkAgent 的 getModelInstance 实现
 * 集成重试机制，禁用 SDK 级别重试，使用统一的 retryingFetch
 *
 * @param config - 模型实例配置
 * @param retryHooks - 重试钩子（可选）
 * @param maxRetryAttempts - 最大重试次数（可选）
 * @returns ChatOpenAI 模型实例
 */
export function createModelInstance(
  config: ModelInstanceConfig,
  retryHooks?: RetryHooks,
  maxRetryAttempts?: number,
): ChatOpenAI {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const resolvedModel = config.model;
  if (!resolvedModel.trim()) {
    throw new Error(
      "Model name is empty. Please configure a valid model name.",
    );
  }

  logger.info("[Runtime] Creating model instance", {
    model: resolvedModel,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
  });

  const baseFields = {
    model: resolvedModel,
    apiKey,
    // SDK 级别重试和超时禁用 — 统一重试 + 单次超时在 retryingFetch 中实现
    // 设置 SDK 超时会创建共享 AbortSignal，一旦触发会永久阻塞后续重试尝试
    maxRetries: 0,
    configuration: {
      baseURL: config.baseUrl,
      fetch:
        retryHooks || maxRetryAttempts !== undefined
          ? createRetryingFetch(retryHooks, maxRetryAttempts)
          : createRetryingFetch(),
    },
  };

  // TODO: 支持 interleaved thinking（需要自定义 completions 类）
  // if (config.interleavedThinking) {
  //   return new ChatOpenAI({
  //     ...baseFields,
  //     completions: new InterleavedThinkingChatOpenAICompletions(baseFields),
  //   } as never);
  // }

  return new ChatOpenAI(baseFields);
}

// ── StateBackend 创建 ──────────────────────────────────────────────────────

/**
 * StateBackend 配置
 */
export interface StateBackendConfig {
  /** 工作目录根路径 */
  rootDir: string;
  /** 最大输出字节（可选） */
  maxOutputBytes?: number;
  /** 超时毫秒数（可选） */
  timeout?: number;
  /** AbortSignal（可选） */
  abortSignal?: AbortSignal;
}

/**
 * 创建 StateBackend
 *
 * 使用 FileBackend 作为文件系统后端
 * 提供文件操作能力：ls、read、write、edit、glob、grep
 *
 * @param config - StateBackend 配置
 * @returns StateBackend 实例（通过 FileBackend 实现）
 */
export function createStateBackend(config: StateBackendConfig): FileBackend {
  const backend = new FileBackend({
    rootDir: config.rootDir,
    virtualMode: false,
  });

  logger.info("[Runtime] StateBackend created", {
    rootDir: config.rootDir,
    maxOutputBytes: config.maxOutputBytes,
  });

  return backend;
}

// ── 系统提示词构建 ────────────────────────────────────────────────────────

/**
 * 格式化本地时间（ISO-8601 格式带时区）
 * 参考 CmbCoworkAgent 的 formatLocalISO
 */
function formatLocalISO(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const local = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;

  // 计算 UTC 偏移
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const loc = new Date(date.toLocaleString("en-US", { timeZone }));
  const offsetMin = Math.round((loc.getTime() - utc.getTime()) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const oh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const om = String(absMin % 60).padStart(2, "0");

  return `${local}${sign}${oh}:${om}`;
}

/**
 * 获取系统环境信息
 */
function getSystemEnvironment(): {
  platform: string;
  arch: string;
  timezone: string;
  currentTime: string;
} {
  const isWindows = process.platform === "win32";
  const platform = isWindows
    ? "Windows"
    : process.platform === "darwin"
      ? "macOS"
      : "Linux";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    platform,
    arch: process.arch,
    timezone,
    currentTime: formatLocalISO(new Date(), timezone),
  };
}

/**
 * 构建系统提示词
 *
 * @param workspacePath - 工作目录路径
 * @param extraPrompt - 额外提示词（可选）
 * @returns 完整的系统提示词
 */
export function buildSystemPrompt(
  workspacePath: string,
  extraPrompt?: string,
): string {
  const env = getSystemEnvironment();

  const systemPrompt = `
### System Environment
- Operating system: ${env.platform} (${env.arch})
- Timezone: ${env.timezone}
- Current time: ${env.currentTime}

### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations

${BASE_PROMPT}

${extraPrompt ? `\n${extraPrompt}` : ""}
`;

  return systemPrompt.trim();
}

// ── Agent 组装函数 ─────────────────────────────────────────────────────────

/**
 * 创建 Agent 运行时
 *
 * 参考 CmbCoworkAgent 的 createAgentRuntime 实现
 * 组装模型、StateBackend、中间件、系统提示词，创建完整 Agent
 *
 * @param config - Agent 运行时配置
 * @returns Agent 运行时实例
 */
export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  logger.info("[Runtime] Creating agent runtime", {
    model: config.model.model,
    workspacePath: config.workspacePath,
    threadId: config.threadId,
  });

  // ── 1. 创建模型实例 ─────────────────────────────────────────────────────
  const model = createModelInstance(
    config.model,
    config.retryHooks,
    config.maxRetryAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
  );

  // ── 2. 创建 StateBackend ─────────────────────────────────────────────────
  const backend = createStateBackend({
    rootDir: config.workspacePath,
    abortSignal: config.abortSignal,
  });

  // 用于 deepagents 的 backend 包装（适配 StateBackend 接口）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filesystemBackend: any = backend;

  // ── 3. 计算摘要阈值 ─────────────────────────────────────────────────────
  const maxTokens = config.model.maxTokens ?? DEFAULT_CONTEXT_WINDOW;
  const thresholds: SummarizationThresholds =
    computeSummarizationThresholds(maxTokens);

  logger.debug("[Runtime] Summarization thresholds", {
    maxTokens,
    triggerTokens: thresholds.triggerTokens,
    keepTokens: thresholds.keepTokens,
    toolEvictLimit: thresholds.toolEvictLimit,
    trimForSummary: thresholds.trimForSummary,
  });

  // ── 4. 构建系统提示词 ───────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(
    config.workspacePath,
    config.extraSystemPrompt,
  );

  // ── 5. 构建文件工具系统提示词 ───────────────────────────────────────────
  const filesystemSystemPrompt = getFileToolsSystemPrompt(
    config.workspacePath,
    config.enableWrite ?? true,
  );

  // ── 6. 构建中间件列表 ───────────────────────────────────────────────────
  const middlewareList: unknown[] = [];

  // Todo List 中间件
  if (config.enableTodoList ?? true) {
    middlewareList.push(todoListMiddleware());
  }

  // 文件工具中间件
  if (config.enableFileTools ?? true) {
    // 使用自定义 FileBackend 创建文件工具中间件
    const fileMiddleware = createFileToolsMiddleware({
      rootDir: config.workspacePath,
      enableWrite: config.enableWrite ?? true,
      toolTokenLimitBeforeEvict: thresholds.toolEvictLimit,
      customSystemPrompt: filesystemSystemPrompt,
    });
    middlewareList.push(fileMiddleware);
  }

  // 工具错误处理中间件（参考 CmbCoworkAgent）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolErrorMiddleware = createMiddleware<any>({
    name: "toolErrorCatch",
    wrapToolCall: async (request, handler) => {
      try {
        return await handler(request);
      } catch (error) {
        const toolName = request.toolCall?.name;
        const toolCallId = request.toolCall?.id;

        // 检查是否可恢复错误
        const recovered = unwrapToolFailure(error, toolName);
        if (!recovered) throw error;

        // 无 tool_call_id 无法发出可用 ToolMessage
        if (!toolCallId) throw error;

        logger.warn(
          `[Runtime] Recoverable ${recovered.kind} error from tool "${toolName}" handed back to model:`,
          recovered.message,
        );

        // 返回 ToolMessage 让模型看到错误并调整
        return new ToolMessage({
          content:
            recovered.kind === "schema"
              ? `Invalid tool arguments: ${recovered.message}\nPlease fix the arguments and try again.`
              : `Tool execution failed: ${recovered.message}\nPlease adjust your approach and try again.`,
          tool_call_id: toolCallId,
          name: toolName,
          status: "error",
        });
      }
    },
  });
  middlewareList.push(toolErrorMiddleware);

  // 子代理中间件（可选）
  if (config.subagents && config.subagents.length > 0) {
    // 处理子代理：为带有 skills 的子代理自动注入 SkillsMiddleware
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processedSubagents = config.subagents.map((subagent: any) => {
      if (!("skills" in subagent) || !subagent.skills?.length) return subagent;

      // 子代理的 SkillsMiddleware 需要从 deepagents 导入
      // const subagentSkillsMiddleware = createSkillsMiddleware({
      //   backend: filesystemBackend,
      //   sources: subagent.skills ?? [],
      // });

      return {
        ...subagent,
        middleware: [
          // subagentSkillsMiddleware,
          ...(subagent.middleware || []),
        ],
      };
    });

    // 默认子代理中间件配置
    const defaultMiddleware = [
      todoListMiddleware(),
      createFilesystemMiddleware({
        backend: filesystemBackend,
        systemPrompt: filesystemSystemPrompt,
        toolTokenLimitBeforeEvict: thresholds.toolEvictLimit,
      }),
      toolErrorMiddleware,
    ];

    // 通用子代理配置
    const generalPurposeSubagent = {
      ...GENERAL_PURPOSE_SUBAGENT,
      middleware: [],
    };

    middlewareList.push(
      createSubAgentMiddleware({
        defaultModel: model,
        defaultTools: config.tools ?? [],
        defaultMiddleware,
        defaultInterruptOn: null,
        subagents: [generalPurposeSubagent, ...processedSubagents],
        generalPurposeAgent: false,
        systemPrompt: SEQUENTIAL_TASK_PROMPT,
      } as Parameters<typeof createSubAgentMiddleware>[0]),
    );
  }

  // 摘要中间件
  if (config.enableSummarization ?? true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summarizationOptions: any = {
      model,
      backend: filesystemBackend,
      summaryPrompt: config.customSummaryPrompt ?? AIWIKI_SUMMARY_PROMPT,
      trimTokensToSummarize: thresholds.trimForSummary,
      trigger: { type: "tokens", value: thresholds.triggerTokens },
      keep: { type: "tokens", value: thresholds.keepTokens },
    };

    middlewareList.push(createSummarizationMiddleware(summarizationOptions));
  }

  // Prompt Caching 中间件
  if (config.enablePromptCaching ?? true) {
    middlewareList.push(
      anthropicPromptCachingMiddleware({ unsupportedModelBehavior: "ignore" }),
    );
  }

  // Patch Tool Calls 中间件
  middlewareList.push(createPatchToolCallsMiddleware());

  // Skills 中间件（可选）
  if (config.skills && config.skills.length > 0) {
    // SkillsMiddleware 需要从 deepagents 导入
    // middlewareList.push(
    //   createSkillsMiddleware({
    //     backend: filesystemBackend,
    //     sources: config.skills,
    //   })
    // );
  }

  // 自定义中间件（可选）
  if (config.middleware) {
    middlewareList.push(...config.middleware);
  }

  // ── 7. 创建 Agent ───────────────────────────────────────────────────────
  const agent = createAgent({
    model,
    systemPrompt,
    tools: config.tools ?? [],
    middleware: middlewareList,
    // 不使用 checkpointer（根据需求）
    // checkpointer,
    backend,
    name: config.threadId ? `agent-${config.threadId}` : "aiwiki-agent",
  } as unknown as Parameters<typeof createAgent>[0]);

  logger.info("[Runtime] Agent created successfully", {
    workspacePath: config.workspacePath,
    middlewareCount: middlewareList.length,
    toolCount: config.tools?.length ?? 0,
  });

  return agent as AgentRuntime;
}

// ── 辅助函数 ───────────────────────────────────────────────────────────────

/**
 * 解析工具错误
 * 参考 CmbCoworkAgent 的 unwrapToolFailure
 */
function unwrapToolFailure(
  error: unknown,
  toolName: string | undefined,
): { kind: "schema" | "runtime"; message: string } | null {
  // 不恢复的错误类型
  if (isGraphBubbleUp(error)) return null;
  if (isAbortError(error)) return null;
  if (isProgrammerError(error)) return null;
  // MiddlewareError 需要从 langchain 导入
  // if (MiddlewareError.isInstance(error)) return null;

  // ToolInvocationError 需要从 langchain 导入
  // if (error instanceof ToolInvocationError) {
  //   if (error.toolError instanceof ToolInputParsingException) {
  //     return { kind: 'schema', message: error.toolError.message };
  //   }
  //   return unwrapToolFailure(error.toolError, toolName);
  // }

  // 其他错误视为可恢复
  const message = describeToolError(error);
  return { kind: "runtime", message };
}

/**
 * 判断是否为 GraphBubbleUp 错误
 */
function isGraphBubbleUp(error: unknown): boolean {
  // 需要从 @langchain/langgraph 导入 isGraphBubbleUp
  // return isGraphBubbleUp(error);
  return error instanceof Error && error.name === "GraphBubbleUp";
}

/**
 * 判断是否为 AbortError
 */
function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    (error as { code?: unknown }).code === "ABORT_ERR"
  );
}

/**
 * 判断是否为程序员错误（TypeError / ReferenceError）
 */
function isProgrammerError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof ReferenceError;
}

/**
 * 描述工具错误
 */
function describeToolError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

// ── 简化版创建函数 ───────────────────────────────────────────────────────────

/**
 * 快速创建 Agent 运行时（简化版）
 *
 * 使用 ValidatedModelConfig，自动填充默认值
 *
 * @param options - Agent 运行时选项
 * @returns Agent 运行时实例
 */
export function createAgentRuntimeSimple(
  options: AgentRuntimeOptions,
): AgentRuntime {
  const modelConfig: ModelInstanceConfig = {
    id: options.modelConfig.id,
    model: options.modelConfig.model,
    baseUrl: options.modelConfig.baseUrl,
    apiKey: options.modelConfig.apiKey,
    maxTokens: options.modelConfig.maxTokens,
  };

  return createAgentRuntime({
    model: modelConfig,
    workspacePath: options.workspacePath,
    extraSystemPrompt: options.extraSystemPrompt,
  });
}

// ── 导出 ───────────────────────────────────────────────────────────────────

// 注意：ModelInstanceConfig, AgentRuntimeConfig, AgentRuntimeOptions, AgentRuntime
// 已经在定义时用 export interface/export type 导出，无需重复导出
