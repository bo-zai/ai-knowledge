/**
 * MyBatis Mapper Parser
 *
 * Extracts namespace, select/insert/update/delete/sql/include statements
 * and resultMap definitions from MyBatis mapper XML files.
 * Preserves <include> structure for downstream fragment expansion.
 */

import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import { isMapperXmlFile } from "./xml-language.js";
import type {
  StatementDraft,
  SqlFragment,
  ResultMapDef,
  MapperDocument,
  SqlPart,
} from "./types.js";

// Legacy types for backward compatibility
export interface MapperStatement {
  id: string;
  type: "select" | "insert" | "update" | "delete" | "sql" | "include";
  sql: string;
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}

export interface MapperInfo {
  filePath: string;
  namespace: string;
  statements: MapperStatement[];
  referencedTables: string[];
}

/**
 * Parse a MyBatis mapper file and extract all statements with preserved structure.
 */
export async function parseMapperFile(
  filePath: string,
): Promise<MapperDocument | null> {
  if (!isMapperXmlFile(filePath)) {
    return null;
  }

  const content = await fs.readFile(filePath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text",
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) =>
      [
        "select",
        "insert",
        "update",
        "delete",
        "sql",
        "resultMap",
        "id",
        "result",
        "include",
      ].includes(name),
  });

  const parsed = parser.parse(content);
  const mapper = parsed.mapper;

  if (!mapper) {
    return null;
  }

  const namespace = mapper.namespace || "";
  const statements = extractStatements(mapper);
  const sqlFragments = extractSqlFragments(mapper);
  const resultMaps = extractResultMaps(mapper);

  return {
    filePath,
    namespace,
    statements,
    sqlFragments,
    resultMaps,
  };
}

/**
 * Extract SQL statements (select/insert/update/delete) with preserved structure.
 */
function extractStatements(mapper: any): StatementDraft[] {
  const statements: StatementDraft[] = [];
  const stmtTypes = ["select", "insert", "update", "delete"];

  for (const stmtType of stmtTypes) {
    const stmtArray = mapper[stmtType];
    if (!stmtArray) continue;

    for (const stmt of stmtArray) {
      // Extract id (may be array due to parser config)
      const id = Array.isArray(stmt.id) ? stmt.id[0] : stmt.id || "";
      const rawSqlParts = parseSqlContent(stmt);
      const includeRefs = rawSqlParts
        .filter((p) => p.kind === "include")
        .map((p) => p.value);

      // Extract resultType/resultMap (may be array due to parser config)
      const resultType = Array.isArray(stmt.resultType)
        ? stmt.resultType[0]
        : stmt.resultType;
      const resultMap = Array.isArray(stmt.resultMap)
        ? stmt.resultMap[0]
        : stmt.resultMap;

      statements.push({
        id,
        type: stmtType as "select" | "insert" | "update" | "delete",
        rawSqlParts,
        includeRefs,
        parameterType: Array.isArray(stmt.parameterType)
          ? stmt.parameterType[0]
          : stmt.parameterType,
        resultType,
        resultMap,
      });
    }
  }

  return statements;
}

/**
 * Parse SQL content preserving <include> structure.
 */
function parseSqlContent(stmt: any): SqlPart[] {
  const parts: SqlPart[] = [];

  // Get the raw text content
  const text = stmt["#text"] || "";
  if (text) {
    parts.push({ kind: "text", value: cleanSql(text) });
  }

  // Check for nested include elements
  if (stmt.include) {
    const includes = Array.isArray(stmt.include)
      ? stmt.include
      : [stmt.include];
    for (const inc of includes) {
      const refid = inc.refid || "";
      parts.push({ kind: "include", value: refid });
    }
  }

  // Check for other nested MyBatis tags that might contain include
  const nestedTags = [
    "if",
    "where",
    "set",
    "trim",
    "choose",
    "when",
    "otherwise",
    "foreach",
  ];
  for (const tag of nestedTags) {
    if (stmt[tag]) {
      const nestedParts = extractNestedSqlParts(stmt[tag], tag);
      parts.push(...nestedParts);
    }
  }

  return parts;
}

