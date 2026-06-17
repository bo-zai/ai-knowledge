/**
 * DATA_MODEL (聚合级别) Generator
 *
 * 构建聚合级别知识生成的 prompt，包含：
 * - 聚合名称和描述
 * - 核心实体列表及其角色
 * - 实体关系描述
 * - 跨聚合引用
 */

import type { DbTableEvidenceBundle } from "../../evidence/db-bundle-builder.js";
import type {
  DataModelAggregateBundle,
  AggregateEntityInfo,
  EntityRelationInfo,
} from "../../evidence/data-model-bundle-builder.js";

interface DataModelPromptInput {
  /** 聚合证据包 */
  aggregate_bundle?: DataModelAggregateBundle;
  /** 仓库名称 */
  repoName?: string;
  /** 已生成的概念名称列表（用于引用） */
  concept_names?: string[];
}

const MAX_ENTITY_COUNT = 10;
const MAX_RELATION_COUNT = 15;
const MAX_FIELD_COUNT = 12;
const MAX_CROSS_REFERENCE_COUNT = 5;

/**
 * Build DATA_MODEL generation prompt.
 */
export function buildDataModelPrompt(input: DataModelPromptInput): {
  system: string;
  user: string;
} {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent entities, relations, or aggregates. All output must be Chinese except code identifiers.

CRITICAL RULES:
- aggregate_name_zh MUST be business-oriented, not table name directly (e.g., "订单聚合" not "oms_order聚合")
- Use evidence.entity_name_zh and evidence.description_zh for entity descriptions
- entity.role MUST match evidence.role (aggregate_root, sub_entity, associated_entity)
- entity_relations MUST use evidence.entity_relations structure
- cross_references only include entities NOT in current aggregate
- Do NOT infer business meaning without evidence support
- Prefer concise descriptions (one sentence per entity/relation)
- Module field should match the deployable module name (e.g., mall-admin, mall-portal), not shared modules like mall-mbg

ENTITY ROLE MEANINGS:
- aggregate_root: Primary entity, the root of the aggregate
- sub_entity: Entity that belongs to the aggregate root (has direct foreign key to root)
- associated_entity: Entity referenced by the aggregate but not owned by it
- relation_table: Many-to-many relation table (has foreign keys to both sides)

RELATION TYPE MEANINGS:
- one_to_one: Single entity references single entity
- one_to_many: One entity has multiple related entities (List<OtherEntity>)
- many_to_one: Multiple entities reference single entity (foreign key field)
- many_to_many: Both sides can have multiple related entities`;

  const evidence = buildEvidenceFromBundle(input.aggregate_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: "DATA_MODEL", generation_mode: "bootstrap" },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
      },
      output_schema: {
        id: "string (DATA_MODEL-{aggregate_name})",
        type: "DATA_MODEL",
        aggregate_name: 'string (business-oriented name, e.g., "订单聚合")',
        aggregate_name_zh: 'string (Chinese name, e.g., "订单聚合")',
        aggregate_description_zh:
          "string (what business scenario this aggregate covers)",
        scope_zh:
          "string (when this aggregate applies, when it does NOT apply)",
        entities: [
          {
            entity_name: "string (table name or Java class name)",
            entity_name_zh: "string (Chinese description)",
            description_zh: "string (entity role in the aggregate)",
            role: "aggregate_root | sub_entity | associated_entity | relation_table",
            module:
              "string (optional - deployable module name like mall-admin)",
          },
        ],
        entity_relations: [
          {
            source_entity: "string",
            target_entity: "string",
            relation_type:
              "one_to_one | one_to_many | many_to_one | many_to_many",
            relation_field: "string (which field implements the relation)",
            description_zh: "string (optional - relation explanation)",
          },
        ],
        cross_references: [
          {
            aggregate_name: "string (referenced aggregate name)",
            entity_name: "string (referenced entity name)",
            reference_field: "string (field in current aggregate)",
          },
        ],
        module:
          "string (optional - which deployable module owns this aggregate)",
      },
    },
    null,
    2,
  );

  return { system, user };
}

/**
 * Build structured evidence from DataModelAggregateBundle.
 */
function buildEvidenceFromBundle(
  bundle: DataModelAggregateBundle | undefined,
): Record<string, unknown> {
  if (!bundle) {
    return { aggregate_bundle: null };
  }

  return {
    aggregate_bundle: {
      suggested_aggregate_name: bundle.suggested_aggregate_name,
      aggregate_root: bundle.aggregate_root,
      entities: buildEntityEvidence(bundle.entities.slice(0, MAX_ENTITY_COUNT)),
      entity_relations: buildRelationEvidence(
        bundle.entity_relations.slice(0, MAX_RELATION_COUNT),
      ),
      cross_references: bundle.cross_references.slice(
        0,
        MAX_CROSS_REFERENCE_COUNT,
      ),
      mapper_files: bundle.mapper_files.slice(0, 10),
      service_classes: bundle.service_classes.slice(0, 10),
      key_evidence: buildKeyEvidence(bundle.table_bundles),
    },
  };
}

function buildEntityEvidence(
  entities: AggregateEntityInfo[],
): Array<Record<string, unknown>> {
  return entities.map((entity) => ({
    entity_name: entity.entity_name,
    entity_name_zh: entity.entity_name_zh,
    description_zh: entity.description_zh,
    role: entity.role,
    module: entity.module,
    java_type: entity.java_type,
    key_fields: entity.key_fields.slice(0, MAX_FIELD_COUNT).map((field) => ({
      name: field.name,
      type: field.type,
      description_zh: field.description_zh,
      is_foreign_key: field.is_foreign_key,
      foreign_key_target: field.foreign_key_target,
    })),
  }));
}

function buildRelationEvidence(
  relations: EntityRelationInfo[],
): Array<Record<string, unknown>> {
  return relations.map((relation) => ({
    source_entity: relation.source_entity,
    target_entity: relation.target_entity,
    relation_type: relation.relation_type,
    relation_field: relation.relation_field,
    description_zh: relation.description_zh,
  }));
}

/**
 * Build key evidence snippets for aggregate context.
 *
 * 提取关键证据信息，帮助 LLM 理解聚合的业务含义。
 */
function buildKeyEvidence(
  tableBundles: DbTableEvidenceBundle[],
): Array<Record<string, unknown>> {
  const keyEvidence: Array<Record<string, unknown>> = [];

  for (const bundle of tableBundles.slice(0, 5)) {
    // 提取 Java 实体类的注释作为业务含义证据
    const entityComments = bundle.entityEvidence
      .filter((e) => e.classComment && e.classComment.trim().length > 0)
      .map((e) => ({
        java_type: e.javaType,
        class_comment: e.classComment,
      }));

    // 提取 Service 类的业务上下文
    const serviceContext = bundle.callerEvidence
      .filter((c) => c.businessHints.length > 0 || c.nearbyComments.length > 0)
      .slice(0, 3)
      .map((c) => ({
        service_class: c.callerClass,
        service_method: c.callerMethod,
        business_hints: c.businessHints.slice(0, 3),
        nearby_comments: c.nearbyComments.slice(0, 2),
      }));

    if (entityComments.length > 0 || serviceContext.length > 0) {
      keyEvidence.push({
        table: bundle.table,
        entity_comments: entityComments,
        service_context: serviceContext,
      });
    }
  }

  return keyEvidence;
}
