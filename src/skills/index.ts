/**
 * Skills 模块
 *
 * 提供 skill 初始化和管理功能
 */

export {
  initializeSkills,
  needsSkillInitialization,
  getSupportedAgentIds,
  type SkillInitSummary,
} from './skill-init.js';

export {
  ALL_AGENTS,
  DEFAULT_AGENTS,
  getAgentById,
  getAgentsByIds,
  type Agent,
  type SkillFile,
  type SkillInitConfig,
  type SkillInitResult,
} from './agents/index.js';

export {
  USE_KNOWLEDGE_SKILL,
  getAllSkillTemplates,
} from './skill-templates.js';