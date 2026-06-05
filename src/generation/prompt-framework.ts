/**
 * Prompt Framework
 *
 * 设计文档 05 定义的四层提示词结构：
 * 1. base_system — 全局基础规则（JSON 格式、中文输出、禁止虚构）
 * 2. type_specific — 类型特定规则（提取规则、产物示例、生成约束）
 * 3. phase_context — 阶段上下文（前序产物引用）
 * 4. strategy_modifier — 策略修饰符（bootstrap/refine/validate）
 *
 * 提示词模板存储在 src/prompts/ 目录：
 * - base-system.md: 基础系统规则
 * - rules-{type}.md: 类型特定规则
 * - concept-filter.md: 第三层筛选提示词
 */

import type { AllObjectType, KnowledgeType } from '../knowledge/type-directory-map.js';
import { PromptLoader } from '../shared/prompt-loader.js';

/**
 * 类型名称到提示词模板名称的映射
 */
const TYPE_RULES_MAP: Record<string, string> = {
  CAPABILITY: 'rules-capability',
  CONCEPT: 'rules-concept',
  BOUNDARY: 'rules-boundary',
  EXTERNAL: 'rules-external',
  CONSTRAINT: 'rules-constraint',
  RELATION: 'rules-relation',
  DATA_MODEL: 'rules-data-model',
  WORKFLOW: 'rules-workflow',
  // 兼容旧类型
  TERM: 'rules-concept',
  DB: 'rules-data-model',
  FLOW: 'rules-workflow',
  OPEN: 'rules-boundary',
};

/**
 * Prompt configuration for building a complete prompt
 */
export interface PromptConfig {
  /** Target object type to generate */
  objectType: AllObjectType | KnowledgeType;

  /** Generation strategy */
  strategy: 'bootstrap' | 'refine' | 'validate';

  /** Generation phase (for ordering) */
  phase: 'concept' | 'data_model' | 'capability' | 'parallel';

  /** Dependencies from previous phases */
  dependencies?: {
    /** Already generated concept names */
    conceptNames?: string[];
    /** Already generated data model names */
    dataModelNames?: string[];
    /** Already generated capability domain names */
    capabilityNames?: string[];
    /** Already generated tag pool */
    tagPool?: string[];
  };

  /** Evidence bundle for the generation */
  evidence?: unknown;
}

/**
 * Complete prompt framework output
 */
export interface PromptFramework {
  /** System prompt (global + type-specific + phase + strategy) */
  system: string;

  /** User prompt (evidence + task) */
  user: string;
}

// ============================================================================
// Layer 1: Base System (全局基础规则)
// ============================================================================

/**
 * 全局基础规则
 *
 * 所有知识类型生成都必须遵守的规则。
 * 从 src/prompts/base-system.md 模板加载。
 */
export function getBaseSystemPrompt(): string {
  try {
    return PromptLoader.load('base-system').raw;
  } catch {
    // 模板加载失败时返回硬编码默认值（向后兼容）
    return `你是一个代码知识提取专家。你必须生成符合 Schema 的 JSON 输出。`;
  }
}

/**
 * 基础系统提示词（向后兼容的常量导出）
 * @deprecated 使用 getBaseSystemPrompt() 函数代替
 */
export const BASE_SYSTEM_PROMPT = getBaseSystemPrompt();

// ============================================================================
// Layer 2: Type Specific Rules (类型特定规则)
// ============================================================================

/**
 * 类型特定规则映射
 *
 * 每种知识类型有独特的提取规则、产物示例和生成约束。
 */
export const TYPE_SPECIFIC_RULES: Record<string, string> = {
  // 能力目录
  CAPABILITY: loadTypeRules('rules-capability'),

  // 概念知识
  CONCEPT: loadTypeRules('rules-concept'),

  // 边界知识
  BOUNDARY: loadTypeRules('rules-boundary'),

  // 外部系统交互
  EXTERNAL: loadTypeRules('rules-external'),

  // 约束知识
  CONSTRAINT: loadTypeRules('rules-constraint'),

  // 能力关系
  RELATION: loadTypeRules('rules-relation'),

  // 数据模型
  DATA_MODEL: loadTypeRules('rules-data-model'),

  // 跨域业务流程
  WORKFLOW: loadTypeRules('rules-workflow'),

  // 兼容旧类型
  TERM: loadTypeRules('rules-concept'), // TERM 对应 CONCEPT
  DB: loadTypeRules('rules-data-model'), // DB 对应 DATA_MODEL
  FLOW: loadTypeRules('rules-workflow'), // FLOW 对应 WORKFLOW
  OPEN: loadTypeRules('rules-boundary'), // OPEN 对应 BOUNDARY
};

/**
 * 从模板文件加载类型规则
 */