/**
 * Extract SQL parts from nested MyBatis tags.
 */
function extractNestedSqlParts(nested: any, parentTag?: string): SqlPart[] {
  const parts: SqlPart[] = [];

  const items = Array.isArray(nested) ? nested : [nested];
  for (const item of items) {
    // 对于 <where> 和 <set> 标签，添加关键字前缀
    if (parentTag === "where") {
      parts.push({ kind: "text", value: "where" });
    } else if (parentTag === "set") {
      parts.push({ kind: "text", value: "set" });
    }

    // Get text content
    const text = item["#text"] || "";
    if (text) {
      parts.push({ kind: "text", value: cleanSql(text) });
    }

    // Get nested include
    if (item.include) {
      const includes = Array.isArray(item.include)
        ? item.include
        : [item.include];
      for (const inc of includes) {
        const refid = inc.refid || "";
        parts.push({ kind: "include", value: refid });
      }
    }

    // Recursively check nested tags
    const nestedTags = [
      "if",
      "where",
      "set",
      "trim",
      "choose",
      "when",
      "otherwise",
      "foreach",
    ];
    for (const tag of nestedTags) {
      if (item[tag]) {
        const deeperParts = extractNestedSqlParts(item[tag], tag);
        parts.push(...deeperParts);
      }
    }
  }

  return parts;
}

/**
 * Extract SQL fragments (<sql id="...">).
 */
function extractSqlFragments(mapper: any): SqlFragment[] {
  const fragments: SqlFragment[] = [];

  const sqlArray = mapper.sql;
  if (!sqlArray) return fragments;

  for (const sqlElem of sqlArray) {
    // Extract id (may be array due to parser config)
    const id = Array.isArray(sqlElem.id) ? sqlElem.id[0] : sqlElem.id || "";
    const rawSqlParts = parseSqlContent(sqlElem);
    fragments.push({ id, rawSqlParts });
  }

  return fragments;
}

/**
 * Extract resultMap definitions.
 */
function extractResultMaps(mapper: any): ResultMapDef[] {
  const resultMaps: ResultMapDef[] = [];

  const rmArray = mapper.resultMap;
  if (!rmArray) return resultMaps;

  for (const rm of rmArray) {
    // Extract id and type (may be array due to parser config)
    const id = Array.isArray(rm.id) ? rm.id[0] : rm.id || "";
    const type = Array.isArray(rm.type) ? rm.type[0] : rm.type;
    const mappings = extractResultMapMappings(rm);
    resultMaps.push({ id, type, mappings });
  }

  return resultMaps;
}

/**
 * Extract property/column mappings from resultMap.
 */
function extractResultMapMappings(
  resultMap: any,
): Array<{ property: string; column: string }> {
  const mappings: Array<{ property: string; column: string }> = [];

  // Extract <id> mappings
  if (resultMap.id) {
    const ids = Array.isArray(resultMap.id) ? resultMap.id : [resultMap.id];
    for (const item of ids) {
      // Handle array values due to parser config
      const column = Array.isArray(item.column)
        ? item.column[0]
        : item.column || "";
      const property = Array.isArray(item.property)
        ? item.property[0]
        : item.property || "";
      if (column && property) {
        mappings.push({ property, column });
      }
    }
  }

  // Extract <result> mappings
  if (resultMap.result) {
    const results = Array.isArray(resultMap.result)
      ? resultMap.result
      : [resultMap.result];
    for (const item of results) {
      // Handle array values due to parser config
      const column = Array.isArray(item.column)
        ? item.column[0]
        : item.column || "";
      const property = Array.isArray(item.property)
        ? item.property[0]
        : item.property || "";
      if (column && property) {
        mappings.push({ property, column });
      }
    }
  }

  return mappings;
}

/**
 * Clean SQL text by removing extra whitespace.
 */
function cleanSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Extract table names from a SQL statement.
 */
