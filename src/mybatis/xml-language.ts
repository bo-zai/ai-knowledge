/**
 * XML Language Support
 *
 * Provides parsing and recognition for MyBatis mapper.xml files.
 */

import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";

/**
 * Check if a file is a MyBatis mapper.xml file.
 */
export function isMapperXmlFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename.endsWith("mapper.xml") || basename.includes("-mapper.xml");
}

/**
 * Parse a MyBatis mapper.xml file.
 */
export async function parseMapperXml(
  filePath: string,
): Promise<MapperXmlDocument> {
  const content = await fs.readFile(filePath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text",
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(content);

  return {
    filePath,
    namespace: extractNamespace(parsed),
    statements: extractStatements(parsed),
  };
}

/**
 * Extract namespace from mapper.xml.
 */
function extractNamespace(parsed: any): string | undefined {
  const mapper = parsed.mapper;
  if (!mapper) return undefined;
  return mapper.namespace;
}

/**
 * Extract SQL statements from mapper.xml.
 */
function extractStatements(parsed: any): SqlStatement[] {
  const mapper = parsed.mapper;
  if (!mapper) return [];

  const statements: SqlStatement[] = [];

  // Extract select statements
  if (mapper.select) {
    const selects = Array.isArray(mapper.select)
      ? mapper.select
      : [mapper.select];
    for (const select of selects) {
      statements.push({
        id: select.id,
        type: "select",
        sql: cleanSql(select["#text"] || ""),
        resultType: select.resultType,
        parameterType: select.parameterType,
      });
    }
  }

  // Extract insert statements
  if (mapper.insert) {
    const inserts = Array.isArray(mapper.insert)
      ? mapper.insert
      : [mapper.insert];
    for (const insert of inserts) {
      statements.push({
        id: insert.id,
        type: "insert",
        sql: cleanSql(insert["#text"] || ""),
        parameterType: insert.parameterType,
      });
    }
  }

  // Extract update statements
  if (mapper.update) {
    const updates = Array.isArray(mapper.update)
      ? mapper.update
      : [mapper.update];
    for (const update of updates) {
      statements.push({
        id: update.id,
        type: "update",
        sql: cleanSql(update["#text"] || ""),
        parameterType: update.parameterType,
      });
    }
  }

  // Extract delete statements
  if (mapper.delete) {
    const deletes = Array.isArray(mapper.delete)
      ? mapper.delete
      : [mapper.delete];
    for (const delete_ of deletes) {
      statements.push({
        id: delete_.id,
        type: "delete",
        sql: cleanSql(delete_["#text"] || ""),
        parameterType: delete_.parameterType,
      });
    }
  }

  return statements;
}

/**
 * Clean SQL text (remove extra whitespace, etc).
 */
function cleanSql(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/^\s*/, "").replace(/\s*$/, "");
}

export interface MapperXmlDocument {
  filePath: string;
  namespace?: string;
  statements: SqlStatement[];
}

export interface SqlStatement {
  id: string;
  type: "select" | "insert" | "update" | "delete";
  sql: string;
  resultType?: string;
  parameterType?: string;
}

/**
 * Extract table names from SQL statement.
 */
export function extractTableNamesFromSql(sql: string): string[] {
  const tables: string[] = [];

  // Simple regex-based extraction
  const fromMatch = sql.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (fromMatch) {
    tables.push(fromMatch[1]);
  }

  const joinMatch = sql.match(/JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (joinMatch) {
    tables.push(joinMatch[1]);
  }

  const insertMatch = sql.match(/INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (insertMatch) {
    tables.push(insertMatch[1]);
  }

  const updateMatch = sql.match(/UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (updateMatch) {
    tables.push(updateMatch[1]);
  }

  const deleteMatch = sql.match(/DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (deleteMatch) {
    tables.push(deleteMatch[1]);
  }

  return [...new Set(tables)];
}
