/**
 * DomainClusterAgent - 业务域划分 LLM Agent
 *
 * 使用 LangGraph 工具动态探索代码库，判断候选分区是否应该合并
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeConfig } from '../agent-runtime/runtime.js';
import { createDomainClusterTools } from '../agent-tools/domain-cluster-tools.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import { logger } from '../shared/logger.js';
import fs from 'fs/promises';
import path from 'path';
import type {
  DomainClusterInput,
  DomainClusterResult,
  DomainMergeDecision,
  PartitionCandidate,
} from './types.js';

// ========== 提示词加载 ==========

/**
 * 加载提示词文件
 * 使用 import.meta.url 定位当前模块路径，避免 process.cwd() 问题
 */
async function loadSystemPrompt(): Promise<string> {
  // 获取当前模块所在目录
  const currentModuleDir = path.dirname(new URL(import.meta.url).pathname);
  // 提示词文件在 src/prompts 目录
  const promptFile = path.join(currentModuleDir, '..', 'prompts', 'domain-cluster.md');

  try {
    const content = await fs.readFile(promptFile, 'utf-8');
    logger.info(`[DomainClusterAgent] Loaded prompt from: ${promptFile}`);
    return content;
  } catch (err) {
    logger.warn(`[DomainClusterAgent] Failed to load prompt file, using fallback: ${err}`);
    return DOMAIN_CLUSTER_FALLBACK_PROMPT;
  }
}

/**
 * 备用提示词（文件加载失败时使用）
 */
const DOMAIN_CLUSTER_FALLBACK_PROMPT = `
# 业务域划分专家

你是一个业务域划分专家，专门负责分析代码库中的候选分区，判断它们是否属于同一个业务域，并做出合并决策。

请分析输入的候选分区，输出 JSON 数组格式的合并决策。
`;

// ========== Agent 类 ==========

/**
 * DomainClusterAgent - 业务域划分 LLM Agent
 */
export class DomainClusterAgent {
  private readonly workspacePath: string;
  private readonly agent: AgentRuntime;

  constructor(workspacePath: string, agent: AgentRuntime) {
    this.workspacePath = workspacePath;
    this.agent = agent;
  }

