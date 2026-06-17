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

import type {
  TableAnchor,
  RelatedTableInfo,
  MapperInfo,
  DiscoveryPathResult,
} from "./types.js";
import { parseMapperFile } from "../../../mybatis/mapper-parser.js";

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

    // 2. 从 pathResults 中提取 Mapper 信息分析 JOIN（异步）
    const mapperJoinRelations = await this.extractJoinRelationsFromPaths(
      pathResults ?? [],
    );

    // 3. 从 traceSources 中提取 Mapper XML 中的关联
    const traceSourceRelations =
      this.extractRelationsFromTraceSources(tableAnchors);

    // 4. 合并关联关系
    const allRelations = this.mergeRelations(
      mapperJoinRelations,
      traceSourceRelations,
    );

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
   * 从 DiscoveryPathResult 中提取 JOIN 关联关系（异步）
   */
  private async extractJoinRelationsFromPaths(
    pathResults: DiscoveryPathResult[],
  ): Promise<Map<string, RelatedTableInfo[]>> {
    const relations = new Map<string, RelatedTableInfo[]>();

    // 收集所有需要解析的 Mapper
    const mappersToParse: MapperInfo[] = [];
    for (const result of pathResults) {
      for (const path of result.tracePaths) {
        for (const mapper of path.mappers) {
          if (mapper.xmlPath) {
            mappersToParse.push(mapper);
          }
        }
      }
    }

    // 并行解析所有 Mapper XML
    const parseResults = await Promise.all(
      mappersToParse.map((mapper) =>
        this.parseJoinRelationsFromMapperXml(mapper),
      ),
    );

    // 合并所有解析结果
    for (const joinRelations of parseResults) {
      for (const [table, related] of joinRelations) {
        const existing = relations.get(table) ?? [];
        relations.set(table, [...existing, ...related]);
      }
    }

    return relations;
  }

  /**
   * 从 Mapper XML 文件中解析 JOIN 关联
   *
   * 解析流程：
   * 1. 读取并解析 Mapper XML 文件
   * 2. 提取 SQL 语句中的 JOIN 子句
   * 3. 解析 ON 条件提取关联字段
   *
   * 支持的 JOIN 类型：
   * - INNER JOIN: 置信度 0.8
   * - LEFT [OUTER] JOIN: 置信度 0.6
   * - RIGHT [OUTER] JOIN: 置信度 0.6
   * - CROSS JOIN: 置信度 0.5
   */
  private async parseJoinRelationsFromMapperXml(
    mapper: MapperInfo,
  ): Promise<Map<string, RelatedTableInfo[]>> {
    const relations = new Map<string, RelatedTableInfo[]>();

    if (!mapper.xmlPath) {
      return relations;
    }

    // 解析 Mapper XML 文件
    const mapperDoc = await parseMapperFile(mapper.xmlPath);
    if (!mapperDoc) {
      return relations;
    }

    // 遍历所有 SQL 语句
    for (const stmt of mapperDoc.statements) {
      const sql = this.concatenateSqlParts(stmt.rawSqlParts);
      const joinRelations = this.extractJoinRelationsFromSql(sql, stmt.type);

      // 合并关联关系
      for (const [table, related] of joinRelations) {
        const existing = relations.get(table) ?? [];
        // 去重合并
        for (const rel of related) {
          const isDuplicate = existing.some(
            (e) =>
              e.tableName === rel.tableName &&
              e.relationType === rel.relationType &&
              e.sourceField === rel.sourceField &&
              e.targetField === rel.targetField,
          );
          if (!isDuplicate) {
            existing.push(rel);
          }
        }
        relations.set(table, existing);
      }
    }

    return relations;
  }

  /**
   * 从 SQL 语句中提取 JOIN 关联关系
   *
   * @param sql - SQL 语句文本
   * @param stmtType - 语句类型
   * @returns 表名到关联信息的映射
   */
  private extractJoinRelationsFromSql(
    sql: string,
    stmtType: "select" | "insert" | "update" | "delete",
  ): Map<string, RelatedTableInfo[]> {
    const relations = new Map<string, RelatedTableInfo[]>();

    // 只有 SELECT 语句通常包含 JOIN
    if (stmtType !== "select") {
      return relations;
    }

    // 标准化 SQL：移除多余空白，统一大小写
    const normalizedSql = sql.replace(/\s+/g, " ").toUpperCase();

    // JOIN 模式匹配
    // 匹配：[LEFT|RIGHT|INNER|OUTER] JOIN table_name [alias] ON condition
    const joinPattern =
      /(?:INNER\s+)?(?:LEFT\s+(?:OUTER\s+)?)?(?:RIGHT\s+(?:OUTER\s+)?)?(?:CROSS\s+)?JOIN\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?\s+ON\s+([^()]+?)(?=(?:INNER|LEFT|RIGHT|CROSS|JOIN|WHERE|GROUP|ORDER|UNION|HAVING|LIMIT|$))/gi;

    // 首先提取 FROM 子句中的主表
    const fromMatch = normalizedSql.match(
      /FROM\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/i,
    );
    const primaryTable = fromMatch ? fromMatch[1].toLowerCase() : null;
    const primaryAlias =
      fromMatch && fromMatch[2] ? fromMatch[2].toLowerCase() : primaryTable;

    // 构建 alias -> table 的映射
    const aliasToTable = new Map<string, string>();
    if (primaryTable && primaryAlias) {
      aliasToTable.set(primaryAlias, primaryTable);
    }

    // 提取所有 JOIN
    let match: RegExpExecArray | null;
    while ((match = joinPattern.exec(normalizedSql)) !== null) {
      const joinedTable = match[1].toLowerCase();
      const joinedAlias = match[2] ? match[2].toLowerCase() : joinedTable;
      const onClause = match[3].trim();

      // 记录 alias 映射
      aliasToTable.set(joinedAlias, joinedTable);

      // 确定 JOIN 类型和置信度
      const joinType = this.determineJoinType(match[0]);
      const confidence = this.getJoinConfidence(joinType);

      // 解析 ON 条件提取关联字段
      const { sourceField, targetField, sourceTable, targetTable } =
        this.parseOnClause(onClause, aliasToTable);

      // 确定主表（FROM 子句中的表或 ON 条件中引用的表）
      const effectivePrimaryTable = sourceTable || primaryTable;

      if (effectivePrimaryTable) {
        // 为被 JOIN 的表创建关联记录
        const relatedInfo: RelatedTableInfo = {
          tableName: joinedTable,
          relationType: "join",
          sourceField,
          targetField,
          confidence,
        };

        const existing = relations.get(effectivePrimaryTable) ?? [];
        existing.push(relatedInfo);
        relations.set(effectivePrimaryTable, existing);

        // 同时为被 JOIN 的表创建反向关联（可选）
        // 这样可以双向发现关联关系
        const reverseRelatedInfo: RelatedTableInfo = {
          tableName: effectivePrimaryTable,
          relationType: "join",
          sourceField: targetField,
          targetField: sourceField,
          confidence: confidence * 0.8, // 反向关联置信度稍低
        };

        const reverseExisting = relations.get(joinedTable) ?? [];
        reverseExisting.push(reverseRelatedInfo);
        relations.set(joinedTable, reverseExisting);
      }
    }

    return relations;
  }

  /**
   * 确定 JOIN 类型
   */
  private determineJoinType(
    joinClause: string,
  ): "inner" | "left" | "right" | "cross" {
    const upper = joinClause.toUpperCase();
    if (upper.includes("INNER")) return "inner";
    if (upper.includes("LEFT")) return "left";
    if (upper.includes("RIGHT")) return "right";
    if (upper.includes("CROSS")) return "cross";
    // 默认为 INNER JOIN（只有 JOIN 关键字时）
    return "inner";
  }

  /**
   * 根据 JOIN 类型获取置信度
   */
  private getJoinConfidence(
    joinType: "inner" | "left" | "right" | "cross",
  ): number {
    switch (joinType) {
      case "inner":
        return 0.8;
      case "left":
      case "right":
        return 0.6;
      case "cross":
        return 0.5;
      default:
        return 0.5;
    }
  }

  /**
   * 解析 ON 条件提取关联字段
   *
   * 支持的模式：
   * - table1.col1 = table2.col2
   * - alias1.col1 = alias2.col2
   * - col1 = col2 (无表前缀)
   */
  private parseOnClause(
    onClause: string,
    aliasToTable: Map<string, string>,
  ): {
    sourceField: string | undefined;
    targetField: string | undefined;
    sourceTable: string | undefined;
    targetTable: string | undefined;
  } {
    // 移除括号内的子查询等复杂条件
    const simplifiedOn = onClause.replace(/\([^)]+\)/g, "").trim();

    // 匹配 column = column 模式
    const columnPattern =
      /([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)\s*=\s*([A-Z_][A-Z0-9_]*)\.([A-Z_][A-Z0-9_]*)/i;
    const match = simplifiedOn.match(columnPattern);

    if (match) {
      const leftTable = match[1].toLowerCase();
      const leftColumn = match[2].toLowerCase();
      const rightTable = match[3].toLowerCase();
      const rightColumn = match[4].toLowerCase();

      // 将 alias 解析为实际表名
      const actualLeftTable = aliasToTable.get(leftTable) || leftTable;
      const actualRightTable = aliasToTable.get(rightTable) || rightTable;

      // 返回第一个作为源，第二个作为目标
      // 实际使用时由调用方根据主表确定哪边是源
      return {
        sourceField: leftColumn,
        targetField: rightColumn,
        sourceTable: actualLeftTable,
        targetTable: actualRightTable,
      };
    }

    // 尝试匹配无表前缀的模式：col1 = col2
    const simplePattern = /([A-Z_][A-Z0-9_]*)\s*=\s*([A-Z_][A-Z0-9_]*)/i;
    const simpleMatch = simplifiedOn.match(simplePattern);
    if (simpleMatch) {
      return {
        sourceField: simpleMatch[1].toLowerCase(),
        targetField: simpleMatch[2].toLowerCase(),
        sourceTable: undefined,
        targetTable: undefined,
      };
    }

    return {
      sourceField: undefined,
      targetField: undefined,
      sourceTable: undefined,
      targetTable: undefined,
    };
  }

  /**
   * 将 SQL parts 拼接为完整 SQL 字符串
   */
  private concatenateSqlParts(
    parts: Array<{ kind: string; value: string }>,
  ): string {
    return parts
      .map((p) => {
        if (p.kind === "include") {
          return `<include refid="${p.value}" />`;
        }
        return p.value;
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 从 traceSources 中提取关联关系
   *
   * 分析每个 traceSource 的 Mapper 和 Entity 信息，
   * 推断表之间的关联关系。
   */
  private extractRelationsFromTraceSources(
    tableAnchors: TableAnchor[],
  ): Map<string, RelatedTableInfo[]> {
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
        const fkField = columns.find(
          (col) => col === `${inferredTableName}_id` || col.endsWith("_id"),
        );

        if (fkField) {
          relations.push({
            tableName: inferredTableName,
            relationType: "foreign_key",
            sourceField: fkField,
            targetField: "id",
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
          (e) =>
            e.tableName === rel.tableName &&
            e.relationType === rel.relationType,
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
    const discoveredRelatedCount = relations.filter((rel) =>
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
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
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
