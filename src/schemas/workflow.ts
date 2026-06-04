import { z } from 'zod';
import { commonKnowledgeSchema } from './knowledge-type.js';

/**
 * 跨域业务流程知识 Schema
 *
 * 设计文档 02 类型 8：记录跨越多个能力域的端到端业务路径。
 * 只记录涉及至少 2 个能力域的流程，提供全链路视角。
 */

/**
 * 流程步骤 Schema
 */
export const workflowStepSchema = z.object({
  /** 步骤序号 */
  order: z.number().int().min(1),

  /** 所属能力域 */
  domain: z.string().min(1),

  /** 操作名称 */
  action: z.string().min(1),

  /** 步骤描述 */
  description: z.string().min(1),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

/**
 * 跨域业务流程知识 Schema
 */
export const workflowSchema = commonKnowledgeSchema.extend({
  type: z.literal('WORKFLOW'),

  /** 流程名称：业务化的流程名称 */
  workflow_name: z.string().min(1),

  /** 业务目标：该流程要达成的业务目标 */
  business_goal: z.string().min(1),

  /** 涉及域：流程经过的能力域列表（有序） */
  involved_domains: z.array(z.string()).min(2),

  /** 流程步骤 */
  steps: z.array(workflowStepSchema).min(1),

  /** 触发条件：流程的触发入口 */
  trigger_condition: z.string().min(1),

  /** 完成标志：流程正常结束的标志 */
  completion_flag: z.string().min(1),

  /** 关键分支：流程中的主要分支点或异常处理路径（可选） */
  key_branches: z.array(z.string()).optional(),
});

export type WorkflowKnowledge = z.infer<typeof workflowSchema>;