/**
 * SQL Lineage Extraction
 *
 * Extracts lineage from MyBatis mapper files:
 * - Method -> sql_statement (QUERIES)
 * - sql_statement -> db_table (ACCESSES)
 *
 * This enables tracing from Java code to database tables.
 */

import {
  parseMapperFile,
  type MapperInfo,
  type MapperStatement,
} from './mapper-parser.js';
import type { DbTableContext } from '../query/index-service.js';

export interface SqlLineageEdge {
  type: 'QUERIES' | 'ACCESSES';
  from: string;
  to: string;
  evidence: {
    mapperFile: string;
    statementId: string;
    statementType: string;
    sql: string;
  };
}

export interface MapperMethodBinding {
  namespace: string;
  methodId: string;
  javaClass: string;
  javaMethod: string;
  statements: MapperStatement[];
}

/**
 * Build lineage edges from mapper info.
 */
export function buildLineageEdges(mapper: MapperInfo): SqlLineageEdge[] {
  const edges: SqlLineageEdge[] = [];
  const namespace = mapper.namespace;

  for (const stmt of mapper.statements) {
    // Create method-to-statement edge
    edges.push({
      type: 'QUERIES',
      from: `${namespace}.${stmt.id}`,
      to: `sql:${stmt.id}`,
      evidence: {
        mapperFile: mapper.filePath,
        statementId: stmt.id,
        statementType: stmt.type,
        sql: stmt.sql,
      },
    });

    // Create statement-to-table edges
    const tables = extractTablesFromStatement(stmt);
    for (const table of tables) {
      edges.push({
        type: 'ACCESSES',
        from: `sql:${stmt.id}`,
        to: `table:${table}`,
        evidence: {
          mapperFile: mapper.filePath,
          statementId: stmt.id,
          statementType: stmt.type,
          sql: stmt.sql,
        },
      });
    }
  }

  return edges;
}

/**
 * Extract table names from a SQL statement.
 */
function extractTablesFromStatement(stmt: MapperStatement): string[] {
  const tables: string[] = [];
  const sql = stmt.sql;

  // Match FROM table
  const fromRegex = /FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi;
  const fromMatches = sql.matchAll(fromRegex);
  for (const match of fromMatches) {
    const tableName = match[0].replace(/FROM\s+/i, '').split('.')[0];
    if (tableName && !isSqlKeyword(tableName)) {
      tables.push(tableName.toLowerCase());
    }
  }

  // Match JOIN table
  const joinRegex = /JOIN\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi;
  const joinMatches = sql.matchAll(joinRegex);
  for (const match of joinMatches) {
    const tableName = match[0].replace(/JOIN\s+/i, '').split('.')[0];
    if (tableName && !isSqlKeyword(tableName)) {
      tables.push(tableName.toLowerCase());
    }
  }

  // Match INSERT INTO table
  const insertRegex = /INSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi;
  const insertMatches = sql.matchAll(insertRegex);
  for (const match of insertMatches) {
    const tableName = match[0].replace(/INSERT\s+INTO\s+/i, '').split('.')[0];
    if (tableName && !isSqlKeyword(tableName)) {
      tables.push(tableName.toLowerCase());
    }
  }

  // Match UPDATE table
  const updateRegex = /UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi;
  const updateMatches = sql.matchAll(updateRegex);
  for (const match of updateMatches) {
    const tableName = match[0].replace(/UPDATE\s+/i, '').split('.')[0];
    if (tableName && !isSqlKeyword(tableName)) {
      tables.push(tableName.toLowerCase());
    }
  }

  // Match DELETE FROM table
  const deleteRegex = /DELETE\s+FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/gi;
  const deleteMatches = sql.matchAll(deleteRegex);
  for (const match of deleteMatches) {
    const tableName = match[0].replace(/DELETE\s+FROM\s+/i, '').split('.')[0];
    if (tableName && !isSqlKeyword(tableName)) {
      tables.push(tableName.toLowerCase());
    }
  }

  return [...new Set(tables)];
}

/**
 * Check if a word is a SQL keyword.
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
  ];
  return keywords.includes(word.toLowerCase());
}

/**
 * Build mapper method bindings for Java-to-SQL linkage.
 */
export function buildMapperMethodBindings(mapper: MapperInfo): MapperMethodBinding[] {
  const bindings: MapperMethodBinding[] = [];
  const namespace = mapper.namespace;

  // Parse namespace to get Java class name
  const javaClass = namespace;

  for (const stmt of mapper.statements) {
    bindings.push({
      namespace,
      methodId: stmt.id,
      javaClass,
      javaMethod: stmt.id,
      statements: [stmt],
    });
  }

  return bindings;
}

/**
 * Build complete SQL lineage for a repository.
 */
export async function buildSqlLineage(mapperFiles: string[]): Promise<{
  edges: SqlLineageEdge[];
  bindings: MapperMethodBinding[];
}> {
  const allEdges: SqlLineageEdge[] = [];
  const allBindings: MapperMethodBinding[] = [];

  for (const file of mapperFiles) {
    const mapper = await parseMapperFile(file);
    if (mapper) {
      const edges = buildLineageEdges(mapper);
      const bindings = buildMapperMethodBindings(mapper);
      allEdges.push(...edges);
      allBindings.push(...bindings);
    }
  }

  return { edges: allEdges, bindings: allBindings };
}

/**
 * Get lineage for a specific table.
 */
export function getTableLineage(
  tableName: string,
  edges: SqlLineageEdge[],
): {
  statements: string[];
  methods: string[];
} {
  const statements: string[] = [];
  const methods: string[] = [];

  for (const edge of edges) {
    if (edge.to === `table:${tableName.toLowerCase()}`) {
      statements.push(edge.from);
    }
  }

  for (const edge of edges) {
    if (statements.includes(edge.to) && edge.type === 'QUERIES') {
      methods.push(edge.from);
    }
  }

  return { statements, methods };
}

/**
 * Build DB context enriched with lineage.
 */
export function enrichDbContextWithLineage(
  context: DbTableContext,
  lineage: { statements: string[]; methods: string[] },
): DbTableContext {
  return {
    ...context,
    queries: lineage.statements.map((s) => s.replace('sql:', '')),
  };
}