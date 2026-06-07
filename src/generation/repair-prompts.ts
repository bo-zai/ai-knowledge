import type { KnowledgeType } from '../schemas/knowledge-type.js';

/**
 * JSON 解析错误类型
 */
export type JsonParseErrorType =
  | 'format'       // markdown 包裹等格式问题
  | 'prefix_text'  // 前缀文本（如 "我需要..."）
  | 'syntax'       // JSON 语法错误（括号不匹配等）
  | 'content'      // 输出解释文本而非 JSON
  | 'truncated'    // 输出截断不完整
  | 'empty'        // 空输出
  | 'not_object'   // 不是对象类型
  | 'timeout';     // LLM 调用超时

/**
 * 知识类型的必须字段列表
 */
export const REQUIRED_FIELDS_BY_TYPE: Record<KnowledgeType, string[]> = {
  ARCHITECTURE: ['architecture_overview_name', 'summary_zh', 'project_type', 'tech_stack', 'structure_pattern'],
  CONCEPT: ['concept_name', 'summary_zh', 'aliases', 'business_meaning_zh', 'evidence'],
  CAPABILITY: ['capability_name', 'summary_zh', 'aliases', 'business_scenario', 'entry_points'],
  BOUNDARY: ['boundary_name', 'summary_zh', 'aliases', 'constraints', 'config_evidence'],
  WORKFLOW: ['workflow_name', 'summary_zh', 'aliases', 'steps', 'triggers'],
  DATA_MODEL: ['model_name', 'summary_zh', 'aliases', 'fields', 'evidence'],
  EXTERNAL: ['external_name', 'summary_zh', 'aliases', 'service_type', 'integration_points'],
  CONSTRAINT: ['constraint_name', 'summary_zh', 'aliases', 'rule_type', 'evidence'],
  RELATION: ['relation_name', 'summary_zh', 'aliases', 'from_entity', 'to_entity'],
};

/**
 * 知识类型的字段结构示例（用于完整修复提示词）
 */
export const FIELD_STRUCTURES_BY_TYPE: Record<KnowledgeType, string> = {
  ARCHITECTURE: `{
  "architecture_overview_name": "项目名称",
  "summary_zh": "一句话定位：这是什么类型的项目",
  "project_type": "项目类型（backend-service/frontend-app/cli-tool/library）",
  "tech_stack": ["技术栈1", "技术栈2"],
  "structure_pattern": "结构模式说明",
  "key_directories": [{"path": "目录路径", "purpose": "用途说明"}],
  "entry_points": [{"type": "入口类型", "location": "位置", "description": "说明"}],
  "evidence": ["证据路径"],
  "warnings": []
}`,

  CONCEPT: `{
  "concept_name": "概念中文名（如：用户会员）",
  "summary_zh": "一句话定位：这是什么业务场景下的什么",
  "aliases": ["英文别名", "EnglishAlias", "kebab-case-id"],
  "business_meaning_zh": "业务含义详细说明",
  "evidence": ["文件路径#字段名", "FilePath.java#fieldName"],
  "related_concepts": ["关联概念名"],
  "warnings": []
}`,

  CAPABILITY: `{
  "capability_name": "能力中文名（如：用户登录）",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名", "EnglishAlias"],
  "business_scenario": "业务场景说明",
  "entry_points": [{"name": "方法名", "file": "文件路径", "line": 行号}],
  "evidence": ["证据路径"],
  "warnings": []
}`,

  BOUNDARY: `{
  "boundary_name": "边界中文名（如：支付渠道配置）",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "constraints": [{"name": "约束名", "value": "约束值", "config_file": "配置文件"}],
  "config_evidence": ["配置文件路径"],
  "warnings": []
}`,

  WORKFLOW: `{
  "workflow_name": "流程中文名（如：用户购买流程）",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "steps": [{"action": "操作", "actor": "执行者", "order": 顺序}],
  "triggers": ["触发条件"],
  "evidence": ["证据路径"],
  "warnings": []
}`,

  DATA_MODEL: `{
  "model_name": "模型中文名",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "fields": [{"name": "字段名", "type": "类型", "meaning": "含义"}],
  "evidence": ["实体文件路径"],
  "warnings": []
}`,

  EXTERNAL: `{
  "external_name": "外部服务中文名",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "service_type": "服务类型（如：支付、短信）",
  "integration_points": [{"name": "集成点", "method": "调用方式"}],
  "warnings": []
}`,

  CONSTRAINT: `{
  "constraint_name": "约束中文名",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "rule_type": "规则类型",
  "evidence": ["证据路径"],
  "warnings": []
}`,

  RELATION: `{
  "relation_name": "关系中文名",
  "summary_zh": "一句话定位",
  "aliases": ["英文别名"],
  "from_entity": "源实体",
  "to_entity": "目标实体",
  "relation_type": "关系类型",
  "warnings": []
}`,
};

