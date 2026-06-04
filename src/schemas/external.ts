import { z } from 'zod';
import { commonKnowledgeSchema } from './knowledge-type.js';

/**
 * 外部系统交互知识 Schema
 *
 * 设计文档 02 类型 4：记录当前仓库与外部系统之间的可见交互。
 * 不描述外部系统内部行为，只记录从代码中可见的交互。
 */

/**
 * 交互方式枚举
 */
export const InteractionMethodSchema = z.enum(['sdk', 'http_api', 'callback', 'data_exchange', 'rpc']);

export type InteractionMethod = z.infer<typeof InteractionMethodSchema>;

/**
 * 当前仓库角色枚举
 */
export const RepositoryRoleSchema = z.enum(['caller', 'callee', 'data_producer', 'data_consumer']);

export type RepositoryRole = z.infer<typeof RepositoryRoleSchema>;

/**
 * 外部系统交互知识 Schema
 */
export const externalSchema = commonKnowledgeSchema.extend({
  type: z.literal('EXTERNAL'),

  /** 外部系统名称 */
  external_system_name: z.string().min(1),

  /** 交互目的：当前仓库与该外部系统交互的业务目的 */
  interaction_purpose_zh: z.string().min(1),

  /** 交互方式：通过什么方式交互 */
  interaction_method: InteractionMethodSchema,

  /** 当前仓库角色：调用方、被调用方、数据生产方、数据消费方 */
  repository_role: RepositoryRoleSchema,

  /** 交互入口：发起交互或接收交互的代码位置（可选） */
  interaction_entry: z.string().optional(),

  /** 可见交互范围：从代码中可以确认的交互操作列表 */
  visible_interaction_scope: z.array(z.string()).min(1),
});

export type ExternalKnowledge = z.infer<typeof externalSchema>;