export function extractTablesFromSql(sql: string): string[] {
  const tables: string[] = [];

  // Match FROM table
  const fromMatches = sql.match(
    /FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi,
  );
  if (fromMatches) {
    for (const match of fromMatches) {
      const tableName = match.replace(/FROM\s+/i, "").split(".")[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match JOIN table
  const joinMatches = sql.match(
    /JOIN\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi,
  );
  if (joinMatches) {
    for (const match of joinMatches) {
      const tableName = match.replace(/JOIN\s+/i, "").split(".")[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match INSERT INTO table
  const insertMatches = sql.match(
    /INSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi,
  );
  if (insertMatches) {
    for (const match of insertMatches) {
      const tableName = match.replace(/INSERT\s+INTO\s+/i, "").split(".")[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match UPDATE table
  const updateMatches = sql.match(
    /UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi,
  );
  if (updateMatches) {
    for (const match of updateMatches) {
      const tableName = match.replace(/UPDATE\s+/i, "").split(".")[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match DELETE FROM table
  const deleteMatches = sql.match(
    /DELETE\s+FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi,
  );
  if (deleteMatches) {
    for (const match of deleteMatches) {
      const tableName = match.replace(/DELETE\s+FROM\s+/i, "").split(".")[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  return tables;
}

/**
 * Check if a word is a SQL keyword (not a table name).
 */
function isSqlKeyword(word: string): boolean {
  const keywords = [
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "in",
    "like",
    "between",
    "exists",
    "null",
    "true",
    "false",
    "case",
    "when",
    "then",
    "else",
    "end",
    "as",
    "on",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "natural",
    "using",
    "group",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "except",
    "intersect",
    "distinct",
    "all",
    "any",
    "some",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "values",
    "set",
    "into",
    "default",
    "primary",
    "key",
    "foreign",
    "references",
    "constraint",
    "unique",
    "index",
    "table",
    "create",
    "alter",
    "drop",
    "truncate",
    "insert",
    "update",
    "delete",
    "with",
    "recursive",
    "temporary",
    "if",
    "dual",
    "sysdate",
    "current",
    "timestamp",
    "date",
    "time",
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "interval",
    "cast",
    "convert",
    "coalesce",
    "decode",
    "nvl",
    "substr",
    "substring",
    "length",
    "char",
    "varchar",
    "int",
    "integer",
    "bigint",
    "smallint",
    "decimal",
    "numeric",
    "float",
    "double",
    "real",
    "boolean",
    "blob",
    "clob",
    "text",
    "xml",
    "json",
    "uuid",
    "auto_increment",
    "by",
    "desc",
    "asc",
    "join",
  ];
  return keywords.includes(word.toLowerCase());
}

/**
 * Find all mapper files in a directory.
 */
export async function findMapperFiles(repoPath: string): Promise<string[]> {
  const { glob } = await import("glob");

  const pattern = "**/*mapper*.xml";
  const matches = await glob(pattern, {
    cwd: repoPath,
    absolute: true,
    ignore: ["node_modules/**", ".git/**", "dist/**", "build/**", "target/**"],
  });

  return matches;
}

/**
 * Parse all mapper files in a repository.
 */
export async function parseAllMapperFiles(
  repoPath: string,
): Promise<MapperDocument[]> {
  const mapperFiles = await findMapperFiles(repoPath);
  const results: MapperDocument[] = [];

  for (const file of mapperFiles) {
    const info = await parseMapperFile(file);
    if (info) {
      results.push(info);
    }
  }

  return results;
}

/**
 * Concatenate SQL parts into a single string (for legacy compatibility).
 */
function concatenateSqlParts(parts: SqlPart[]): string {
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
 * Build a table-to-mapper mapping (statement-scoped).
 */
export async function buildTableMapperMap(
  repoPath: string,
): Promise<Map<string, MapperDocument[]>> {
  const mappers = await parseAllMapperFiles(repoPath);
  const tableMap = new Map<string, MapperDocument[]>();

  for (const mapper of mappers) {
    // Extract tables from each statement (statement-scoped)
    for (const stmt of mapper.statements) {
      const sql = concatenateSqlParts(stmt.rawSqlParts);
      const tables = extractTablesFromSql(sql);
      for (const table of tables) {
        const existing = tableMap.get(table) || [];
        if (!existing.includes(mapper)) {
          existing.push(mapper);
          tableMap.set(table, existing);
        }
      }
    }
  }

  return tableMap;
}
