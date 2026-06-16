/**
 * 表关联补充器
 *
 * 通过外键和 JOIN 语句发现遗漏的表，补充表之间的关联关系。
 *
 * 功能：
 * - 分析 Mapper XML 中的 JOIN 语句发现表关联
 * - 从 SQL 外键约束提取关联表
 * - 计算表关联密度并更新置信度加成
 */

import type { TableAnchor, RelatedTableInfo, TableInfo, MapperInfo, DiscoveryPathResult } from './types.js';

/**
 * 表关联补充器配置
 */
export interface TableRelationSupplementConfig {
  /** 关联密度阈值（低于此值不加成） */
  densityThreshold?: number;
  /** 最大关联加成值 */
  maxBonus?: number;
}

/**
 * 表关联补充器实现
 */
export class TableRelationSupplementImpl {
  private readonly config: Required<TableRelationSupplementConfig>;

  constructor(config?: TableRelationSupplementConfig) {
    this.config = {
      densityThreshold: config?.densityThreshold ?? 0.3,
      maxBonus: config?.maxBonus ?? 0.1,
    };
  }

  /**
   * 补充表关联信息
   *
   * @param tableAnchors - 表锚点列表
   * @param pathResults - 发现路径结果（可选，用于分析 JOIN）
   * @returns 补充后的表锚点列表
   */
  async supplement(
    tableAnchors: TableAnchor[],
    pathResults?: DiscoveryPathResult[],
  ): Promise<TableAnchor[]> {
    // 1. 构建表名到锚点的映射
    const anchorMap = new Map<string, TableAnchor>();
    for (const anchor of tableAnchors) {
      anchorMap.set(anchor.tableName, anchor);
    }

    // 2. 从 pathResults 中提取 Mapper 信息分析 JOIN
    const mapperJoinRelations = this.extractJoinRelationsFromPaths(pathResults ?? []);

    // 3. 从 traceSources 中提取 Mapper XML 中的关联
    const traceSourceRelations = this.extractRelationsFromTraceSources(tableAnchors);

    // 4. 合并关联关系
    const allRelations = this.mergeRelations(mapperJoinRelations, traceSourceRelations);

    // 5. 更新每个锚点的关联信息
    const supplementedAnchors: TableAnchor[] = [];
    for (const anchor of tableAnchors) {
      const relations = allRelations.get(anchor.tableName) ?? [];

      // 计算关联密度加成
      const relationBonus = this.calculateRelationBonus(relations, anchorMap);

      supplementedAnchors.push({
        ...anchor,
        relatedTables: relations,
        tableRelationBonus: relationBonus,
      });
    }

    return supplementedAnchors;
  }

  /**
   * 从 DiscoveryPathResult 中提取 JOIN 关联关系
   */
  private extractJoinRelationsFromPaths(pathResults: DiscoveryPathResult[]): Map<string, RelatedTableInfo[]> {
    const relations = new Map<string, RelatedTableInfo[]>();

    for (const result of pathResults) {
      for (const path of result.tracePaths) {
        // 从 Mapper 的 SQL 中提取 JOIN 关联
        for (const mapper of path.mappers) {
          if (mapper.xmlPath) {
            const joinRelations = this.parseJoinRelationsFromMapperXml(mapper);
            for (const [table, related] of joinRelations) {
              const existing = relations.get(table) ?? [];
              relations.set(table, [...existing, ...related]);
            }
          }
        }
      }
    }

    return relations;
  }

  /**
   * 从 Mapper XML 文件中解析 JOIN 关联（Stub 实现）
   *
   * 实际实现需要读取 XML 文件并解析 SQL 语句。
   * 这里使用简化实现，基于已知的 SQL 模式。
   */
  private parseJoinRelationsFromMapperXml(mapper: MapperInfo): Map<string, RelatedTableInfo[]> {
    const relations = new Map<string, RelatedTableInfo[]>();

    // Stub: 由于没有实际读取 XML 文件，这里返回空 Map
    // 实际实现时，应：
    // 1. 读取 mapper.xmlPath 文件内容
    // 2. 解析 SQL 语句中的 JOIN 子句
    // 3. 提取关联表名和关联字段
    //
    // 示例 SQL 解析:
    // SELECT a.*, b.name FROM table_a a JOIN table_b b ON a.id = b.a_id
    // -> table_a 关联 table_b, sourceField: id, targetField: a_id

    return relations;
  }

