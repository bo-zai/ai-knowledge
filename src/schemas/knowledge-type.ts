/**
 * Knowledge Type Definitions
 *
 * 设计文档 02 定义的 8 类知识（业务视角）：
 * 1. CAPABILITY - 能力目录
 * 2. CONCEPT - 概念知识
 * 3. BOUNDARY - 边界知识
 * 4. EXTERNAL - 外部系统交互
 * 5. CONSTRAINT - 约束知识
 * 6. RELATION - 能力关系
 * 7. DATA_MODEL - 数据模型
 * 8. WORKFLOW - 跨域业务流程
 *
 * 与旧技术类型（TERM/CON/FLOW/MOD/OPEN/OWN/VER/DB/CAP）的映射关系。
 */

import { z } from 'zod';

// ============================================================================
// 业务知识类型（设计文档定义）
// ============================================================================

/**
 * 业务知识类型枚举
 *
 * 来自设计文档 02-knowledge-type-spec.md
 */
export const KnowledgeTypeSchema = z.enum([
  'CAPABILITY',
  'CONCEPT',
  'BOUNDARY',
  'EXTERNAL',
  'CONSTRAINT',
  'RELATION',
  'DATA_MODEL',
  'WORKFLOW',
]);

export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;

/**
 * 所有业务知识类型列表
 */
export const ALL_KNOWLEDGE_TYPES: KnowledgeType[] = [
  'CAPABILITY',
  'CONCEPT',
  'BOUNDARY',
  'EXTERNAL',
  'CONSTRAINT',
  'RELATION',
  'DATA_MODEL',
  'WORKFLOW',
];

/**
 * 业务知识类型的中文名称
 */
export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  CAPABILITY: '能力目录',
  CONCEPT: '概念知识',
  BOUNDARY: '边界知识',
  EXTERNAL: '外部系统交互',
  CONSTRAINT: '约束知识',
  RELATION: '能力关系',
  DATA_MODEL: '数据模型',
  WORKFLOW: '跨域业务流程',
};

/**
 * 业务知识类型对应的输出目录
 */
export const KNOWLEDGE_TYPE_DIRS: Record<KnowledgeType, string> = {
  CAPABILITY: 'capabilities',
  CONCEPT: 'concepts',
  BOUNDARY: 'boundaries',
  EXTERNAL: 'external-systems',
  CONSTRAINT: 'constraints',
  RELATION: 'relations',
  DATA_MODEL: 'data-model',
  WORKFLOW: 'workflows',
};

// ============================================================================
// 技术类型（旧实现）
// ============================================================================

/**
 * 技术类型枚举（旧实现）
 *
 * 来自现有 Schema 定义
 */
export const LegacyTypeSchema = z.enum([
  'TERM',
  'CON',
  'FLOW',
  'MOD',
  'OPEN',
  'OWN',
  'VER',
  'DB',
  'CAP',
]);

export type LegacyType = z.infer<typeof LegacyTypeSchema>;

/**
 * 所有技术类型列表
 */
export const ALL_LEGACY_TYPES: LegacyType[] = [
  'TERM',
  'CON',
  'FLOW',
  'MOD',
  'OPEN',
  'OWN',
  'VER',
  'DB',
  'CAP',
];

/**
 * 技术类型的中文名称
 */
export const LEGACY_TYPE_LABELS: Record<LegacyType, string> = {
  TERM: '术语',
  CON: '契约',
  FLOW: '流程',
  MOD: '模块',
  OPEN: '开放问题',
  OWN: '所有权',
  VER: '验证锚点',
  DB: '数据库',
  CAP: '能力声明',
};

// ============================================================================
// 类型映射（新旧兼容）
// ============================================================================

/**
 * 技术类型到业务类型的映射
 *
 * 用于将旧类型转换为新类型。
 * undefined 表示该技术类型无对应的业务类型（纯技术类型）。
 */
export const LEGACY_TO_KNOWLEDGE_MAP: Record<LegacyType, KnowledgeType | undefined> = {
  TERM: 'CONCEPT',           // 术语 → 概念知识
  CON: undefined,            // 契约：纯技术类型，无业务对应
  FLOW: 'WORKFLOW',          // 流程 → 跨域业务流程
  MOD: undefined,            // 模块：纯技术类型，无业务对应
  OPEN: 'BOUNDARY',          // 开放问题 → 边界知识
  OWN: undefined,            // 所有权：纯技术类型，无业务对应
  VER: undefined,            // 验证锚点：纯技术类型，无业务对应
  DB: 'DATA_MODEL',          // 数据库 → 数据模型
  CAP: 'CAPABILITY',         // 能力声明 → 能力目录
};

/**
 * 业务类型到技术类型的反向映射
 *
 * 一个业务类型可能对应多个技术类型。
 */
