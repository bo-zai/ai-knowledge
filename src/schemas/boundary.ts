import { z } from "zod";
import { commonKnowledgeSchema } from "./knowledge-type.js";

/**
 * 边界知识 Schema
 *
 * 设计文档 02 类型 3：记录已有能力的局限性和仓库边界的特殊说明。
 * 聚焦于 Agent 无法从能力目录直接推断的两类情况：局限性、禁用功能。
 */

/**
 * 边界类型枚举
 */
export const BoundaryTypeSchema = z.enum(["limitation", "disabled_feature"]);

export type BoundaryType = z.infer<typeof BoundaryTypeSchema>;

/**
 * 边界知识 Schema
 */
export const boundarySchema = commonKnowledgeSchema.extend({
  type: z.literal("BOUNDARY"),

  /** 边界标题：简短描述边界内容 */
  boundary_title: z.string().min(1),

  /** 边界类型：局限性 / 禁用功能 */
  boundary_type: BoundaryTypeSchema,

  /** 详细说明：该边界的具体描述 */
  detailed_description_zh: z.string().min(1),

  /** 关联能力：该边界影响能力目录中的哪些能力（可选） */
  related_capability: z.string().optional(),
});

export type BoundaryKnowledge = z.infer<typeof boundarySchema>;
