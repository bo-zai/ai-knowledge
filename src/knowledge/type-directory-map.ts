/**
 * 统一的知识类型到目录映射
 *
 * 设计文档定义的 8 类知识（业务视角）：
 * - CAPABILITY: 能力目录
 * - CONCEPT: 概念知识
 * - BOUNDARY: 边界知识
 * - EXTERNAL: 外部系统交互
 * - CONSTRAINT: 约束知识
 * - RELATION: 能力关系
 * - DATA_MODEL: 数据模型
 * - WORKFLOW: 跨域业务流程
 *
 * 兼容旧类型（技术视角）：
 * - TERM → concepts
 * - CON → contracts（保留技术契约类型）
 * - FLOW → workflows
 * - MOD → modules（保留技术模块类型）
 * - OPEN → boundaries
 * - OWN → ownership（保留所有权类型）
 * - VER → validation（保留验证类型）
 * - DB → data-model
 * - CAP → capabilities
 */

/** 设计文档定义的业务知识类型 */
export type KnowledgeType =
  | 'CAPABILITY'
  | 'CONCEPT'
  | 'BOUNDARY'
  | 'EXTERNAL'
  | 'CONSTRAINT'
  | 'RELATION'
  | 'DATA_MODEL'
  | 'WORKFLOW';

/** 兼容的技术类型（旧实现） */
export type LegacyObjectType =
  | 'TERM'
  | 'CON'
  | 'FLOW'
  | 'MOD'
  | 'OPEN'
  | 'OWN'
  | 'VER'
  | 'DB'
  | 'CAP';

/** 所有支持的类型 */
export type AllObjectType = KnowledgeType | LegacyObjectType;

/**
 * 类型到输出目录的映射
 *
 * 设计文档 03 定义的目录结构：
 * - capabilities/
 * - concepts/
 * - boundaries/
 * - external-systems/
 * - constraints/
 * - relations/
 * - data-model/
 * - workflows/
 *
 * 兼容旧实现保留的目录：
 * - contracts/（CON）
 * - modules/（MOD）
 * - ownership/（OWN）
 * - validation/（VER）
 */
export const TYPE_TO_DIR: Record<AllObjectType, string> = {
  // 设计文档 8 类（业务视角）
  CAPABILITY: 'capabilities',
  CONCEPT: 'concepts',
  BOUNDARY: 'boundaries',
  EXTERNAL: 'external-systems',
  CONSTRAINT: 'constraints',
  RELATION: 'relations',
  DATA_MODEL: 'data-model',
  WORKFLOW: 'workflows',

  // 兼容旧类型（技术视角）
  TERM: 'concepts',
  CON: 'contracts',
  FLOW: 'workflows',
  MOD: 'modules',
  OPEN: 'boundaries',
  OWN: 'ownership',
  VER: 'validation',
  DB: 'data-model',
  CAP: 'capabilities',
};

/**
 * 获取类型对应的输出目录
 */
export function getDirForType(type: AllObjectType): string {
  return TYPE_TO_DIR[type] ?? 'unknown';
}

/**
 * 判断是否为设计文档定义的业务类型
 */
export function isKnowledgeType(type: string): type is KnowledgeType {
  return type in TYPE_TO_DIR && !isLegacyObjectType(type);
}

/**
 * 判断是否为兼容的技术类型
 */
export function isLegacyObjectType(type: string): type is LegacyObjectType {
  const legacyTypes: Set<string> = new Set([
    'TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB', 'CAP'
  ]);
  return legacyTypes.has(type);
}

/**
 * 获取所有设计文档定义的业务类型
 */
export function getKnowledgeTypes(): KnowledgeType[] {
  return [
    'CAPABILITY',
    'CONCEPT',
    'BOUNDARY',
    'EXTERNAL',
    'CONSTRAINT',
    'RELATION',
    'DATA_MODEL',
    'WORKFLOW',
  ];
}

/**
 * 获取所有兼容的技术类型
 */
export function getLegacyObjectTypes(): LegacyObjectType[] {
  return ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB', 'CAP'];
}

/**
 * 设计文档业务类型与兼容技术类型的映射
 */
export const KNOWLEDGE_TO_LEGACY: Record<KnowledgeType, LegacyObjectType[]> = {
  CAPABILITY: ['CAP'],
  CONCEPT: ['TERM'],
  BOUNDARY: ['OPEN'],
  EXTERNAL: [],
  CONSTRAINT: [],
  RELATION: [],
  DATA_MODEL: ['DB'],
  WORKFLOW: ['FLOW'],
};

/**
 * 兼容技术类型到设计文档业务类型的反向映射
 */
export const LEGACY_TO_KNOWLEDGE: Record<LegacyObjectType, KnowledgeType | undefined> = {
  CAP: 'CAPABILITY',
  TERM: 'CONCEPT',
  CON: undefined, // 技术契约类型，无业务对应
  FLOW: 'WORKFLOW',
  MOD: undefined, // 技术模块类型，无业务对应
  OPEN: 'BOUNDARY',
  OWN: undefined, // 所有权类型，无业务对应
  VER: undefined, // 验证类型，无业务对应
  DB: 'DATA_MODEL',
};