/**
 * Skill 初始化模块
 *
 * 提供 skill 初始化功能，支持多个 AI Agent
 */

import { logger } from "../shared/logger.js";
import type {
  Agent,
  SkillInitConfig,
  SkillInitResult,
} from "./agents/types.js";
import { ALL_AGENTS, DEFAULT_AGENTS, getAgentsByIds } from "./agents/index.js";

/**
 * Skill 初始化结果汇总
 */
export interface SkillInitSummary {
  /** 初始化的 Agent 数量 */
  agentCount: number;

  /** 所有 Agent 的初始化结果 */
  results: SkillInitResult[];

  /** 成功数量 */
  succeeded: number;

  /** 失败数量 */
  failed: number;

  /** AGENTS.md 是否更新 */
  agentsMdUpdated: boolean;
}

/**
 * 初始化 Skills
 *
 * @param config 初始化配置
 * @param agentIds 要初始化的 Agent ID 列表（默认使用 DEFAULT_AGENTS）
 * @returns 初始化结果汇总
 */
export async function initializeSkills(
  config: SkillInitConfig,
  agentIds?: string[],
): Promise<SkillInitSummary> {
  // 确定要初始化的 Agent
  const agents = agentIds ? getAgentsByIds(agentIds) : DEFAULT_AGENTS;

  if (agents.length === 0) {
    logger.warn("No agents to initialize");
    return {
      agentCount: 0,
      results: [],
      succeeded: 0,
      failed: 0,
      agentsMdUpdated: false,
    };
  }

  logger.info(
    `Initializing skills for ${agents.length} agents: ${agents.map((a) => a.name).join(", ")}`,
  );

  const results: SkillInitResult[] = [];
  let agentsMdUpdated = false;

  // 遍历每个 Agent 执行初始化
  for (const agent of agents) {
    // 检查是否已初始化
    const isInitialized = await agent.isInitialized(config.repoPath, config);

    if (isInitialized && !config.force) {
      logger.info(`${agent.name}: skills already initialized, skipping`);
      results.push({
        agentName: agent.name,
        skillDir: agent.getSkillDir(config.repoPath),
        files: [],
        success: true,
      });
      continue;
    }

    // 执行初始化
    logger.info(`${agent.name}: initializing skills...`);
    const result = await agent.initialize(config);
    results.push(result);

    if (result.success) {
      logger.info(`${agent.name}: ${result.files.length} skill files created`);
      for (const file of result.files) {
        logger.debug(`  - ${file.filename}`);
      }

      // 更新 AGENTS.md（如果需要）
      if (config.updateAgentsMd && agent.generateAgentsMd) {
        const agentsMdContent = await agent.generateAgentsMd(config.repoPath);
        if (agentsMdContent) {
          logger.info(`${agent.name}: AGENTS.md updated`);
          agentsMdUpdated = true;
        }
      }
    } else {
      logger.error(`${agent.name}: initialization failed - ${result.error}`);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  logger.info(
    `Skill initialization complete: ${succeeded} succeeded, ${failed} failed`,
  );

  return {
    agentCount: agents.length,
    results,
    succeeded,
    failed,
    agentsMdUpdated,
  };
}

/**
 * 检查 Skills 是否需要初始化
 *
 * @param repoPath 项目根目录
 * @param agentIds 要检查的 Agent ID 列表（默认使用 DEFAULT_AGENTS）
 * @returns true 表示需要初始化
 */
export async function needsSkillInitialization(
  repoPath: string,
  agentIds?: string[],
  config?: Omit<SkillInitConfig, "repoPath">,
): Promise<boolean> {
  const agents = agentIds ? getAgentsByIds(agentIds) : DEFAULT_AGENTS;
  const fullConfig: SkillInitConfig = { repoPath, ...config };

  for (const agent of agents) {
    const isInitialized = await agent.isInitialized(repoPath, fullConfig);
    if (!isInitialized) {
      return true;
    }
  }

  return false;
}

/**
 * 获取所有支持的 Agent ID
 */
export function getSupportedAgentIds(): string[] {
  return ALL_AGENTS.map((a) => a.id);
}
