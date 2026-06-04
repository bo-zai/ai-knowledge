import { z } from 'zod';
import { commonKnowledgeSchema } from './knowledge-type.js';

/**
 * 能力关系知识 Schema
 *
 * 设计文档 02 类型 6：记录仓库内可见业务能力之间的组合、依赖、上下游或共享概念关系。
 * 只记录业务 Service 层之间的关系。
 */

/**
 * 关系类型枚举
 */
export const RelationTypeSchema = z.enum([
  'call_dependency',    // 调用依赖：能力 A 直接调用能力 B
  'trigger_chain',      // 触发链：能力 A 执行后同步触发能力 B
  'async_trigger',      // 异步触发：能力 A 通过事件机制异步触发能力 B
  'shared_entity',      // 共享实体：能力 A 和能力 B 操作同一个业务实体
  'composition',        // 组合：能力 A 组合了能力 B、C、D
]);

export type RelationType = z.infer<typeof RelationTypeSchema>;

/**
 * 能力关系知识 Schema
 */
export const relationSchema = commonKnowledgeSchema.extend({
  type: z.literal('RELATION'),

  /** 关系名称：简短描述该关系 */
  relation_name: z.string().min(1),

  /** 关系类型 */
  relation_type: RelationTypeSchema,

  /** 参与能力：关系涉及的能力名称列表 */
  participating_capabilities: z.array(z.string()).min(2),

  /** 关系描述：该关系的具体说明 */
  relation_description_zh: z.string().min(1),
});

export type RelationKnowledge = z.infer<typeof relationSchema>;