/**
 * 生成完整修复提示词（第1、2次重试使用）
 */
export function getFullRepairPrompt(
  type: KnowledgeType,
  rawOutput: string,
  context: Record<string, unknown>,
): string {
  const fieldStructure = FIELD_STRUCTURES_BY_TYPE[type] || FIELD_STRUCTURES_BY_TYPE.CONCEPT;
  const contextSnippet = JSON.stringify(context).slice(0, 200);

  return `
你之前的输出不是有效的 JSON 格式，无法解析。请修复并重新输出。

原始输出：
${rawOutput}

格式要求：
1. 输出纯 JSON，不要任何前置解释文字（如"我需要..."、"分析如下..."）
2. 不要用 markdown 代码块包裹（去掉代码块标记）
3. 确保 JSON 语法正确：括号匹配、逗号位置正确、字符串用双引号
4. 所有字段 key 必须是英文

必须包含的字段（${type} 类型）：
${fieldStructure}

上下文信息：
${contextSnippet}

请直接输出修复后的 JSON 对象（不要任何额外文字）：
`;
}

/**
 * 生成简化修复提示词（第3次及以后重试使用）
 */
export function getSimpleRepairPrompt(
  type: KnowledgeType,
  rawOutput: string,
): string {
  const requiredFields = REQUIRED_FIELDS_BY_TYPE[type] || REQUIRED_FIELDS_BY_TYPE.CONCEPT;

  return `
将以下内容转换为有效的 JSON 格式（${type} 类型）。

必须字段：${requiredFields.join(', ')}

原始输出：
${rawOutput}

只输出 JSON，不要任何其他文字：
`;
}

/**
 * 根据重试次数选择修复提示词
 *
 * @param attempt 当前重试次数（1, 2, 3...）
 * @param maxRetries 最大重试次数
 * @param type 知识类型
 * @param rawOutput 原始 LLM 输出
 * @param context 上下文数据
 */
export function getRepairPrompt(
  attempt: number,
  maxRetries: number,
  type: KnowledgeType,
  rawOutput: string,
  context: Record<string, unknown>,
): string {
  // 前两次使用完整提示词
  if (attempt <= 2) {
    return getFullRepairPrompt(type, rawOutput, context);
  }
  // 后续使用简化提示词
  return getSimpleRepairPrompt(type, rawOutput);
}

/**
 * 根据重试次数选择 systemPrompt
 *
 * @param attempt 当前重试次数
 * @param originalSystem 原始 systemPrompt
 */
export function getRetrySystemPrompt(attempt: number, originalSystem: string): string {
  // 前两次保持原始 systemPrompt（不缩减）
  if (attempt <= 2) {
    return originalSystem;
  }
  // 后续使用简化 systemPrompt
  return '你是 JSON 格式修复专家。请输出有效的 JSON 格式。';
}

/**
 * 分类 JSON 解析错误类型
 */
export function classifyJsonError(rawOutput: string, parseError: Error): JsonParseErrorType {
  const msg = parseError.message.toLowerCase();
  const output = rawOutput.trim();

  // 空输出
  if (output.length === 0) {
    return 'empty';
  }

  // 前缀文本（中文开头）
  if (/^[^\[{]/.test(output) && /[一-龥]/.test(output.slice(0, 20))) {
    return 'prefix_text';
  }

  // 截断（输出不完整，没有结束括号）
  if (!output.endsWith('}') && !output.endsWith(']') && !output.endsWith('```')) {
    return 'truncated';
  }

  // 语法错误
  if (msg.includes('unexpected token') || msg.includes('expected') || msg.includes('comma')) {
    return 'syntax';
  }

  // 格式问题（markdown 包裹）
  if (output.includes('```json') || output.includes('```')) {
    return 'format';
  }

  // 默认为内容问题
  return 'content';
}