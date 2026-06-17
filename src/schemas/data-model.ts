import { z } from "zod";
import { commonObjectSchema } from "./common.js";

/**
 * 实体角色类型
 *
 * 定义实体在聚合中的角色。
 */
export const entityRoleSchema = z.enum([
  "aggregate_root",
  "sub_entity",
  "associated_entity",
  "relation_table",
]);

export type EntityRole = z.infer<typeof entityRoleSchema>;

/**
 * 聚合中的实体定义
 *
 * 记录聚合中每个实体的基本信息和角色。
 */
export const aggregateEntitySchema = z.object({
  /** 实体名称（代码类名） */
  entity_name: z.string().min(1),

  /** 实体中文名称（业务化描述） */
  entity_name_zh: z.string().min(1),

  /** 实体描述：该实体的业务职责 */
  description_zh: z.string().min(1),

  /** 聚合角色：聚合根、子实体、关联实体、关联表 */
  role: entityRoleSchema,

  /** 所属模块（多模块项目时使用） */
  module: z.string().optional(),

  /** 父类名称（继承关系） */
  extends: z.string().optional(),

  /** 实现的接口列表 */
  implements: z.array(z.string()).optional(),
});

export type AggregateEntity = z.infer<typeof aggregateEntitySchema>;

/**
 * 实体关系类型
 */
export const entityRelationTypeSchema = z.enum([
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
  "composition",
  "aggregation",
  "extends",
  "implements",
]);

export type EntityRelationType = z.infer<typeof entityRelationTypeSchema>;

/**
 * 实体关系定义
 *
 * 记录聚合内实体之间的关联关系。
 */
export const entityRelationSchema = z.object({
  /** 源实体名称 */
  source_entity: z.string().min(1),

  /** 目标实体名称 */
  target_entity: z.string().min(1),

  /** 关系类型 */
  relation_type: entityRelationTypeSchema,

  /** 关联字段：哪个字段实现关联（继承关系时可为空） */
  relation_field: z.string().nullable(),

  /** 关系描述（可选） */
  description_zh: z.string().optional(),
});

export type EntityRelation = z.infer<typeof entityRelationSchema>;

/**
 * 跨聚合引用
 *
 * 记录本聚合引用其他聚合中的实体。
 */
export const crossAggregateReferenceSchema = z.object({
  /** 引用的聚合名称 */
  aggregate_name: z.string().min(1),

  /** 引用的实体名称 */
  entity_name: z.string().min(1),

  /** 本聚合中的引用字段 */
  reference_field: z.string().min(1),
});

export type CrossAggregateReference = z.infer<
  typeof crossAggregateReferenceSchema
>;

/**
 * DATA_MODEL 知识 Schema（聚合级别）
 *
 * 设计文档 02 类型 7：记录仓库内核心业务实体之间的关联关系。
 * 一个聚合对应一个知识条目，包含多个实体及其关系。
 */
export const dataModelObjectSchema = commonObjectSchema.extend({
  type: z.literal("DATA_MODEL"),

  /** 聚合名称（业务化） */
  aggregate_name: z.string().min(1),

  /** 聚合中文名称 */
  aggregate_name_zh: z.string().min(1),

  /** 聚合描述：该聚合覆盖的业务场景 */
  aggregate_description_zh: z.string().min(1),

  /** 适用范围：该聚合适用的业务场景和不适用场景 */
  scope_zh: z.string().min(1),

  /** 核心实体：聚合中的所有实体及其角色 */
  entities: z.array(aggregateEntitySchema).min(1),

  /** 实体关系：聚合内实体之间的关联关系 */
  entity_relations: z.array(entityRelationSchema).min(1),

  /** 跨聚合引用：引用其他聚合中的实体（可选） */
  cross_references: z
    .array(crossAggregateReferenceSchema)
    .optional()
    .default([]),

  /** 所属模块（多模块项目时使用） */
  module: z.string().optional(),
});

export type DataModelObject = z.infer<typeof dataModelObjectSchema>;
