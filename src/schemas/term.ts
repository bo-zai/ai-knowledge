import { z } from 'zod';
import { commonObjectSchema } from './common.js';

/**
 * 概念知识值说明 Schema
 *
 * 用于枚举/状态类概念的值解释。
 */
export const valueExplanationSchema = z.object({
  /** 枚举值或状态值 */
  value: z.string().min(1),
  /** 业务含义解释 */
  business_meaning_zh: z.string().min(1),
});

export type ValueExplanation = z.infer<typeof valueExplanationSchema>;

/**
 * 代码体现 Schema
 *
 * 记录概念在代码中的具体表现。
 */
export const codeManifestationSchema = z.object({
  /** 体现类型：enum, class, field, constant */
  kind: z.enum(['enum', 'class', 'field', 'constant']),
  /** 代码元素名称 */
  name: z.string().min(1),
  /** 代码位置 */
  location: z.string().min(1),
});

export type CodeManifestation = z.infer<typeof codeManifestationSchema>;

/**
 * 概念知识 Schema（扩展版）
 *
 * 设计文档 02 类型 2：记录仓库中可见的业务概念的定义和业务含义。
 * 扩展字段支持枚举值说明、别名、关键区分等业务视角信息。
 */
export const termObjectSchema = commonObjectSchema.extend({
  type: z.literal('TERM'),

  /** 术语名称（业务化） */
  term: z.string().min(1),

  /** 中文名称 */
  term_zh: z.string().min(1),

  /** 业务含义：该概念在业务上的定义和解释 */
  definition_zh: z.string().min(1),

  /** 别名：该概念在需求文档或代码中的其他叫法（可选） */
  aliases: z.array(z.string()).optional().default([]),

  /** 值说明：适用于枚举/状态类概念（可选） */
  value_explanation: z.array(valueExplanationSchema).optional(),

  /** 代码体现：该概念在代码中的具体表现 */
  code_manifestation: z.array(codeManifestationSchema).optional().default([]),

  /** 关键区分：与名称相近但含义不同的概念的区分说明（可选） */
  key_differentiation: z.string().optional(),

  /** 相关术语 */
  related_terms: z.array(z.string()).optional().default([]),

  /** 使用场景 */
  used_in: z.array(z.string()).optional().default([]),
});

export type TermObject = z.infer<typeof termObjectSchema>;