  /**
   * 从 traceSources 中提取关联关系
   *
   * 分析每个 traceSource 的 Mapper 和 Entity 信息，
   * 推断表之间的关联关系。
   */
  private extractRelationsFromTraceSources(tableAnchors: TableAnchor[]): Map<string, RelatedTableInfo[]> {
    const relations = new Map<string, RelatedTableInfo[]>();

    for (const anchor of tableAnchors) {
      const tableName = anchor.tableName;
      const anchorRelations: RelatedTableInfo[] = [];

      for (const source of anchor.traceSources) {
        // 从 Entity 类名推断可能的关联表
        // 例如：OrderItem -> order_item 表可能关联 order 表
        const inferredRelations = this.inferRelationsFromEntityName(
          source.entityClassName,
          tableName,
          anchor.columns,
        );

        anchorRelations.push(...inferredRelations);
      }

      if (anchorRelations.length > 0) {
        relations.set(tableName, anchorRelations);
      }
    }

    return relations;
  }

  /**
   * 从 Entity 类名推断关联关系
   *
   * 基于命名模式推断可能的关联表：
   * - OrderItem -> 推断关联 order 表
   * - UserAddress -> 推断关联 user 表
   */
  private inferRelationsFromEntityName(
    entityClassName: string,
    currentTableName: string,
    columns: string[],
  ): RelatedTableInfo[] {
    const relations: RelatedTableInfo[] = [];

    // 从类名提取前缀部分（可能的父表名）
    // 例如：OrderItem -> Order -> order 表
    const prefixMatch = entityClassName.match(/^([A-Z][a-z]+)([A-Z].+)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const inferredTableName = this.convertCamelToSnake(prefix);

      // 推断的表名不能是当前表
      if (inferredTableName !== currentTableName) {
        // 检查是否有外键字段（如 order_id, user_id）
        const fkField = columns.find(col =>
          col === `${inferredTableName}_id` || col.endsWith('_id'),
        );

        if (fkField) {
          relations.push({
            tableName: inferredTableName,
            relationType: 'foreign_key',
            sourceField: fkField,
            targetField: 'id',
            confidence: 0.6, // 推断置信度较低
          });
        }
      }
    }

    return relations;
  }

  /**
   * 合并关联关系
   */
  private mergeRelations(
    relations1: Map<string, RelatedTableInfo[]>,
    relations2: Map<string, RelatedTableInfo[]>,
  ): Map<string, RelatedTableInfo[]> {
    const merged = new Map<string, RelatedTableInfo[]>();

    // 合并第一个 Map
    for (const [table, related] of relations1) {
      merged.set(table, [...related]);
    }

    // 合并第二个 Map，去重
    for (const [table, related] of relations2) {
      const existing = merged.get(table) ?? [];
      for (const rel of related) {
        // 检查是否已存在相同关联
        const isDuplicate = existing.some(
          e => e.tableName === rel.tableName && e.relationType === rel.relationType,
        );
        if (!isDuplicate) {
          existing.push(rel);
        }
      }
      merged.set(table, existing);
    }

    return merged;
  }

  /**
   * 计算关联密度加成
   *
   * 关联密度越高（关联的表越多且这些表也被发现），
   * 说明该表在业务中更重要。
   */
  private calculateRelationBonus(
    relations: RelatedTableInfo[],
    anchorMap: Map<string, TableAnchor>,
  ): number {
    if (relations.length === 0) {
      return 0;
    }

    // 计算被发现的关联表数量（这些表也在锚点列表中）
    const discoveredRelatedCount = relations.filter(rel =>
      anchorMap.has(rel.tableName),
    ).length;

    // 关联密度 = 被发现的关联表数 / 总关联表数
    const density = discoveredRelatedCount / relations.length;

    // 只有密度超过阈值才给予加成
    if (density < this.config.densityThreshold) {
      return 0;
    }

    // 加成值 = density * maxBonus
    // 例如：密度 0.5，maxBonus 0.1 -> 加成 0.05
    return Math.min(density * this.config.maxBonus, this.config.maxBonus);
  }

  /**
   * CamelCase -> snake_case
   */
  private convertCamelToSnake(camel: string): string {
    return camel
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }
}

/**
 * 创建表关联补充器实例
 */
export function createTableRelationSupplement(
  config?: TableRelationSupplementConfig,
): TableRelationSupplementImpl {
  return new TableRelationSupplementImpl(config);
}