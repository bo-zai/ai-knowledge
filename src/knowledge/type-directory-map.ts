/**
 * Knowledge Type to Directory Mapping
 *
 * Maps knowledge types to their output directories per design/03-knowledge-directory-structure.md.
 */

import type { KnowledgeType, LegacyType } from '../schemas/knowledge-type.js';
import type { KnowledgeDir, AllObjectDir } from '../knowledge/init-directory.js';

// Re-export types from knowledge-type.ts for convenience
export type { KnowledgeType, LegacyType } from '../schemas/knowledge-type.js';
// Re-export directory types for convenience
export type { KnowledgeDir, AllObjectDir } from '../knowledge/init-directory.js';

/**
 * AllObjectType: 所有知识对象类型（业务类型 + 技术类型）
 */
export type AllObjectType = KnowledgeType | LegacyType;

/**
 * TYPE_TO_DIR: 知识类型 → 输出目录映射
 *
 * 包含设计文档定义的 8 类业务知识目录和 9 类技术类型目录：
 * 业务知识：
 * - capabilities: 能力目录知识
 * - concepts: 概念知识
 * - boundaries: 边界知识
 * - external-systems: 外部系统交互知识
 * - constraints: 约束知识
 * - relations: 能力关系知识
 * - data-model: 数据模型知识
 * - workflows: 跨域业务流程知识
 *
 * 技术类型（旧实现）：
 * - terms: 术语
 * - contracts: 契约
 * - flows: 流程
 * - modules: 模块
 * - open: 开放问题
 * - ownership: 所有权
 * - validation: 验证锚点
 * - db: 数据库
 * - capabilities: 能力声明
 */
export const TYPE_TO_DIR: Record<AllObjectType, AllObjectDir> = {
  // 设计文档 8 类（业务视角）
  CAPABILITY: 'capabilities',
  CONCEPT: 'concepts',
  BOUNDARY: 'boundaries',
  EXTERNAL: 'external-systems',
  CONSTRAINT: 'constraints',
  RELATION: 'relations',
  DATA_MODEL: 'data-model',
  WORKFLOW: 'workflows',

  // 技术类型映射到业务类型目录（设计文档规范）
  TERM: 'concepts',        // 术语 → 概念知识
  DB: 'data-model',        // 数据库 → 数据模型
  CAP: 'capabilities',     // 能力声明 → 能力目录
  FLOW: 'workflows',       // 流程 → 跨域业务流程
  OPEN: 'boundaries',      // 开放问题 → 边界知识

  // 纯技术类型保持原有目录
  CON: 'contracts',
  MOD: 'modules',
  OWN: 'ownership',
  VER: 'validation',
};

/**
 * DIR_TO_TYPE: 输出目录 → 知识类型反向映射
 *
 * 用于从文件路径解析知识类型。
 * 注意：一个目录可能对应多种类型（业务类型和技术类型）。
 */
export const DIR_TO_TYPE: Record<string, AllObjectType> = {
  // 业务目录（优先返回业务类型）
  capabilities: 'CAPABILITY',
  concepts: 'CONCEPT',
  boundaries: 'BOUNDARY',
  'external-systems': 'EXTERNAL',
  constraints: 'CONSTRAINT',
  relations: 'RELATION',
  'data-model': 'DATA_MODEL',
  workflows: 'WORKFLOW',

  // 纯技术目录
  contracts: 'CON',
  modules: 'MOD',
  ownership: 'OWN',
  validation: 'VER',
};

/**
 * Get type from directory name.
 */
export function getTypeFromDir(dirName: string): AllObjectType | undefined {
  return DIR_TO_TYPE[dirName.toLowerCase()];
}

/**
 * Get all knowledge types (business types only).
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
 * Get the output directory for any object type (business or legacy).
 */
export function getDirForType(type: AllObjectType): AllObjectDir {
  const dir = TYPE_TO_DIR[type];
  if (!dir) {
    throw new Error(`Unknown knowledge type: ${type}`);
  }
  return dir;
}

/**
 * Get the output directory for a knowledge type (business types only).
 * @deprecated Use getDirForType instead for broader type support.
 */
export function getKnowledgeDir(type: KnowledgeType): KnowledgeDir {
  const dir = TYPE_TO_DIR[type];
  if (!dir) {
    throw new Error(`Unknown knowledge type: ${type}`);
  }
  // Cast is safe because KnowledgeType maps to KnowledgeDir
  return dir as KnowledgeDir;
}

/**
 * Convert name to kebab-case filename.
 * Per design/03-knowledge-directory-structure.md: use kebab-case, no spaces, no non-ASCII chars.
 */
export function toKebabCase(name: string): string {
  // 替换空格和非ASCII字符
  let result = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]/g, '');

  // 确保不以数字开头
  if (result.match(/^\d/)) {
    result = 'k-' + result;
  }

  // 如果结果是空字符串（输入全是中文等非ASCII字符），使用备用方案
  if (!result) {
    // 使用时间戳作为备用ID
    result = `obj-${Date.now()}`;
  }

  return result;
}
