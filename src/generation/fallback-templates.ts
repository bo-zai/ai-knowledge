import type { KnowledgeType } from '../schemas/knowledge-type.js';
import { toKebabCase } from '../knowledge/type-directory-map.js';

/**
 * 知识类型降级模板配置
 */
export const FALLBACK_TEMPLATES: Record<KnowledgeType, Record<string, unknown>> = {
  ARCHITECTURE: {
    architecture_overview_name: '{projectName}',
    summary_zh: '{projectName}架构概览（待人工补充）',
    project_type: 'unknown',
    tech_stack: [],
    package_mode: '未识别',
    layer_package_paths: [],
    directory_structure: [],
    ignore_directories: [
      { path: 'node_modules/', reason: 'npm 依赖' },
      { path: 'dist/', reason: '构建产物' },
      { path: 'ai-knowledge/', reason: '知识库生成产物' },
      { path: '.codegraph/', reason: '代码索引文件' },
    ],
    coding_conventions: [],
    debug_entrypoints: [],
    evidence: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  CONCEPT: {
    concept_name: '{conceptName}',
    summary_zh: '{conceptName}概念（待人工补充）',
    aliases: ['{kebabId}'],
    business_meaning_zh: '自动生成失败，原始输出：{rawOutputSnippet}',
    evidence: [],
    related_concepts: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  CAPABILITY: {
    capability_name: '{capabilityName}',
    summary_zh: '{capabilityName}能力（待人工补充）',
    aliases: ['{kebabId}'],
    business_scenario: '自动生成失败',
    entry_points: [],
    evidence: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  BOUNDARY: {
    boundary_name: '{boundaryName}',
    summary_zh: '{boundaryName}边界配置（待人工补充）',
    aliases: ['{kebabId}'],
    constraints: [],
    config_evidence: ['{configFile}'],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  WORKFLOW: {
    workflow_name: '{workflowName}',
    summary_zh: '{workflowName}流程（待人工补充）',
    aliases: ['{kebabId}'],
    steps: [],
    triggers: [],
    evidence: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  DATA_MODEL: {
    model_name: '{modelName}',
    summary_zh: '{modelName}数据模型（待人工补充）',
    aliases: ['{kebabId}'],
    fields: [],
    evidence: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  EXTERNAL: {
    external_name: '{externalName}',
    summary_zh: '{externalName}外部服务（待人工补充）',
    aliases: ['{kebabId}'],
    service_type: '{serviceType}',
    integration_points: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  CONSTRAINT: {
    constraint_name: '{constraintName}',
    summary_zh: '{constraintName}约束规则（待人工补充）',
    aliases: ['{kebabId}'],
    rule_type: 'unknown',
    evidence: [],
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },

  RELATION: {
    relation_name: '{relationName}',
    summary_zh: '{relationName}关系（待人工补充）',
    aliases: ['{kebabId}'],
    from_entity: '{fromEntity}',
    to_entity: '{toEntity}',
    relation_type: 'unknown',
    warnings: ['llm_json_parse_failed', 'manual_review_required'],
  },
};

/**
 * 上下文字段到模板变量的映射
 */
export const CONTEXT_FIELD_MAPPING: Record<KnowledgeType, Record<string, string>> = {
  ARCHITECTURE: {
    projectName: 'architecture_overview_name',
  },

  CONCEPT: {
    conceptName: 'concept_name',
    kebabId: 'aliases',
    rawOutputSnippet: 'business_meaning_zh',
  },
  CAPABILITY: {
    capabilityName: 'capability_name',
    kebabId: 'aliases',
  },
  BOUNDARY: {
    boundaryName: 'boundary_name',
    kebabId: 'aliases',
    configFile: 'config_evidence',
  },
  WORKFLOW: {
    workflowName: 'workflow_name',
    kebabId: 'aliases',
  },
  DATA_MODEL: {
    modelName: 'model_name',
    kebabId: 'aliases',
  },
  EXTERNAL: {
    externalName: 'external_name',
    kebabId: 'aliases',
    serviceType: 'service_type',
  },
  CONSTRAINT: {
    constraintName: 'constraint_name',
    kebabId: 'aliases',
  },
  RELATION: {
    relationName: 'relation_name',
    kebabId: 'aliases',
    fromEntity: 'from_entity',
    toEntity: 'to_entity',
  },
};

/**
 * 生成降级对象
 *
 * @param type 知识类型
 * @param context 上下文数据（用于填充模板）
 * @param rawOutputSnippet 原始输出摘要（可选）
 */
export function generateFallbackObject(
  type: KnowledgeType,
  context: Record<string, unknown>,
  rawOutputSnippet?: string,
): Record<string, unknown> {
  const template = FALLBACK_TEMPLATES[type] || FALLBACK_TEMPLATES.CONCEPT;

  // 复制模板
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(template));

  // 填充模板变量
  for (const [contextKey, templateVar] of Object.entries(context)) {
    const templateKey = CONTEXT_FIELD_MAPPING[type]?.[contextKey];

    if (templateKey) {
      // 处理特殊字段
      if (templateKey === 'aliases' && typeof templateVar === 'string') {
        result.aliases = [templateVar];
      } else if (typeof result[templateKey] === 'string') {
        // 字符串字段：替换占位符
        const placeholder = `{${contextKey}}`;
        if (typeof templateVar === 'string') {
          result[templateKey] = (result[templateKey] as string).replace(placeholder, templateVar);
        }
      } else if (Array.isArray(result[templateKey]) && typeof templateVar === 'string') {
        // 数组字段：替换占位符元素
        result[templateKey] = result[templateKey].map(item => {
          if (typeof item === 'string' && item === `{${contextKey}}`) {
            return templateVar;
          }
          return item;
        });
      }
    }
  }

  // 全局替换：对所有字符串字段替换所有占位符
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      let strValue = value;
      for (const [contextKey, contextValue] of Object.entries(context)) {
        if (typeof contextValue === 'string') {
          const placeholder = `{${contextKey}}`;
          strValue = strValue.replace(placeholder, contextValue);
        }
      }
      result[key] = strValue;
    }
  }

  // 生成 kebabId（如果没有提供）
  const nameKey = type === 'CONCEPT' ? 'conceptName'
    : type === 'CAPABILITY' ? 'capabilityName'
    : type === 'BOUNDARY' ? 'boundaryName'
    : type === 'WORKFLOW' ? 'workflowName'
    : type === 'DATA_MODEL' ? 'modelName'
    : type === 'EXTERNAL' ? 'externalName'
    : type === 'CONSTRAINT' ? 'constraintName'
    : 'relationName';

  const name = context[nameKey] as string;
  if (name && !context.kebabId) {
    const kebabId = toKebabCase(name);
    if (Array.isArray(result.aliases)) {
      result.aliases = [kebabId];
    }
  }

  // 填充原始输出摘要
  if (rawOutputSnippet && result.business_meaning_zh) {
    const snippet = rawOutputSnippet.slice(0, 100);
    result.business_meaning_zh = `自动生成失败，原始输出：${snippet}`;
  }

  return result;
}

/**
 * 获取知识类型的默认上下文字段名
 */
export function getDefaultContextNameField(type: KnowledgeType): string {
  const mapping: Record<KnowledgeType, string> = {
    ARCHITECTURE: 'projectName',
    CONCEPT: 'conceptName',
    CAPABILITY: 'capabilityName',
    BOUNDARY: 'boundaryName',
    WORKFLOW: 'workflowName',
    DATA_MODEL: 'modelName',
    EXTERNAL: 'externalName',
    CONSTRAINT: 'constraintName',
    RELATION: 'relationName',
  };
  return mapping[type] || 'name';
}