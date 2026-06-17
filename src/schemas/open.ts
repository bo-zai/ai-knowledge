import { z } from "zod";
import { commonObjectSchema } from "./common.js";

/**
 * 边界类型枚举
 *
 * 边界知识记录已有能力的局限性和仓库边界的特殊说明。
 */
export const BoundaryTypeSchema = z.enum(["limitation", "disabled_feature"]);

export type BoundaryType = z.infer<typeof BoundaryTypeSchema>;

/**
 * 边界知识 Schema（扩展版）
 *
 * 设计文档 02 类型 3：记录已有能力的局限性和仓库边界的特殊说明。
 * OPEN 类型映射到 BOUNDARY 类型，聚焦于 Agent 无法从能力目录直接推断的情况。
 */
export const openObjectSchema = commonObjectSchema.extend({
  type: z.literal("OPEN"),

  /** 边界标题：简短描述边界内容 */
  boundary_title: z.string().min(1),

  /** 边界标题中文（兼容旧字段） */
  question: z.string().min(1),

  /** 边界标题中文 */
  question_zh: z.string().min(1),

  /** 边界类型：局限性 / 禁用功能 */
  boundary_type: BoundaryTypeSchema.optional(),

  /** 详细说明：该边界的具体描述 */
  detailed_description_zh: z.string().min(1),

  /** 边界上下文（兼容旧字段） */
  context_zh: z.string().min(1),

  /** 影响级别 */
  impact: z.enum(["high", "medium", "low"]),

  /** 关联能力：该边界影响能力目录中的哪些能力（可选） */
  related_capability: z.string().optional(),

  /** 决策所需时间（兼容旧字段） */
  decision_needed_by: z.string().optional(),

  /** 可选方案（兼容旧字段） */
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
      }),
    )
    .optional(),
});

export type OpenObject = z.infer<typeof openObjectSchema>;
