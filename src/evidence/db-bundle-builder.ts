/**
 * DB Table Context Bundle Builder
 *
 * Builds comprehensive evidence bundles for database tables,
 * integrating mapper bindings, SQL statements, and related code.
 */

import {
  type MapperInfo,
  type MapperStatement,
  parseAllMapperFiles,
  buildTableMapperMap,
} from '../mybatis/index.js';
import {
  buildSqlLineage,
  getTableLineage,
  type SqlLineageEdge,
  type MapperMethodBinding,
} from '../mybatis/sql-lineage.js';
import {
  findDbTables,
  getDbTableContext,
  type DbTableNode,
  type DbTableContext,
} from '../query/index-service.js';

export interface DbTableEvidenceBundle {
  table: string;
  mapperBindings: MapperBinding[];
  sqlStatements: SqlStatementInfo[];
  relatedCode: RelatedCodeInfo[];
  fieldCandidates: FieldCandidate[];
  gaps: GapInfo[];
  provenance: {
    source: string;
    repoPath: string;
    generatedAt: string;
  };
}

export interface MapperBinding {
  namespace: string;
  methodId: string;
  statementType: 'select' | 'insert' | 'update' | 'delete';
  mapperFile: string;
}

export interface SqlStatementInfo {
  id: string;
  sql: string;
  statementType: string;
  tables: string[];
}

export interface RelatedCodeInfo {
  symbol: string;
  file: string;
  kind: 'caller' | 'class' | 'service';
  line?: number;
}

export interface FieldCandidate {
  name: string;
  type?: string;
  source: 'mapper' | 'code' | 'inferred';
}

export interface GapInfo {
  type: 'missing_mapper' | 'unmapped_field' | 'ambiguous_binding';
  description: string;
  evidence?: string;
}

/**
 * Build a comprehensive DB table evidence bundle.
 */
export async function buildDbTableBundle(
  repoPath: string,
  tableName: string,
): Promise<DbTableEvidenceBundle> {
  // Parse all mapper files
  const mappers = await parseAllMapperFiles(repoPath);
  const tableMap = await buildTableMapperMap(repoPath);

  // Build SQL lineage
  const mapperFiles = mappers.map((m) => m.filePath);
  const lineage = await buildSqlLineage(mapperFiles);

  // Get table lineage
  const tableLineage = getTableLineage(tableName, lineage.edges);

  // Get related mappers
  const relatedMappers = tableMap.get(tableName.toLowerCase()) || [];

  // Build mapper bindings
  const mapperBindings: MapperBinding[] = [];
  for (const mapper of relatedMappers) {
    for (const stmt of mapper.statements) {
      if (mapper.referencedTables.includes(tableName.toLowerCase())) {
        mapperBindings.push({
          namespace: mapper.namespace,
          methodId: stmt.id,
          statementType: stmt.type as 'select' | 'insert' | 'update' | 'delete',
          mapperFile: mapper.filePath,
        });
      }
    }
  }

  // Build SQL statements
  const sqlStatements: SqlStatementInfo[] = [];
  for (const mapper of relatedMappers) {
    for (const stmt of mapper.statements) {
      if (stmt.sql && mapper.referencedTables.includes(tableName.toLowerCase())) {
        sqlStatements.push({
          id: `${mapper.namespace}.${stmt.id}`,
          sql: stmt.sql,
          statementType: stmt.type,
          tables: mapper.referencedTables,
        });
      }
    }
  }

  // Build related code (callers)
  const relatedCode: RelatedCodeInfo[] = [];
  for (const method of tableLineage.methods) {
    const parts = method.split('.');
    relatedCode.push({
      symbol: method,
      file: '', // Would need code search to find actual file
      kind: 'caller',
    });
  }

  // Build field candidates (from SQL statements)
  const fieldCandidates: FieldCandidate[] = [];
  for (const stmt of sqlStatements) {
    // Extract field names from SQL
    const fields = extractFieldsFromSql(stmt.sql);
    for (const field of fields) {
      if (!fieldCandidates.find((f) => f.name === field)) {
        fieldCandidates.push({
          name: field,
          source: 'mapper',
        });
      }
    }
  }

  // Identify gaps
  const gaps: GapInfo[] = [];
  if (mapperBindings.length === 0) {
    gaps.push({
      type: 'missing_mapper',
      description: `No mapper bindings found for table ${tableName}`,
    });
  }

  return {
    table: tableName,
    mapperBindings,
    sqlStatements,
    relatedCode,
    fieldCandidates,
    gaps,
    provenance: {
      source: 'embedded-gitnexus',
      repoPath,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Extract field names from SQL statement.
 */
function extractFieldsFromSql(sql: string): string[] {
  const fields: string[] = [];

  // Match SELECT field
  const selectRegex = /SELECT\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s+/gi;
  const selectMatches = sql.matchAll(selectRegex);
  for (const match of selectMatches) {
    const fieldList = match[1];
    const fieldNames = fieldList.split(',').map((f) => f.trim().split('.').pop()!);
    for (const f of fieldNames) {
      if (f && !isSqlKeyword(f) && !f.startsWith('?')) {
        fields.push(f);
      }
    }
  }

  // Match INSERT fields
  const insertRegex = /INSERT\s+INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]+)\)/gi;
  const insertMatches = sql.matchAll(insertRegex);
  for (const match of insertMatches) {
    const fieldList = match[1];
    const fieldNames = fieldList.split(',').map((f) => f.trim());
    for (const f of fieldNames) {
      if (f && !isSqlKeyword(f)) {
        fields.push(f);
      }
    }
  }

  // Match UPDATE fields (SET field = value)
  const setRegex = /SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gi;
  const setMatches = sql.matchAll(setRegex);
  for (const match of setMatches) {
    const field = match[1];
    if (field && !isSqlKeyword(field)) {
      fields.push(field);
    }
  }

  return [...new Set(fields)];
}

