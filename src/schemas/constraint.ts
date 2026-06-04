import { z } from 'zod';
import { commonKnowledgeSchema } from './knowledge-type.js';

/**
 * 约束知识 Schema
 *
 * 设计文档 02 类型 5：记录由代码、配置、测试明确体现的业务约束和技术约束。
 * 只记录有业务含义的约束，不包含通用参数校验和框架层约束。
 */

/**
 * 约束类型枚举
 */
export const ConstraintTypeSchema = z.enum(['business_rule', 'technical', 'data']);

export type ConstraintType = z.infer<typeof ConstraintTypeSchema>;

/**
 * 约束知识 Schema
 */
export const constraintSchema = commonKnowledgeSchema.extend({
  type: z.literal('CONSTRAINT'),

  /** 约束名称：简短描述约束内容 */
  constraint_name: z.string().min(1),

  /** 约束类型：业务规则 / 技术约束 / 数据约束 */
  constraint_type: ConstraintTypeSchema,

  /** 约束描述：该约束的具体内容和触发条件 */
  constraint_description_zh: z.string().min(1),

  /** 触发条件：什么条件下触发该约束 */
  trigger_condition: z.string().min(1),

  /** 作用范围：该约束影响哪些能力或业务概念 */
  impact_scope: z.array(z.string()).min(1),

  /** 违反后果：违反该约束时会发生什么（可选） */
  violation_consequence: z.string().optional(),
});

export type ConstraintKnowledge = z.infer<typeof constraintSchema>;