/**
 * MyBatis Mapper Parser
 *
 * Extracts namespace, select/insert/update/delete/sql/include statements
 * from MyBatis mapper XML files.
 */

import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';
import { isMapperXmlFile } from './xml-language.js';

export interface MapperStatement {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete' | 'sql' | 'include';
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
 * Parse a MyBatis mapper file and extract all statements.
 */
export async function parseMapperFile(filePath: string): Promise<MapperInfo | null> {
  if (!isMapperXmlFile(filePath)) {
    return null;
  }

  const content = await fs.readFile(filePath, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ['select', 'insert', 'update', 'delete', 'sql', 'include'].includes(name),
  });

  const parsed = parser.parse(content);
  const mapper = parsed.mapper;

  if (!mapper) {
    return null;
  }

  const namespace = mapper.namespace || '';
  const statements = extractStatements(mapper);
  const referencedTables = extractReferencedTables(statements);

  return {
    filePath,
    namespace,
    statements,
    referencedTables,
  };
}

/**
 * Extract all SQL statements from a mapper element.
 */
function extractStatements(mapper: any): MapperStatement[] {
  const statements: MapperStatement[] = [];

  // Extract select statements
  if (mapper.select) {
    for (const select of mapper.select) {
      statements.push({
        id: select.id || '',
        type: 'select',
        sql: cleanSql(select['#text'] || ''),
        parameterType: select.parameterType,
        resultType: select.resultType,
        resultMap: select.resultMap,
      });
    }
  }

  // Extract insert statements
  if (mapper.insert) {
    for (const insert of mapper.insert) {
      statements.push({
        id: insert.id || '',
        type: 'insert',
        sql: cleanSql(insert['#text'] || ''),
        parameterType: insert.parameterType,
      });
    }
  }

  // Extract update statements
  if (mapper.update) {
    for (const update of mapper.update) {
      statements.push({
        id: update.id || '',
        type: 'update',
        sql: cleanSql(update['#text'] || ''),
        parameterType: update.parameterType,
      });
    }
  }

  // Extract delete statements
  if (mapper.delete) {
    for (const deleteStmt of mapper.delete) {
      statements.push({
        id: deleteStmt.id || '',
        type: 'delete',
        sql: cleanSql(deleteStmt['#text'] || ''),
        parameterType: deleteStmt.parameterType,
      });
    }
  }

  // Extract sql fragments
  if (mapper.sql) {
    for (const sql of mapper.sql) {
      statements.push({
        id: sql.id || '',
        type: 'sql',
        sql: cleanSql(sql['#text'] || ''),
      });
    }
  }

  return statements;
}

/**
 * Clean SQL text by removing extra whitespace and MyBatis tags.
 */
function cleanSql(sql: string): string {
  return sql
    .replace(/\$\{[^}]+\}/g, '?')  // Replace ${param} with ?
    .replace(/#\{[^}]+\}/g, '?')   // Replace #{param} with ?
    .replace(/<!--[^>]*-->/g, '')  // Remove comments
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract all referenced tables from SQL statements.
 */
function extractReferencedTables(statements: MapperStatement[]): string[] {
  const tables: string[] = [];

  for (const stmt of statements) {
    const extractedTables = extractTablesFromSql(stmt.sql);
    tables.push(...extractedTables);
  }

  return [...new Set(tables)];
}

/**
 * Extract table names from a SQL statement.
 */
function extractTablesFromSql(sql: string): string[] {
  const tables: string[] = [];

  // Match FROM table
  const fromMatches = sql.match(/FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
  if (fromMatches) {
    for (const match of fromMatches) {
      const tableName = match.replace(/FROM\s+/i, '').split('.')[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match JOIN table
  const joinMatches = sql.match(/JOIN\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
  if (joinMatches) {
    for (const match of joinMatches) {
      const tableName = match.replace(/JOIN\s+/i, '').split('.')[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match INSERT INTO table
  const insertMatches = sql.match(/INSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
  if (insertMatches) {
    for (const match of insertMatches) {
      const tableName = match.replace(/INSERT\s+INTO\s+/i, '').split('.')[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match UPDATE table
  const updateMatches = sql.match(/UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
  if (updateMatches) {
    for (const match of updateMatches) {
      const tableName = match.replace(/UPDATE\s+/i, '').split('.')[0];
      if (tableName && !isSqlKeyword(tableName)) {
        tables.push(tableName.toLowerCase());
      }
    }
  }

  // Match DELETE FROM table
  const deleteMatches = sql.match(/DELETE\s+FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi);
  if (deleteMatches) {
    for (const match of deleteMatches) {
      const tableName = match.replace(/DELETE\s+FROM\s+/i, '').split('.')[0];
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
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like',
    'between', 'exists', 'null', 'true', 'false', 'case', 'when',
    'then', 'else', 'end', 'as', 'on', 'left', 'right', 'inner',
    'outer', 'full', 'cross', 'natural', 'using', 'group', 'order',
    'having', 'limit', 'offset', 'union', 'except', 'intersect',
    'distinct', 'all', 'any', 'some', 'count', 'sum', 'avg', 'min',
    'max', 'values', 'set', 'into', 'default', 'primary', 'key',
    'foreign', 'references', 'constraint', 'unique', 'index', 'table',
    'create', 'alter', 'drop', 'truncate', 'insert', 'update', 'delete',
    'with', 'recursive', 'temporary', 'if', 'dual', 'sysdate', 'current',
    'timestamp', 'date', 'time', 'year', 'month', 'day', 'hour', 'minute',
    'second', 'interval', 'cast', 'convert', 'coalesce', 'decode', 'nvl',
    'substr', 'substring', 'length', 'char', 'varchar', 'int', 'integer',
    'bigint', 'smallint', 'decimal', 'numeric', 'float', 'double', 'real',
    'boolean', 'blob', 'clob', 'text', 'xml', 'json', 'uuid', 'auto_increment',
  ];
  return keywords.includes(word.toLowerCase());
}

/**
 * Find all mapper files in a directory.
 */
export async function findMapperFiles(repoPath: string): Promise<string[]> {
  const files: string[] = [];

  // Recursively search for mapper.xml files
  const { glob } = await import('glob');
  const ignore = await import('ignore');

  const ig = ignore.default();
  ig.add(['node_modules', '.git', 'dist', 'build', 'target']);

  const pattern = '**/*mapper*.xml';
  const matches = await glob(pattern, {
    cwd: repoPath,
    absolute: true,
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'target/**'],
  });

  files.push(...matches);
  return files;
}

/**
 * Parse all mapper files in a repository.
 */
export async function parseAllMapperFiles(repoPath: string): Promise<MapperInfo[]> {
  const mapperFiles = await findMapperFiles(repoPath);
  const results: MapperInfo[] = [];

  for (const file of mapperFiles) {
    const info = await parseMapperFile(file);
    if (info) {
      results.push(info);
    }
  }

  return results;
}

/**
 * Build a table-to-mapper mapping.
 */
export async function buildTableMapperMap(repoPath: string): Promise<Map<string, MapperInfo[]>> {
  const mappers = await parseAllMapperFiles(repoPath);
  const tableMap = new Map<string, MapperInfo[]>();

  for (const mapper of mappers) {
    for (const table of mapper.referencedTables) {
      const existing = tableMap.get(table) || [];
      existing.push(mapper);
      tableMap.set(table, existing);
    }
  }

  return tableMap;
}