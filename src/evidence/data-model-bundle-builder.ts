/**
 * Data Model Aggregate Evidence Bundle Builder
 *
 * 构建 DATA_MODEL（聚合级别）的证据包，从现有 DB 证据中：
 * 1. 识别实体关联关系（通过外键字段）
 * 2. 判断聚合边界（一对多关系中的"一"方作为聚合根）
 * 3. 合并相关实体为一个聚合证据包
 */

import {
  buildAllDbTableBundles,
  type DbTableEvidenceBundle,
  type FieldCandidate,
} from "./db-bundle-builder.js";
import type { EntityRelationType } from "../schemas/data-model.js";

const TECHNICAL_NAMESPACE_MAX_LENGTH = 4;

export interface DataModelAggregateBundle {
  /** 聚合名称（建议的业务名称） */
  suggested_aggregate_name: string;

  /** 聚合根实体名称 */
  aggregate_root: string;

  /** 聚合中的所有实体 */
  entities: AggregateEntityInfo[];

  /** 实体间的关系 */
  entity_relations: EntityRelationInfo[];

  /** 跨聚合引用 */
  cross_references: CrossReferenceInfo[];

  /** 相关 Mapper 文件列表 */
  mapper_files: string[];

  /** 相关 Service 类列表 */
  service_classes: string[];

  /** 来源表证据包列表 */
  table_bundles: DbTableEvidenceBundle[];

  /** 证据来源 */
  provenance: {
    source: string;
    repoPath: string;
    generatedAt: string;
  };
}

export interface AggregateEntityInfo {
  /** 实体名称（表名或 Java 类名） */
  entity_name: string;

  /** 实体中文名称 */
  entity_name_zh: string;

  /** 实体描述 */
  description_zh: string;

  /** 聚合角色 */
  role:
    | "aggregate_root"
    | "sub_entity"
    | "associated_entity"
    | "relation_table";

  /** 所属模块 */
  module?: string;

  /** Java 实体类名（如果有） */
  java_type?: string;

  /** 主要字段列表 */
  key_fields: FieldSummary[];
}

export interface FieldSummary {
  /** 字段名 */
  name: string;

  /** 字段类型 */
  type?: string;

  /** 字段描述 */
  description_zh?: string;

  /** 是否外键 */
  is_foreign_key: boolean;

  /** 外键引用的表（如果是外键） */
  foreign_key_target?: string;
}

export interface EntityRelationInfo {
  /** 源实体 */
  source_entity: string;

  /** 目标实体 */
  target_entity: string;

  /** 关系类型 */
  relation_type: EntityRelationType;

  /** 关联字段 */
  relation_field: string;

  /** 关系描述 */
  description_zh?: string;
}

export interface CrossReferenceInfo {
  /** 引用的聚合名称 */
  aggregate_name: string;

  /** 引用的实体名称 */
  entity_name: string;

  /** 本聚合中的引用字段 */
  reference_field: string;
}

/** 外键字段命名模式 */
const FOREIGN_KEY_PATTERNS = [
  /_id$/, // xxx_id
  /_fk$/, // xxx_fk
  /^fk_/, // fk_xxx
  /Id$/, // Java 风格 xxxId
];

/**
 * 判断字段是否可能是外键
 */