/**
 * Check if a word is a SQL keyword.
 */
function isSqlKeyword(word: string): boolean {
  const keywords = [
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'like',
    'between', 'exists', 'null', 'true', 'false', 'case', 'when',
    'then', 'else', 'end', 'as', 'on', 'left', 'right', 'inner',
    'distinct', 'all', 'count', 'sum', 'avg', 'min', 'max',
    'values', 'set', 'into', 'default', 'primary', 'key',
  ];
  return keywords.includes(word.toLowerCase());
}

/**
 * Build all DB table bundles for a repository.
 */
export async function buildAllDbTableBundles(repoPath: string): Promise<DbTableEvidenceBundle[]> {
  const bundles: DbTableEvidenceBundle[] = [];

  // Get all tables from mappers
  const mappers = await parseAllMapperFiles(repoPath);
  const allTables: string[] = [];

  for (const mapper of mappers) {
    allTables.push(...mapper.referencedTables);
  }

  const uniqueTables = [...new Set(allTables)];

  for (const table of uniqueTables) {
    const bundle = await buildDbTableBundle(repoPath, table);
    bundles.push(bundle);
  }

  return bundles;
}

/**
 * Merge multiple bundles into a single comprehensive bundle.
 */
export function mergeDbTableBundles(bundles: DbTableEvidenceBundle[]): DbTableEvidenceBundle[] {
  // Group by table name
  const grouped = new Map<string, DbTableEvidenceBundle[]>();

  for (const bundle of bundles) {
    const existing = grouped.get(bundle.table) || [];
    existing.push(bundle);
    grouped.set(bundle.table, existing);
  }

  // Merge each group
  const merged: DbTableEvidenceBundle[] = [];

  for (const [table, tableBundles] of grouped) {
    merged.push({
      table,
      mapperBindings: tableBundles.flatMap((b) => b.mapperBindings),
      sqlStatements: tableBundles.flatMap((b) => b.sqlStatements),
      relatedCode: tableBundles.flatMap((b) => b.relatedCode),
      fieldCandidates: tableBundles.flatMap((b) => b.fieldCandidates),
      gaps: tableBundles.flatMap((b) => b.gaps),
      provenance: tableBundles[0].provenance,
    });
  }

  return merged;
}