export const KNOWLEDGE_TO_LEGACY_MAP: Record<KnowledgeType, LegacyType[]> = {
  CAPABILITY: ['CAP'],
  CONCEPT: ['TERM'],
  BOUNDARY: ['OPEN'],
  EXTERNAL: [],              // 新类型，无技术对应
  CONSTRAINT: [],            // 新类型，无技术对应
  RELATION: [],              // 新类型，无技术对应
  DATA_MODEL: ['DB'],
  WORKFLOW: ['FLOW'],
};

/**
 * 判断技术类型是否有业务对应
 */
export function hasBusinessMapping(legacyType: LegacyType): boolean {
  return LEGACY_TO_KNOWLEDGE_MAP[legacyType] !== undefined;
}

/**
 * 获取技术类型对应的业务类型
 */
export function getKnowledgeTypeForLegacy(legacyType: LegacyType): KnowledgeType | undefined {
  return LEGACY_TO_KNOWLEDGE_MAP[legacyType];
}

/**
 * 判断类型是业务知识类型
 */
export function isKnowledgeType(type: string): type is KnowledgeType {
  return KnowledgeTypeSchema.safeParse(type).success;
}

/**
 * 判断类型是技术类型
 */
export function isLegacyType(type: string): type is LegacyType {
  return LegacyTypeSchema.safeParse(type).success;
}

/**
 * 获取类型的中文名称
 */
export function getTypeLabel(type: KnowledgeType | LegacyType): string {
  if (isKnowledgeType(type)) {
    return KNOWLEDGE_TYPE_LABELS[type];
  }
  return LEGACY_TYPE_LABELS[type] ?? type;
}

/**
 * 获取类型对应的输出目录
 */
export function getTypeDir(type: KnowledgeType | LegacyType): string {
  if (isKnowledgeType(type)) {
    return KNOWLEDGE_TYPE_DIRS[type];
  }
  // 技术类型使用映射后的目录，或保持原目录
  const knowledgeType = getKnowledgeTypeForLegacy(type);
  if (knowledgeType) {
    return KNOWLEDGE_TYPE_DIRS[knowledgeType];
  }
  // 纯技术类型保持原有目录名
  const legacyDirs: Record<LegacyType, string> = {
    TERM: 'terms',
    CON: 'contracts',
    FLOW: 'flows',
    MOD: 'modules',
    OPEN: 'open',
    OWN: 'ownership',
    VER: 'validation',
    DB: 'db',
    CAP: 'capabilities',
  };
  return legacyDirs[type] ?? 'unknown';
}

// ============================================================================
// 生成阶段定义
// ============================================================================

/**
 * 生成阶段枚举
 *
 * 设计文档定义的生成顺序：
 * - 阶段 1: 概念 → 数据模型 → 能力目录（按序）
 * - 阶段 2: 其他类型并行
 */
export const GenerationPhaseSchema = z.enum([
  'concept',
  'data_model',
  'capability',
  'parallel',
]);

export type GenerationPhase = z.infer<typeof GenerationPhaseSchema>;

/**
 * 各生成阶段对应的类型
 */
export const PHASE_TO_TYPES: Record<GenerationPhase, KnowledgeType[]> = {
  concept: ['CONCEPT'],
  data_model: ['DATA_MODEL'],
  capability: ['CAPABILITY'],
  parallel: ['BOUNDARY', 'EXTERNAL', 'CONSTRAINT', 'RELATION', 'WORKFLOW'],
};

/**
 * 获取类型所属的生成阶段
 */
export function getPhaseForType(type: KnowledgeType): GenerationPhase {
  for (const [phase, types] of Object.entries(PHASE_TO_TYPES)) {
    if (types.includes(type)) {
      return phase as GenerationPhase;
    }
  }
  return 'parallel'; // 默认为并行阶段
}

// ============================================================================
// 知识类型 Schema 基础
// ============================================================================

/**
 * 所有知识条目的通用字段
 *
 * 对应设计文档 02 的"通用约定"
 */
export const commonKnowledgeSchema = z.object({
  /** 条目 ID */
  id: z.string().min(1),

  /** 知识类型 */
  type: KnowledgeTypeSchema.or(LegacyTypeSchema),

  /** 中文名称 */
  name_zh: z.string().min(1),

  /** 一句话定位 */
  summary_zh: z.string().min(1),

  /** 适用范围 */
  applicable_scope: z.string().min(1),

  /** 标签（1~3 个） */
  tags: z.array(z.string()).min(1).max(3),

  /** 证据路径列表 */
  evidence: z.array(z.string()).min(1),

  /** 生成时间 */
  generated_at: z.string().optional(),

  /** 来源文件 */
  source_files: z.array(z.string()).optional(),

  /** 置信度 */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export type CommonKnowledgeFields = z.infer<typeof commonKnowledgeSchema>;