  /**
   * 分析候选分区，输出合并决策
   */
  async analyze(input: DomainClusterInput): Promise<DomainClusterResult> {
    const startTime = Date.now();

    try {
      // 加载提示词
      const systemPrompt = await loadSystemPrompt();

      // 构建输入消息
      const inputMessage = this.buildInputMessage(input);

      // 调用 Agent
      // recursionLimit 控制 Agent 执行循环次数（每次工具调用算一次递归）
      // 默认值 25 对于复杂分析任务可能不足，增加到 100 允许完成完整分析流程
      // 防止 GraphRecursionError: Recursion limit reached without hitting a stop condition
      const response = await this.agent.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: inputMessage },
        ],
      }, {
        recursionLimit: 100,
      });

      // 解析响应
      const lastMessage = response.messages[response.messages.length - 1];
      const content = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

      const decisions = this.parseDecisions(content);

      // 验证决策完整性
      const validation = this.validateDecisions(decisions, input.candidates);
      if (!validation.valid) {
        logger.warn(`Decision validation failed: ${validation.error}`);
        // 尝试修复
        const fixedDecisions = this.fixDecisions(decisions, input.candidates);
        return {
          decisions: fixedDecisions,
          success: true,
          executionTimeMs: Date.now() - startTime,
        };
      }

      return {
        decisions,
        success: true,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      logger.error('DomainClusterAgent failed:', err);
      return {
        decisions: [],
        success: false,
        error: String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 构建输入消息
   */
  private buildInputMessage(input: DomainClusterInput): string {
    return `
请分析以下候选分区，判断是否需要合并。

## 项目上下文
- 项目路径: ${input.projectContext.repoPath}
- 模块列表: ${input.projectContext.moduleNames?.join(', ') ?? '未知'}
- 是否有领域文档: ${input.projectContext.hasDomainDocs ? '是' : '否'}

## 候选列表
${JSON.stringify(input.candidates, null, 2)}

## 候选关系
${JSON.stringify(input.candidateRelations, null, 2)}

## 预分组
${JSON.stringify(input.candidateGroups, null, 2)}

请输出 JSON 数组格式的合并决策。
`;
  }

  /**
   * 解析决策
   */
  private parseDecisions(content: string): DomainMergeDecision[] {
    try {
      // 尝试直接解析 JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as DomainMergeDecision[];
      }

      // 尝试解析 markdown 代码块中的 JSON
      const codeBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]) as DomainMergeDecision[];
      }

      // 尝试解析 markdown 代码块（无语言标记）
      const plainCodeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
      if (plainCodeBlockMatch) {
        return JSON.parse(plainCodeBlockMatch[1]) as DomainMergeDecision[];
      }

      logger.warn('No valid JSON found in response');
      return [];
    } catch (err) {
      logger.error('Failed to parse decisions:', err);
      return [];
    }
  }

  /**
   * 验证决策完整性
   */
  private validateDecisions(
    decisions: DomainMergeDecision[],
    candidates: PartitionCandidate[]
  ): { valid: boolean; error?: string } {
    const allCandidateIds = candidates.map(c => c.candidateId);
    const decisionIds = decisions.flatMap(d => d.mergeGroup);

    // 检查是否有遗漏
    const missing = allCandidateIds.filter(id => !decisionIds.includes(id));
    if (missing.length > 0) {
      return { valid: false, error: `Missing candidates: ${missing.join(', ')}` };
    }

    // 检查是否有重复
    const duplicates = decisionIds.filter((id, idx) => decisionIds.indexOf(id) !== idx);
    if (duplicates.length > 0) {
      return { valid: false, error: `Duplicate candidates: ${duplicates.join(', ')}` };
    }

    // 检查置信度范围
    for (const decision of decisions) {
      if (decision.confidence < 0 || decision.confidence > 1) {
        return { valid: false, error: `Invalid confidence for ${decision.mergeGroup.join(',')}` };
      }
    }

    return { valid: true };
  }

  /**
   * 修复决策（添加遗漏的候选）
   */
  private fixDecisions(
    decisions: DomainMergeDecision[],
    candidates: PartitionCandidate[]
  ): DomainMergeDecision[] {
    const decisionIds = decisions.flatMap(d => d.mergeGroup);
    const missing = candidates.filter(c => !decisionIds.includes(c.candidateId));

    // 为每个遗漏的候选创建单独决策
    for (const candidate of missing) {
      decisions.push({
        mergeGroup: [candidate.candidateId],
        domainName: `${candidate.anchorTable}域`,
        confidence: 0.3,
        reasoning: '无法判断，Agent 未输出决策，自动生成独立决策',
      });
    }

    return decisions;
  }
}

// ========== 工厂函数 ==========

/**
 * 创建 DomainClusterAgent 实例
 */
export async function createDomainClusterAgent(
  workspacePath: string,
  modelConfig?: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  }
): Promise<DomainClusterAgent> {
  // 使用默认配置或自定义配置
  const config = {
    model: modelConfig?.model ?? LLM_DEFAULTS.model,
    baseUrl: modelConfig?.baseUrl ?? LLM_DEFAULTS.baseUrl,
    apiKey: modelConfig?.apiKey ?? process.env[LLM_DEFAULTS.apiKeyEnv] ?? LLM_DEFAULTS.apiKey,
    maxTokens: 128_000,
  };

  // 创建工具集（从统一的工具类导入）
  const tools = createDomainClusterTools(workspacePath);

  // 加载提示词
  const systemPrompt = await loadSystemPrompt();

  // 创建 Agent Runtime
  const agent = createAgentRuntime({
    model: {
      id: 'domain-cluster-agent',
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      maxTokens: config.maxTokens,
    },
    workspacePath,
    tools,
    extraSystemPrompt: systemPrompt,
    enableSummarization: false, // 禁用摘要，保持完整上下文
    enableTodoList: false,
  });

  return new DomainClusterAgent(workspacePath, agent);
}

/**
 * 同步版本：创建 DomainClusterAgent（不等待初始化）
 */
export function createDomainClusterAgentSync(
  workspacePath: string,
  agent: AgentRuntime
): DomainClusterAgent {
  return new DomainClusterAgent(workspacePath, agent);
}