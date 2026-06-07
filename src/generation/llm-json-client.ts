import { logger } from '../shared/logger.js';
import type { LlmClaimsProvider } from './knowledge-generator.js';
import type { KnowledgeType } from '../schemas/knowledge-type.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import {
  getRepairPrompt,
  getRetrySystemPrompt,
  classifyJsonError,
  type JsonParseErrorType,
} from './repair-prompts.js';
import {
  generateFallbackObject,
  getDefaultContextNameField,
} from './fallback-templates.js';

/**
 * LLM JSON 调用选项
 */
export interface LlmJsonCallOptions {
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户提示词 */
  userPrompt: string;
  /** LLM 调用提供者 */
  claimsProvider: LlmClaimsProvider;

  /** 知识类型（用于选择修复提示词和降级模板） */
  knowledgeType?: KnowledgeType;

  /** 重试上下文（填充类型特定修复提示词） */
  repairContext?: Record<string, unknown>;

  /** 最大重试次数（默认 3） */
  maxRetries?: number;

  /** 单次调用超时（毫秒，默认 120000 = 120秒） */
  timeout?: number;

  /** 降级模板（覆盖知识类型默认模板） */
  fallbackTemplate?: Record<string, unknown>;
  /** 降级模板填充数据 */
  fallbackContext?: Record<string, unknown>;

  /** 日志标识 */
  logLabel?: string;

  /** 是否详细日志 */
  verbose?: boolean;
}

/**
 * 单次调用错误记录
 */
export interface CallErrorRecord {
  attempt: number;
  errorType: JsonParseErrorType;
  message: string;
  durationMs: number;
}

/**
 * LLM 调用统计
 */
export interface LlmStats {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalDurationMs: number;
}

/**
 * LLM JSON 调用结果
 */
export interface LlmJsonCallResult<T = Record<string, unknown>> {
  /** 是否成功（包括降级成功） */
  success: boolean;
  /** 解析后的 JSON 对象 */
  data?: T;
  /** 原始 LLM 输出 */
  rawOutput: string;

  /** 解析成功来源 */
  successSource: 'first_try' | 'retry' | 'fallback';

  /** 重试成功时的重试次数（第几次重试成功） */
  retryAttempt?: number;

  /** 错误历史 */
  errorHistory: CallErrorRecord[];

  /** LLM 调用统计 */
  llmStats: LlmStats;

  /** 是否使用了降级模板 */
  fallbackUsed: boolean;
}

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = LLM_DEFAULTS.timeoutSeconds * 1000;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = LLM_DEFAULTS.maxRetries;

/**
 * 退避配置
 */
const BACKOFF_CONFIG = {
  /** 基础退避时间（毫秒） */
  baseMs: 1000,
  /** 最大退避时间（毫秒） */
  maxMs: 30000,
  /** 退避指数倍数 */
  multiplier: 2,
};

/**
 * 全局调用间隔控制（避免并发429）
 */
let lastCallTimeMs = 0;
const MIN_CALL_INTERVAL_MS = 2000;  // 每次调用间隔至少2秒

/**
 * 等待指定毫秒
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待全局调用间隔
 */
async function waitForGlobalInterval(): Promise<void> {
  const elapsed = Date.now() - lastCallTimeMs;
  if (elapsed < MIN_CALL_INTERVAL_MS) {
    await sleep(MIN_CALL_INTERVAL_MS - elapsed);
  }
  lastCallTimeMs = Date.now();
}

/**
 * 计算退避时间
 */
function calculateBackoffMs(attempt: number): number {
  const backoffMs = BACKOFF_CONFIG.baseMs * Math.pow(BACKOFF_CONFIG.multiplier, attempt - 1);
  return Math.min(backoffMs, BACKOFF_CONFIG.maxMs);
}

/**
 * 带超时和全局间隔的 LLM 调用
 */
