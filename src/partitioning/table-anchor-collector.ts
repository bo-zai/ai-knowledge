/**
 * 表锚点收集器
 *
 * 收集所有发现的表信息，包括：
 * - 从 Mapper XML 提取的表名
 * - 外键关系（从 Entity 注解或 SQL 分析）
 * - 分表信息（从 Entity 的 tablesMapped）
 * - 关联表检测
 */

import fs from "fs/promises";
import path from "path";
import type { ReadOnlyQueryExecutor } from "../engine/lbug/read-only-session.js";
import type {
  TableInfo,
  EntityInfo,
  MapperInfo,
  JunctionBetween,
} from "./types.js";
import {
  parseMapperFile,
  extractTablesFromSql,
} from "../mybatis/mapper-parser.js";

/**
 * Cypher 字符串转义
 */
function escapeCypherString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * TableAnchorCollector - 表锚点收集器
 */
export class TableAnchorCollector {
  private readonly query: ReadOnlyQueryExecutor;
  private readonly repoPath: string;

  constructor(query: ReadOnlyQueryExecutor, repoPath: string) {
    this.query = query;
    this.repoPath = repoPath;
  }

  /**
   * 收集所有 Mapper 操作的表
   */
  async collectTablesFromMappers(mappers: MapperInfo[]): Promise<TableInfo[]> {
    const tables: TableInfo[] = [];
    const tableSet = new Set<string>();

    for (const mapper of mappers) {
      if (!mapper.xmlPath) continue;

      try {
        const mapperDoc = await parseMapperFile(mapper.xmlPath);
        if (!mapperDoc) continue;

        for (const stmt of mapperDoc.statements) {
          const sqlParts = stmt.rawSqlParts
            .filter((p: { kind: string }) => p.kind === "text")
            .map((p: { value: string }) => p.value)
            .join(" ");

          const extractedTables = extractTablesFromSql(sqlParts);

          for (const tableName of extractedTables) {
            if (tableSet.has(tableName)) continue;
            tableSet.add(tableName);

            tables.push({
              tableName,
              role: "primary",
              tableType: "table",
            });
          }
        }
      } catch {
        continue;
      }
    }

    return tables;
  }

