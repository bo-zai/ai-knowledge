/** 设计文档定义的知识库输出目录名 */
export const DEFAULT_KNOWLEDGE_DIR = 'ai-knowledge';

/** 兼容旧命名（已废弃，使用 DEFAULT_KNOWLEDGE_DIR） */
export const DEFAULT_BOOTSTRAP_DIR = DEFAULT_KNOWLEDGE_DIR;

/** 旧实现的默认对象类型（技术视角） */
export const DEFAULT_OBJECT_TYPES = ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB'] as const;

/** 设计文档定义的知识类型（业务视角） */
export const KNOWLEDGE_TYPES = [
  'CAPABILITY', 'CONCEPT', 'BOUNDARY', 'EXTERNAL',
  'CONSTRAINT', 'RELATION', 'DATA_MODEL', 'WORKFLOW'
] as const;