async function callWithTimeoutAndInterval(
  claimsProvider: LlmClaimsProvider,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<{ rawText: string; durationMs: number }> {
  // 等待全局调用间隔
  await waitForGlobalInterval();

  return callWithTimeout(claimsProvider, systemPrompt, userPrompt, timeoutMs);
}

/**
 * 带超时的 LLM 调用
 */
async function callWithTimeout(
  claimsProvider: LlmClaimsProvider,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<{ rawText: string; durationMs: number }> {
  const startTime = Date.now();

  // 使用 Promise + setTimeout 实现超时
  return new Promise(async (resolve, reject) => {
    // 设置超时定时器
    const timeoutId = setTimeout(() => {
      reject(new Error(`LLM call timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const result = await claimsProvider(systemPrompt, userPrompt);
      clearTimeout(timeoutId);
      resolve({
        rawText: result.rawText,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * 去除 markdown 代码块包裹
 */
export function stripMarkdownCodeBlock(rawText: string): string {
  let text = rawText.trim();

  // 去除 ```json 开头
  if (text.startsWith('```json')) {
    text = text.slice(7);
  } else if (text.startsWith('```')) {
    text = text.slice(3);
  }

  // 去除 ``` 结尾
  if (text.endsWith('```')) {
    text = text.slice(0, -3);
  }

  return text.trim();
}

/**
 * 提取 JSON 边界（从第一个 { 或 [ 到最后一个 } 或 ]）
 */
export function extractJsonBoundary(rawText: string): string {
  const text = rawText.trim();

  // 找到第一个对象或数组起始符
  const startIdx = text.indexOf('{');
  const arrayStartIdx = text.indexOf('[');
  const actualStart = Math.min(
    startIdx >= 0 ? startIdx : Infinity,
    arrayStartIdx >= 0 ? arrayStartIdx : Infinity
  );

  if (actualStart === Infinity) {
    return text; // 没找到起始符，返回原文
  }

  // 找到最后一个对应的结束符
  const startChar = text[actualStart];
  const endChar = startChar === '{' ? '}' : ']';

  // 从后往前找
  let endIdx = text.lastIndexOf(endChar);
  if (endIdx < actualStart) {
    endIdx = text.length - 1; // 没找到结束符
  }

  return text.slice(actualStart, endIdx + 1);
}

/**
 * JSON 预处理流程
 */
function preprocessJsonOutput(rawText: string): string {
  // 1. 去除 markdown 包裹
  let text = stripMarkdownCodeBlock(rawText);

  // 2. 提取 JSON 边界
  text = extractJsonBoundary(text);

  return text;
}

/**
 * 尝试解析 JSON
 */
function tryParseJson(cleanedText: string): { success: boolean; data?: unknown; error?: Error } {
  try {
    const parsed = JSON.parse(cleanedText);

    // 检查是否是对象类型（排除 null、数字、字符串等）
    if (parsed === null || typeof parsed !== 'object') {
      return {
        success: false,
        error: new Error('Parsed result is not an object'),
      };
    }

    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown parse error'),
    };
  }
}

/**
 * 通用 LLM JSON 调用工具
 *
 * 特性：
 * - 自动 JSON 预处理（去除 markdown 包裹、提取边界）
 * - 可配置重试次数，前2次使用完整提示词
 * - 超时控制（默认 120秒）
 * - 重试失败后使用降级模板
 * - 详细日志记录和统计
 */
export async function callLlmForJson<T = Record<string, unknown>>(
  options: LlmJsonCallOptions,
): Promise<LlmJsonCallResult<T>> {
  const {
    systemPrompt,
    userPrompt,
    claimsProvider,
    knowledgeType = 'CONCEPT',
    repairContext = {},
    maxRetries = DEFAULT_MAX_RETRIES,
    timeout = DEFAULT_TIMEOUT_MS,
    fallbackTemplate,
    fallbackContext = {},
    logLabel = 'LLM JSON',
    verbose = false,
  } = options;

  const errors: CallErrorRecord[] = [];
  const stats: LlmStats = {
    totalCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalDurationMs: 0,
  };

  let lastRawOutput = '';
  let attempt = 0;

  // ========== 第1次调用（原始提示词） ==========
  attempt = 1;
  logger.debug(`${logLabel}: 第1次调用开始`);

  try {
    const callResult = await callWithTimeoutAndInterval(claimsProvider, systemPrompt, userPrompt, timeout);
    lastRawOutput = callResult.rawText;
    stats.totalCalls++;
    stats.totalDurationMs += callResult.durationMs;

    logger.debug(`${logLabel}: 第1次调用完成，耗时 ${callResult.durationMs}ms`);

    // 预处理 + 解析
    const cleanedText = preprocessJsonOutput(lastRawOutput);
    const parseResult = tryParseJson(cleanedText);

    if (parseResult.success) {
      logger.info(`${logLabel}: 第1次解析成功`);
      return {
        success: true,
        data: parseResult.data as T,
        rawOutput: lastRawOutput,
        successSource: 'first_try',
        errorHistory: [],
        llmStats: stats,
        fallbackUsed: false,
      };
    }

    // 解析失败，记录错误
    const errorType = classifyJsonError(lastRawOutput, parseResult.error!);
    errors.push({
      attempt: 1,
      errorType,
      message: parseResult.error!.message,
      durationMs: callResult.durationMs,
    });
    logger.warn(`${logLabel}: 第1次解析失败，类型=${errorType}`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMsg.includes('timeout');

    errors.push({
      attempt: 1,
      errorType: isTimeout ? 'timeout' : 'content',
      message: errorMsg,
      durationMs: timeout,
    });
    logger.error(`${logLabel}: 第1次调用异常: ${errorMsg}`);
  }

  // ========== 重试循环 ==========
  while (attempt < maxRetries) {
    attempt++;

    // 退避等待（指数退避）
    const backoffMs = calculateBackoffMs(attempt);
    logger.debug(`${logLabel}: 退避等待 ${backoffMs}ms 后重试`);
    await sleep(backoffMs);

    // 选择修复提示词和 systemPrompt
    const repairPrompt = getRepairPrompt(
      attempt,
      maxRetries,
      knowledgeType,
      lastRawOutput,
      repairContext,
    );
    const retrySystem = getRetrySystemPrompt(attempt, systemPrompt);

    logger.debug(`${logLabel}: 第${attempt}次重试开始，提示词=${attempt <= 2 ? '完整' : '简化'}`);

    try {
      const callResult = await callWithTimeoutAndInterval(claimsProvider, retrySystem, repairPrompt, timeout);
      lastRawOutput = callResult.rawText;
      stats.totalCalls++;
      stats.totalDurationMs += callResult.durationMs;

      logger.debug(`${logLabel}: 第${attempt}次重试完成，耗时 ${callResult.durationMs}ms`);

      // 预处理 + 解析
      const cleanedText = preprocessJsonOutput(lastRawOutput);
      const parseResult = tryParseJson(cleanedText);

      if (parseResult.success) {
        logger.info(`${logLabel}: 第${attempt}次重试解析成功`);
        return {
          success: true,
          data: parseResult.data as T,
          rawOutput: lastRawOutput,
          successSource: 'retry',
          retryAttempt: attempt,
          errorHistory: errors,
          llmStats: stats,
          fallbackUsed: false,
        };
      }

      // 解析失败，记录错误
      const errorType = classifyJsonError(lastRawOutput, parseResult.error!);
      errors.push({
        attempt,
        errorType,
        message: parseResult.error!.message,
        durationMs: callResult.durationMs,
      });
      logger.warn(`${logLabel}: 第${attempt}次重试解析失败，类型=${errorType}`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMsg.includes('timeout');

      errors.push({
        attempt,
        errorType: isTimeout ? 'timeout' : 'content',
        message: errorMsg,
        durationMs: timeout,
      });
      logger.error(`${logLabel}: 第${attempt}次重试异常: ${errorMsg}`);
    }
  }

  // ========== 所有重试失败，使用降级模板 ==========
  logger.warn(`${logLabel}: 所有重试失败（${attempt}次），使用降级模板`);

  const fallbackData = fallbackTemplate
    ? { ...fallbackTemplate, ...fallbackContext }
    : generateFallbackObject(knowledgeType, fallbackContext, lastRawOutput.slice(0, 100));

  logger.info(`${logLabel}: 降级模板生成完成`);

  return {
    success: true,
    data: fallbackData as T,
    rawOutput: lastRawOutput,
    successSource: 'fallback',
    retryAttempt: attempt,
    errorHistory: errors,
    llmStats: stats,
    fallbackUsed: true,
  };
}

/**
 * 批量调用统计
 */
export interface BatchStats {
  totalObjects: number;
  successCount: number;
  retrySuccessCount: number;
  fallbackCount: number;
  failCount: number;
  totalLlmCalls: number;
  totalDurationMs: number;
}

/**
 * 生成统计报告
 */
export function generateBatchStatsReport(
  results: LlmJsonCallResult[],
  label: string,
): BatchStats {
  const stats: BatchStats = {
    totalObjects: results.length,
    successCount: 0,
    retrySuccessCount: 0,
    fallbackCount: 0,
    failCount: 0,
    totalLlmCalls: 0,
    totalDurationMs: 0,
  };

  for (const result of results) {
    if (result.success) {
      stats.successCount++;
      if (result.successSource === 'retry') {
        stats.retrySuccessCount++;
      } else if (result.successSource === 'fallback') {
        stats.fallbackCount++;
      }
    } else {
      stats.failCount++;
    }
    stats.totalLlmCalls += result.llmStats.totalCalls;
    stats.totalDurationMs += result.llmStats.totalDurationMs;
  }

  logger.info(`===== ${label} 统计 =====`);
  logger.info(`总对象: ${stats.totalObjects}`);
  logger.info(`首次成功: ${stats.successCount - stats.retrySuccessCount - stats.fallbackCount}`);
  logger.info(`重试成功: ${stats.retrySuccessCount}`);
  logger.info(`降级生成: ${stats.fallbackCount}`);
  logger.info(`最终失败: ${stats.failCount}`);
  logger.info(`LLM 调用: ${stats.totalLlmCalls} 次`);
  logger.info(`总耗时: ${(stats.totalDurationMs / 1000).toFixed(1)} 秒`);

  return stats;
}