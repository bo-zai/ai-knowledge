/**
 * 概念知识验证修正模块
 *
 * 在概念生成后立即验证质量，并进行修正或拒绝。
 */

import { logger } from '../shared/logger.js';
import { PromptLoader } from '../shared/prompt-loader.js';
import { callLlmForJson } from './llm-json-client.js';
import type { LlmClaimsProvider } from './knowledge-generator.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import { toKebabCase } from '../knowledge/type-directory-map.js';

/**
 * 验证修正结果
 */
export interface VerifyResult {
  /** 操作类型 */
  action: 'accept' | 'fix' | 'reject';
  /** 原因说明 */
  reason: string;
  /** 拒绝规则编号（仅reject时有） */
  ruleId?: string;
  /** 修正后的内容（仅fix时有） */
  fixedContent?: Record<string, unknown>;
}

/**
 * 验证修正输入
 */
export interface VerifyInput {
  /** 生成的概念内容 */
  conceptContent: Record<string, unknown>;
  /** 原始类名 */
  className: string;
  /** 原始文件路径 */
  filePath: string;
  /** 可疑标记（可选） */
  suspiciousMark?: string;
  /** 枚举值（可选） */
  enumValues?: string[];
}

/**
 * 验证修正概念知识
 *
 * @param input 验证输入
 * @param claimsProvider LLM调用提供者
 * @returns 验证结果
 */
export async function verifyConcept(
  input: VerifyInput,
  claimsProvider: LlmClaimsProvider,
): Promise<VerifyResult> {
  const { conceptContent, className, filePath, suspiciousMark, enumValues } = input;

  // 加载验证提示词模板
  const template = PromptLoader.load('concept-verify');

  // 构建用户提示词
  const conceptJson = JSON.stringify(conceptContent, null, 2);
  const userPrompt = template.fill({
    conceptContent: conceptJson,
    className,
    filePath,
    suspiciousMark: suspiciousMark || undefined,
    enumValues: enumValues ? enumValues.join(', ') : undefined,
  });

  const systemPrompt = '你是概念知识质量检验员。严格按照规则判断知识质量，输出 accept/fix/reject 决策。';

  logger.debug(`CONCEPT verify: 验证 "${className}"`);

  // 调用验证LLM
  const llmResult = await callLlmForJson<VerifyResult>({
    systemPrompt,
    userPrompt,
    claimsProvider,
    knowledgeType: 'CONCEPT',
    maxRetries: 2,  // 验证只重试2次
    timeout: LLM_DEFAULTS.shortTimeoutSeconds * 1000, // 短超时场景（秒转毫秒）
    fallbackContext: {
      className,
      kebabId: toKebabCase(className),
    },
    logLabel: `CONCEPT verify "${className}"`,
  });

  if (!llmResult.success || !llmResult.data) {
    // 验证LLM失败，默认reject（不写入低质量知识）
    logger.warn(`CONCEPT verify failed for "${className}"，默认reject`);
    return {
      action: 'reject',
      reason: '验证LLM调用失败',
    };
  }

  const result = llmResult.data;

  // 记录验证结果
  if (result.action === 'accept') {
    logger.info(`CONCEPT verify: "${className}" accepted - ${result.reason}`);
  } else if (result.action === 'fix') {
    logger.info(`CONCEPT verify: "${className}" needs fix - ${result.reason}`);
  } else if (result.action === 'reject') {
    logger.warn(`CONCEPT verify: "${className}" rejected (rule ${result.ruleId}) - ${result.reason}`);
  }

  return result;
}

/**
 * 批量验证修正（可选）
 *
 * 将多个概念合并为一次验证调用，减少LLM成本。
 * 但可能降低验证精度。
 */
export async function verifyConceptBatch(
  inputs: VerifyInput[],
  claimsProvider: LlmClaimsProvider,
): Promise<VerifyResult[]> {
  // 目前不实现批量验证，逐个验证
  const results: VerifyResult[] = [];
  for (const input of inputs) {
    const result = await verifyConcept(input, claimsProvider);
    results.push(result);
  }
  return results;
}

/**
 * 验证失败的记录结构
 */
export interface ConceptFailureRecord {
  /** 概念名称 */
  conceptName: string;
  /** 失败原因 */
  reason: string;
  /** 拒绝规则编号 */
  ruleId?: string;
  /** 原始候选信息 */
  candidates: Array<{
    className: string;
    filePath: string;
    suspiciousMark?: string;
  }>;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 失败记录收集器
 */
const failureRecords: ConceptFailureRecord[] = [];

/**
 * 记录验证失败
 */
export function recordFailure(record: ConceptFailureRecord): void {
  failureRecords.push(record);
}

/**
 * 获取所有失败记录
 */
export function getFailureRecords(): ConceptFailureRecord[] {
  return failureRecords;
}

/**
 * 清空失败记录
 */
export function clearFailureRecords(): void {
  failureRecords.length = 0;
}