/**
 * Agent 注册表
 *
 * 导出所有支持的 Agent，提供统一的注册和查询接口
 */

import type { Agent } from './types.js';
import { CLAUDE_CODE_AGENT } from './claude-code.js';
import { CODEX_AGENT } from './codex.js';
import { DEVAGENT_AGENT } from './devagent.js';
import { CMBCOWORK_AGENT } from './cmbcowork.js';

// 导出所有 Agent 实现
export { CLAUDE_CODE_AGENT } from './claude-code.js';
export { CODEX_AGENT } from './codex.js';
export { DEVAGENT_AGENT } from './devagent.js';
export { CMBCOWORK_AGENT } from './cmbcowork.js';
export type { Agent, SkillFile, SkillInitConfig, SkillInitResult } from './types.js';

/**
 * 所有支持的 Agent 列表
 */
export const ALL_AGENTS: Agent[] = [
  CLAUDE_CODE_AGENT,
  CODEX_AGENT,
  DEVAGENT_AGENT,
  CMBCOWORK_AGENT,
];

/**
 * 默认启用的 Agent（generate 命令自动初始化时使用）
 */
export const DEFAULT_AGENTS: Agent[] = [
  CLAUDE_CODE_AGENT,
];

/**
 * 根据 ID 查找 Agent
 */
export function getAgentById(id: string): Agent | undefined {
  return ALL_AGENTS.find(agent => agent.id === id);
}

/**
 * 根据多个 ID 查找 Agent
 */
export function getAgentsByIds(ids: string[]): Agent[] {
  return ids
    .map(id => getAgentById(id))
    .filter((agent): agent is Agent => agent !== undefined);
}