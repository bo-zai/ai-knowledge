import { z } from 'zod';
import { commonObjectSchema } from './common.js';

/**
 * 跨域业务流程步骤 Schema
 *
 * 记录流程中每个步骤的操作、所在域和关键约束。
 */
export const flowStepSchema = z.object({
  /** 步骤序号 */
  order: z.number().int().min(1),

  /** 所属能力域 */
  domain: z.string().min(1),

  /** 操作名称 */
  action: z.string().min(1),

  /** 操作中文名 */
  action_zh: z.string().min(1),

  /** 执行者 */
  actor: z.string().min(1),

  /** 步骤描述 */
  description: z.string().optional(),

  /** 输入 */
  inputs: z.array(z.string()).optional().default([]),

  /** 输出 */
  outputs: z.array(z.string()).optional().default([]),

  /** 分支 */
  branches: z.array(z.string()).optional(),
});

export type FlowStep = z.infer<typeof flowStepSchema>;

/**
 * 跨域业务流程 Schema（扩展版）
 *
 * 设计文档 02 类型 8：记录跨越多个能力域的端到端业务路径。
 * 扩展字段支持涉及域、业务目标、完成标志、关键分支等业务视角信息。
 */
export const flowObjectSchema = commonObjectSchema.extend({
  type: z.literal('FLOW'),

  /** 流程名称 */
  flow_name: z.string().min(1),

  /** 流程中文名 */
  flow_name_zh: z.string().min(1),

  /** 业务目标：该流程要达成的业务目标 */
  business_goal: z.string().min(1),

  /** 涉及域：流程经过的能力域列表（有序，至少 2 个） */
  involved_domains: z.array(z.string()).min(2),

  /** 流程步骤 */
  steps: z.array(flowStepSchema).min(1),

  /** 触发条件：流程的触发入口 */
  trigger: z.string().min(1),

  /** 触发条件中文 */
  trigger_zh: z.string().min(1),

  /** 完成标志：流程正常结束的标志 */
  completion_flag: z.string().min(1),

  /** 关键分支：流程中的主要分支点或异常处理路径（可选） */
  key_branches: z.array(z.string()).optional(),

  /** 流程结果 */
  outcomes: z.array(z.string()).optional().default([]),

  /** 错误处理 */
  error_handling: z.array(z.string()).optional(),
});

export type FlowObject = z.infer<typeof flowObjectSchema>;