function loadTypeRules(templateName: string): string {
  try {
    return PromptLoader.load(templateName).raw;
  } catch {
    // 模板加载失败时返回空（保持向后兼容）
    return '';
  }
}

// ============================================================================
// Layer 3: Phase Context (阶段上下文)
// ============================================================================

/**
 * 构建阶段上下文
 *
 * 设计文档要求的生成阶段：
 * - 阶段 1: 概念 → 数据模型 → 能力目录（按序）
 * - 阶段 2: 其他类型并行生成
 */
export function buildPhaseContext(
  phase: 'concept' | 'data_model' | 'capability' | 'parallel',
  dependencies?: PromptConfig['dependencies']
): string {
  if (!dependencies || phase === 'concept') {
    return ''; // Concept phase has no dependencies
  }

  const lines: string[] = [];
  const conceptNames = dependencies.conceptNames;
  const dataModelNames = dependencies.dataModelNames;
  const capabilityNames = dependencies.capabilityNames;
  const tagPool = dependencies.tagPool;

  if (conceptNames && conceptNames.length > 0) {
    lines.push(`## 已生成的概念名称（必须使用这些名称作为引用）`);
    lines.push(conceptNames.map(n => `- ${n}`).join('\n'));
  }

  if (phase !== 'data_model' && dataModelNames && dataModelNames.length > 0) {
    lines.push(`## 已生成的数据模型名称`);
    lines.push(dataModelNames.map(n => `- ${n}`).join('\n'));
  }

  if (phase === 'parallel' && capabilityNames && capabilityNames.length > 0) {
    lines.push(`## 已生成的能力域名称（必须使用这些名称作为引用）`);
    lines.push(capabilityNames.map(n => `- ${n}`).join('\n'));
  }

  if (tagPool && tagPool.length > 0) {
    lines.push(`## 已有标签池（优先使用这些标签保持一致性）`);
    const displayTags = tagPool.slice(0, 20);
    lines.push(displayTags.map(t => `- ${t}`).join('\n'));
    if (tagPool.length > 20) {
      lines.push(`- ... (共 ${tagPool.length} 个标签)`);
    }
  }

  return lines.join('\n\n');
}

// ============================================================================
// Layer 4: Strategy Modifier (策略修饰符)
// ============================================================================

/**
 * 策略修饰符
 *
 * 不同生成策略的差异化规则。
 */
export const STRATEGY_MODIFIERS: Record<string, string> = {
  bootstrap: `## 生成策略：首次生成（bootstrap）

这是首次为该仓库生成知识。你需要从提供的 evidence 中提取完整的知识条目。
- 不要假设已有知识存在，一切从头提取
- 生成完整的、高质量的知识条目
- 置信度设为 "high" 或 "medium"（不设 "low"）`,

  refine: `## 生成策略：增量更新（refine）

这是增量更新已有知识。你需要基于变更的证据重新生成受影响的条目。
- 保持与已有知识的命名一致性
- 只更新变更影响的部分，不变更未受影响的部分
- 标记新增、修改、删除的条目`,

  validate: `## 生成策略：质量验证（validate）

这是对已有知识的质量验证。你需要检查知识的准确性和完整性。
- 检查证据引用是否仍然有效
- 检查描述是否与当前代码一致
- 输出验证结果和需要修正的建议`,
};

// ============================================================================
// Main API
// ============================================================================

/**
 * 构建完整的提示词框架
 */
export function buildPromptFramework(config: PromptConfig): PromptFramework {
  const { objectType, strategy, phase, dependencies } = config;

  // Layer 1: Base system
  const baseSystem = BASE_SYSTEM_PROMPT;

  // Layer 2: Type specific rules
  const typeSpecific = TYPE_SPECIFIC_RULES[objectType] ?? '';

  // Layer 3: Phase context
  const phaseContext = buildPhaseContext(phase, dependencies);

  // Layer 4: Strategy modifier
  const strategyModifier = STRATEGY_MODIFIERS[strategy] ?? '';

  // Combine all layers into system prompt
  const systemParts = [baseSystem, typeSpecific, phaseContext, strategyModifier]
    .filter(p => p.length > 0)
    .join('\n\n---\n\n');

  const system = systemParts;

  // Build user prompt with evidence
  const user = buildUserPrompt(config);

  return { system, user };
}

/**
 * 构建用户提示词
 */
function buildUserPrompt(config: PromptConfig): string {
  const { objectType, evidence } = config;

  const task = {
    object_type: objectType,
    generation_mode: config.strategy,
  };

  if (evidence) {
    return JSON.stringify({ task, evidence }, null, 2);
  }

  return JSON.stringify({ task }, null, 2);
}

/**
 * 获取类型特定规则（单独使用）
 */
export function getTypeSpecificRules(objectType: string): string {
  return TYPE_SPECIFIC_RULES[objectType] ?? '';
}