  /**
   * 分析外键关系
   *
   * 从 SQL JOIN 语句或 Entity 注解提取
   */
  async analyzeForeignKeys(
    tables: TableInfo[],
    entities: EntityInfo[],
  ): Promise<TableInfo[]> {
    const result: TableInfo[] = [...tables];
    const tableMap = new Map<string, TableInfo>();
    for (const table of tables) {
      tableMap.set(table.tableName, table);
    }

    // 从 Entity 注解提取外键关系
    for (const entity of entities) {
      try {
        const content = await fs.readFile(entity.filePath, "utf-8");

        // 检查 @JoinColumn 注解
        const joinColumnMatches = content.matchAll(
          /@JoinColumn\s*\(\s*name\s*=\s*"([^"]+)"/g,
        );
        for (const match of joinColumnMatches) {
          const columnName = match[1];
          // 从列名推断外键关系，实际归属仍需结合已发现表集合校验。
          if (columnName.endsWith("_id")) {
            const referencedTable = this.inferTableNameFromColumn(columnName);

            // 找到当前 Entity 对应的表
            const currentTable =
              entity.tablesMapped?.[0] ??
              this.inferTableNameFromClassName(entity.className);
            if (
              currentTable &&
              referencedTable &&
              currentTable !== referencedTable
            ) {
              // 标记为关联表
              const currentTableInfo = tableMap.get(currentTable);
              if (currentTableInfo) {
                currentTableInfo.role = "related";
                currentTableInfo.relationType = "foreign_key";
                currentTableInfo.foreignKey = `${columnName} → ${referencedTable}.id`;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    return result;
  }

  /**
   * 检测分表
   *
   * 从 Entity 注解或 Mapper SQL 检测分表场景
   */
  async detectShardTables(tables: TableInfo[]): Promise<TableInfo[]> {
    const result: TableInfo[] = [];

    // 分组：按 shardGroup 分组
    const shardGroups = new Map<string, TableInfo[]>();

    for (const table of tables) {
      // 检测按时间后缀命名的分表。
      const shardMatch = table.tableName.match(/^(.+)_(\d{4})$/);
      if (shardMatch) {
        const baseName = shardMatch[1];
        if (!shardGroups.has(baseName)) {
          shardGroups.set(baseName, []);
        }
        shardGroups.get(baseName)!.push(table);
      } else {
        result.push(table);
      }
    }

    // 为分表组添加标记
    for (const [baseName, shards] of shardGroups.entries()) {
      // 主表
      result.push({
        tableName: baseName,
        role: "primary",
        tableType: "table",
      });

      // 分表
      for (const shard of shards) {
        const yearMatch = shard.tableName.match(/_(\d{4})$/);
        result.push({
          tableName: shard.tableName,
          role: "shard",
          shardGroup: baseName,
          tableType: "table",
        });
      }
    }

    return result;
  }

  /**
   * 检测关联表（多对多中间表）
   */
  async detectJunctionTables(tables: TableInfo[]): Promise<TableInfo[]> {
    const result: TableInfo[] = [...tables];

    for (const table of tables) {
      // 检测由两个实体名组合形成的关联表。
      const junctionMatch = table.tableName.match(/^(\w+)_(\w+)$/);
      if (junctionMatch) {
        const leftPart = junctionMatch[1];
        const rightPart = junctionMatch[2];

        // 检查是否存在左右表
        const hasLeft = tables.some((t) => t.tableName.startsWith(leftPart));
        const hasRight = tables.some((t) => t.tableName.startsWith(rightPart));

        if (hasLeft && hasRight) {
          table.role = "junction_table";
          table.junctionBetween = {
            leftTable: leftPart,
            rightTable: rightPart,
            leftKey: `${leftPart}_id`,
            rightKey: `${rightPart}_id`,
          };
        }
      }
    }

    return result;
  }

  /**
   * 从列名推断表名
   */
  private inferTableNameFromColumn(columnName: string): string | undefined {
    if (columnName.endsWith("_id")) {
      const baseName = columnName.replace("_id", "");
      // 尝试匹配常见表名模式
      return baseName; // 简化处理，后续可以通过查询验证
    }
    return undefined;
  }

  /**
   * 从 Entity 类名推断表名
   */
  private inferTableNameFromClassName(className: string): string {
    // PascalCase → snake_case
    const snakeName = className
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/_(entity|do|po|vo|dto)$/i, "");

    return snakeName;
  }

  /**
   * 查询 Entity 信息
   */
  async queryEntityInfo(tableName: string): Promise<EntityInfo | undefined> {
    const entityNameCandidates = this.inferEntityNames(tableName);

    for (const entityName of entityNameCandidates) {
      const escapedName = escapeCypherString(entityName);

      const cypher = `
        MATCH (entity:Class)
        WHERE entity.name = '${escapedName}'
        AND NOT entity.filePath CONTAINS 'test'
        RETURN entity.name AS className, entity.filePath AS filePath
        LIMIT 1
      `;

      const rows = await this.query(cypher);

      if (rows.length > 0) {
        const filePath = rows[0].filePath as string;
        if (filePath) {
          return {
            className: entityName,
            filePath,
            module: path.dirname(filePath).split("/").pop() || "unknown",
            entityRole: "canonical",
            tablesMapped: [tableName],
          };
        }
      }
    }

    return undefined;
  }

  /**
   * 推断 Entity 类名
   */
  private inferEntityNames(tableName: string): string[] {
    const pascalName = tableName
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");

    return [
      pascalName,
      `${pascalName}Entity`,
      `${pascalName}DO`,
      `${pascalName}PO`,
    ];
  }
}

/**
 * 创建 TableAnchorCollector 实例
 */
export function createTableAnchorCollector(
  query: ReadOnlyQueryExecutor,
  repoPath: string,
): TableAnchorCollector {
  return new TableAnchorCollector(query, repoPath);
}