export function isForeignKeyField(fieldName: string): boolean {
  return FOREIGN_KEY_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * 从字段名推断外键引用的目标表
 *
 * 例如：order_id → order, user_id → user
 */
export function inferForeignKeyTarget(fieldName: string): string | null {
  // 移除常见后缀
  const cleaned = fieldName
    .replace(/_id$/, "")
    .replace(/_fk$/, "")
    .replace(/^fk_/, "")
    .replace(/Id$/, "");

  if (cleaned === fieldName) {
    return null; // 没有外键后缀
  }

  // 转换为表名（snake_case）
  return toSnakeCase(cleaned);
}

/**
 * 判断两个实体之间的关系类型
 *
 * 基于：
 * - 外键字段位置（哪方持有外键）
 * - 字段是否为列表类型（List<Type>）
 */
export function inferRelationType(
  sourceEntity: string,
  targetEntity: string,
  relationField: string,
  isListField: boolean,
): EntityRelationType {
  if (isListField) {
    return "one_to_many"; // 一方持有 List<另一方>
  }

  // 外键在源实体中 → 多对一（源实体引用目标实体）
  if (isForeignKeyField(relationField)) {
    return "many_to_one";
  }

  // 默认假设为多对一
  return "many_to_one";
}

/**
 * 识别聚合边界
 *
 * 聚合根判断规则：
 * 1. 被"一对多"引用的"一"方作为聚合根
 * 2. 被"多对一"引用的"一"方作为聚合根
 * 3. 主表（有独立业务意义）优先作为聚合根
 */
export function identifyAggregateRoot(
  entities: string[],
  relations: EntityRelationInfo[],
): string | null {
  // 统计每个实体作为"一"方的关系数量
  const oneSideCounts = new Map<string, number>();

  for (const relation of relations) {
    // one_to_many: source 是"一"方
    // many_to_one: target 是"一"方
    if (relation.relation_type === "one_to_many") {
      oneSideCounts.set(
        relation.source_entity,
        (oneSideCounts.get(relation.source_entity) ?? 0) + 1,
      );
    } else if (relation.relation_type === "many_to_one") {
      oneSideCounts.set(
        relation.target_entity,
        (oneSideCounts.get(relation.target_entity) ?? 0) + 1,
      );
    }
  }

  // 选择作为"一"方次数最多的实体作为聚合根
  let maxCount = 0;
  let aggregateRoot: string | null = null;

  for (const [entity, count] of oneSideCounts) {
    if (count > maxCount) {
      maxCount = count;
      aggregateRoot = entity;
    }
  }

  // 如果没有明确的一对多关系，选择第一个实体作为聚合根
  if (!aggregateRoot && entities.length > 0) {
    aggregateRoot = entities[0];
  }

  return aggregateRoot;
}

/**
 * 从字段列表中提取外键关系
 */
export function extractForeignKeyRelations(
  fields: FieldSummary[],
): Array<{ field: string; target_table: string }> {
  const relations: Array<{ field: string; target_table: string }> = [];

  for (const field of fields) {
    if (field.is_foreign_key && field.foreign_key_target) {
      relations.push({
        field: field.name,
        target_table: field.foreign_key_target,
      });
    }
  }

  return relations;
}

/**
 * 构建聚合实体信息
 */
function buildAggregateEntityInfo(
  tableBundle: DbTableEvidenceBundle,
  role:
    | "aggregate_root"
    | "sub_entity"
    | "associated_entity"
    | "relation_table",
): AggregateEntityInfo {
  // 提取关键字段
  const keyFields: FieldSummary[] = tableBundle.fieldCandidates
    .slice(0, 15) // 最多 15 个字段
    .map((field) => {
      const isFk = isForeignKeyField(field.name);
      const fkTarget = isFk ? inferForeignKeyTarget(field.name) : undefined;

      return {
        name: field.name,
        type: field.javaType ?? field.type,
        description_zh:
          field.javaFieldComment || field.mappedJavaProperty || field.name,
        is_foreign_key: isFk,
        foreign_key_target: fkTarget ?? undefined,
      };
    });

  // 获取 Java 实体类名
  const javaTypes = tableBundle.entityEvidence
    .map((e) => e.javaType)
    .filter((t) => t && t.length > 0);
  const primaryJavaType = javaTypes.length > 0 ? javaTypes[0] : undefined;

  // 获取描述
  const descriptions = tableBundle.entityEvidence
    .map((e) => e.classComment)
    .filter((c) => c && c.trim().length > 0);
  const description =
    descriptions.length > 0 ? descriptions[0]! : `${tableBundle.table}表`;

  return {
    entity_name: tableBundle.table,
    entity_name_zh: description,
    description_zh: description,
    role,
    java_type: primaryJavaType,
    key_fields: keyFields,
  };
}

/**
 * 构建聚合级别的证据包
 *
 * 从多个表的证据包中识别聚合边界，合并为一个聚合证据包。
 */
export async function buildAggregateBundle(
  repoPath: string,
  coreTables: string[], // 作为聚合根候选的核心表
  companionRepoPath?: string,
): Promise<DataModelAggregateBundle> {
  // 1. 构建所有表的证据包
  const allTableBundles = await buildAllDbTableBundles(
    repoPath,
    companionRepoPath,
  );

  // 2. 筛选相关表（核心表 + 外键关联的表）
  const relatedTables = new Set<string>(coreTables);

  // 从核心表的外键字段中找到关联表
  for (const coreTable of coreTables) {
    const bundle = allTableBundles.find((b) => b.table === coreTable);
    if (bundle) {
      for (const field of bundle.fieldCandidates) {
        if (isForeignKeyField(field.name)) {
          const targetTable = inferForeignKeyTarget(field.name);
          if (targetTable) {
            relatedTables.add(targetTable);
          }
        }
      }
    }
  }

  // 3. 获取相关表的证据包
  const tableBundles = allTableBundles.filter((b) =>
    relatedTables.has(b.table),
  );

  // 4. 构建实体信息
  const entities: AggregateEntityInfo[] = tableBundles.map((bundle) => {
    // 判断角色：核心表为聚合根候选，其他为子实体或关联实体
    const isCore = coreTables.includes(bundle.table);
    const role = isCore ? "aggregate_root" : "associated_entity";
    return buildAggregateEntityInfo(bundle, role);
  });

  // 5. 构建实体关系
  const entityRelations: EntityRelationInfo[] = [];

  for (const bundle of tableBundles) {
    for (const field of bundle.fieldCandidates) {
      if (isForeignKeyField(field.name)) {
        const targetTable = inferForeignKeyTarget(field.name);
        if (targetTable && relatedTables.has(targetTable)) {
          entityRelations.push({
            source_entity: bundle.table,
            target_entity: targetTable,
            relation_type: "many_to_one",
            relation_field: field.name,
            description_zh: `${bundle.table} 通过 ${field.name} 关联 ${targetTable}`,
          });
        }
      }
    }
  }

  // 6. 识别聚合根
  const aggregateRoot = identifyAggregateRoot(
    entities.map((e) => e.entity_name),
    entityRelations,
  );

  // 更新实体角色
  if (aggregateRoot) {
    for (const entity of entities) {
      if (entity.entity_name === aggregateRoot) {
        entity.role = "aggregate_root";
      } else {
        // 判断是子实体还是关联实体
        const hasRelationToRoot = entityRelations.some(
          (r) =>
            r.target_entity === aggregateRoot &&
            r.source_entity === entity.entity_name,
        );
        entity.role = hasRelationToRoot ? "sub_entity" : "associated_entity";
      }
    }
  }

  // 7. 构建跨聚合引用（引用不在聚合内的表）
  const crossReferences: CrossReferenceInfo[] = [];

  for (const bundle of tableBundles) {
    for (const field of bundle.fieldCandidates) {
      if (isForeignKeyField(field.name)) {
        const targetTable = inferForeignKeyTarget(field.name);
        if (targetTable && !relatedTables.has(targetTable)) {
          crossReferences.push({
            aggregate_name: targetTable, // 用表名作为聚合名的占位符
            entity_name: targetTable,
            reference_field: field.name,
          });
        }
      }
    }
  }

  // 8. 收集 Mapper 文件和 Service 类
  const mapperFiles = new Set<string>();
  const serviceClasses = new Set<string>();

  for (const bundle of tableBundles) {
    for (const binding of bundle.mapperBindings) {
      mapperFiles.add(binding.mapperFile);
    }
    for (const caller of bundle.callerEvidence) {
      serviceClasses.add(caller.callerClass);
    }
  }

  // 9. 生成聚合名称建议
  const suggestedName = aggregateRoot
    ? inferAggregateName(aggregateRoot, entities)
    : "unknown_aggregate";

  return {
    suggested_aggregate_name: suggestedName,
    aggregate_root: aggregateRoot ?? coreTables[0] ?? "unknown",
    entities,
    entity_relations: entityRelations,
    cross_references: crossReferences,
    mapper_files: [...mapperFiles],
    service_classes: [...serviceClasses],
    table_bundles: tableBundles,
    provenance: {
      source: "aggregate-analysis",
      repoPath,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 从聚合根推断聚合名称
 */
function inferAggregateName(
  aggregateRoot: string,
  entities: AggregateEntityInfo[],
): string {
  const rootEntity = entities.find((e) => e.entity_name === aggregateRoot);
  if (rootEntity && rootEntity.entity_name_zh) {
    if (rootEntity.entity_name_zh.includes("聚合")) {
      return rootEntity.entity_name_zh;
    }
    return `${rootEntity.entity_name_zh}聚合`;
  }

  const tableName = stripTechnicalNamespacePrefix(aggregateRoot);
  return `${tableName}聚合`;
}

function stripTechnicalNamespacePrefix(identifier: string): string {
  const parts = identifier.split("_").filter(Boolean);
  if (parts.length < 2) return identifier;
  const [firstPart, ...restParts] = parts;
  if (!firstPart || firstPart.length > TECHNICAL_NAMESPACE_MAX_LENGTH) {
    return identifier;
  }
  return restParts.join("_");
}

/**
 * 构建所有聚合的证据包
 *
 * 遍历仓库中的所有表，识别聚合边界。
 */
export async function buildAllAggregateBundles(
  repoPath: string,
  companionRepoPath?: string,
): Promise<DataModelAggregateBundle[]> {
  // 1. 构建所有表的证据包
  const allTableBundles = await buildAllDbTableBundles(
    repoPath,
    companionRepoPath,
  );

  // 2. 识别所有表的外键关系
  const allRelations: EntityRelationInfo[] = [];

  for (const bundle of allTableBundles) {
    for (const field of bundle.fieldCandidates) {
      if (isForeignKeyField(field.name)) {
        const targetTable = inferForeignKeyTarget(field.name);
        if (targetTable) {
          allRelations.push({
            source_entity: bundle.table,
            target_entity: targetTable,
            relation_type: "many_to_one",
            relation_field: field.name,
          });
        }
      }
    }
  }

  // 3. 识别潜在聚合根（作为"一"方次数最多的表）
  const oneSideCounts = new Map<string, number>();

  for (const relation of allRelations) {
    oneSideCounts.set(
      relation.target_entity,
      (oneSideCounts.get(relation.target_entity) ?? 0) + 1,
    );
  }

  // 4. 选择作为"一"方次数 >= 1 的表作为聚合根候选
  const potentialAggregateRoots = [...oneSideCounts.entries()]
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([table]) => table);

  // 5. 为每个聚合根构建聚合
  const aggregates: DataModelAggregateBundle[] = [];
  const processedTables = new Set<string>();

  for (const rootCandidate of potentialAggregateRoots) {
    if (processedTables.has(rootCandidate)) {
      continue;
    }

    // 收集聚合根关联的所有表（被聚合根引用，或引用聚合根）
    const relatedTables = new Set<string>([rootCandidate]);

    for (const relation of allRelations) {
      if (relation.target_entity === rootCandidate) {
        relatedTables.add(relation.source_entity);
      }
    }

    // 检查是否所有表都已处理
    const allProcessed = [...relatedTables].every((t) =>
      processedTables.has(t),
    );
    if (allProcessed) {
      continue;
    }

    // 构建聚合
    const aggregate = await buildAggregateBundle(
      repoPath,
      [rootCandidate],
      companionRepoPath,
    );

    aggregates.push(aggregate);

    // 标记为已处理
    for (const table of relatedTables) {
      processedTables.add(table);
    }
  }

  // 6. 处理剩余未归入任何聚合的表（单独作为聚合）
  for (const bundle of allTableBundles) {
    if (!processedTables.has(bundle.table)) {
      const standaloneAggregate = await buildAggregateBundle(
        repoPath,
        [bundle.table],
        companionRepoPath,
      );
      aggregates.push(standaloneAggregate);
      processedTables.add(bundle.table);
    }
  }

  return aggregates;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}
