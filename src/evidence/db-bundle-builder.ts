/**
 * DB Table Context Bundle Builder
 *
 * Builds comprehensive evidence bundles for database tables,
 * integrating mapper bindings, SQL statements, and related code.
 * Uses statement-scoped table extraction (not mapper-level).
 */

import {
  type MapperDocument,
  type ResolvedStatement,
  type EntityEvidence,
  type CallerEvidence,
  parseAllMapperFiles,
  resolveStatementSql,
  extractTablesFromSql,
  findResultMap,
  resolveEntityEvidence,
  resolveCallerEvidence,
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
  entityEvidence: EntityEvidence[];
  callerEvidence: CallerEvidence[];
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
  resultType?: string;
  resultMap?: string;
}

export interface SqlStatementInfo {
  id: string;
  sql: string;
  statementType: string;
  tables: string[];
  fragmentRefs: string[];
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
  source: 'mapper' | 'code' | 'entity' | 'inferred';
  clauseType?: 'select' | 'insert' | 'update' | 'where' | 'join';
  sqlAlias?: string;
  tablePrefix?: string;
  mappedJavaProperty?: string;
  javaFieldComment?: string;
}

export interface GapInfo {
  type: 'missing_mapper' | 'unmapped_field' | 'ambiguous_binding';
  description: string;
  evidence?: string;
}

/**
 * Build a comprehensive DB table evidence bundle.
 * Uses statement-scoped table extraction.
 */
export async function buildDbTableBundle(
  repoPath: string,
  tableName: string,
  coreRepoPath?: string,
): Promise<DbTableEvidenceBundle> {
  // Parse all mapper files
  const mappers = await parseAllMapperFiles(repoPath);

  // Build SQL lineage
  const mapperFiles = mappers.map((m) => m.filePath);
  const lineage = await buildSqlLineage(mapperFiles);

  // Get table lineage
  const tableLineage = getTableLineage(tableName, lineage.edges);

  // Find statements that actually touch this table (statement-scoped)
  const tableMappers = findTableMappers(mappers, tableName.toLowerCase());

  // Build mapper bindings (statement-scoped)
  const mapperBindings: MapperBinding[] = [];
  for (const { mapper, resolved } of tableMappers) {
    mapperBindings.push({
      namespace: mapper.namespace,
      methodId: resolved.id,
      statementType: resolved.type as 'select' | 'insert' | 'update' | 'delete',
      mapperFile: mapper.filePath,
      resultType: resolved.resultType,
      resultMap: resolved.resultMap,
    });
  }

  // Build SQL statements (statement-scoped)
  const sqlStatements: SqlStatementInfo[] = [];
  for (const { mapper, resolved } of tableMappers) {
    sqlStatements.push({
      id: `${mapper.namespace}.${resolved.id}`,
      sql: resolved.sql,
      statementType: resolved.type,
      tables: extractTablesFromSql(resolved.sql),
      fragmentRefs: resolved.fragmentRefs,
    });
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

  // Collect entity evidence from resultType/resultMap
  const entityEvidence: EntityEvidence[] = [];
  for (const { mapper, resolved } of tableMappers) {
    if (resolved.resultType || resolved.resultMap) {
      const resultMapDef = resolved.resultMap ? findResultMap(mapper, resolved.resultMap) : null;
      const evidence = await resolveEntityEvidence({
        repoPath,
        coreRepoPath,
        resultType: resolved.resultType,
        resultMap: resultMapDef,
      });

      if (evidence) {
        evidence.sourceStatementId = resolved.id;
        entityEvidence.push(evidence);
      }
    }
  }

  // Build field candidates (from SQL statements and entity evidence)
  const fieldCandidates: FieldCandidate[] = [];

  // First, extract from SQL
  for (const stmtInfo of sqlStatements) {
    const detailedFields = extractDetailedFieldsFromSql(stmtInfo.sql);
    for (const field of detailedFields) {
      const existing = fieldCandidates.find((f) => f.name === field.name);
      if (!existing) {
        fieldCandidates.push(field);
      } else {
        // Merge additional info
        if (field.sqlAlias && !existing.sqlAlias) existing.sqlAlias = field.sqlAlias;
        if (field.tablePrefix && !existing.tablePrefix) existing.tablePrefix = field.tablePrefix;
        if (field.clauseType && !existing.clauseType) existing.clauseType = field.clauseType;
      }
    }
  }

  // Then, merge entity evidence into field candidates
  for (const entity of entityEvidence) {
    for (const entityField of entity.fields) {
      const existing = fieldCandidates.find((f) => f.name === entityField.mappedColumn || f.sqlAlias === entityField.javaProperty);
      if (existing) {
        // Add Java property mapping
        existing.mappedJavaProperty = entityField.javaProperty;
        existing.javaFieldComment = entityField.javaFieldComment;
      } else if (entityField.mappedColumn) {
        // Add field from entity mapping that wasn't in SQL
        fieldCandidates.push({
          name: entityField.mappedColumn,
          source: 'entity',
          mappedJavaProperty: entityField.javaProperty,
          javaFieldComment: entityField.javaFieldComment,
        });
      }
    }
  }

  // Collect caller evidence from Service classes
  const callerEvidence: CallerEvidence[] = [];
  for (const { mapper, resolved } of tableMappers) {
    const callers = await resolveCallerEvidence({
      repoPath,
      namespace: mapper.namespace,
      methodId: resolved.id,
    });
    for (const caller of callers) {
      caller.sourceStatementId = resolved.id;
      callerEvidence.push(caller);
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
    entityEvidence,
    callerEvidence,
    gaps,
    provenance: {
      source: 'embedded-gitnexus',
      repoPath,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Find all mapper/statement pairs that touch a specific table.
 * Statement-scoped: only includes statements that actually reference the table.
 * Returns resolved statements ready for use.
 */
function findTableMappers(
  mappers: MapperDocument[],
  tableName: string
): Array<{ mapper: MapperDocument; resolved: ResolvedStatement }> {
  const result: Array<{ mapper: MapperDocument; resolved: ResolvedStatement }> = [];

  for (const mapper of mappers) {
    for (const draft of mapper.statements) {
      const resolved = resolveStatementSql(draft, mapper);
      const tables = extractTablesFromSql(resolved.sql);

      // Only include if this specific statement touches the target table
      if (tables.includes(tableName)) {
        result.push({ mapper, resolved });
      }
    }
  }

  return result;
}

/**
 * Extract field names from SQL statement with detailed info.
 */
function extractFieldsFromSql(sql: string): string[] {
  const detailedFields = extractDetailedFieldsFromSql(sql);
  return detailedFields.map((f) => f.name);
}

/**
 * Extract detailed field info from SQL statement.
 */
function extractDetailedFieldsFromSql(sql: string): FieldCandidate[] {
  const fields: FieldCandidate[] = [];

  // Match SELECT fields (handle aliases and table.field patterns)
  const selectRegex = /SELECT\s+([\w\.\s,\(\)]+?)\s+FROM/gi;
  const selectMatches = sql.matchAll(selectRegex);
  for (const match of selectMatches) {
    const fieldList = match[1];
    // Split by comma and extract field names
    const parts = fieldList.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '*') continue;

      // Handle "field alias" or "table.field alias" patterns
      const tokens = trimmed.split(/\s+/);
      // First token may have table.field format
      const firstToken = tokens[0];

      // Parse table.field pattern
      const fieldParts = firstToken.split('.');
      const tablePrefix = fieldParts.length > 1 ? fieldParts[0] : undefined;
      const fieldName = fieldParts[fieldParts.length - 1];

      if (fieldName && !isSqlKeyword(fieldName) && !fieldName.startsWith('?') && fieldName !== '*') {
        // Check if there's an alias (last token different from first)
        const sqlAlias = tokens.length > 1 && tokens[tokens.length - 1] !== fieldName
          ? tokens[tokens.length - 1]
          : undefined;

        fields.push({
          name: fieldName,
          source: 'mapper',
          clauseType: 'select',
          sqlAlias,
          tablePrefix,
        });
      }
    }
  }

  // Match JOIN ON fields
  const joinOnRegex = /JOIN\s+[a-zA-Z_][a-zA-Z0-9_]*\s+[a-zA-Z_][a-zA-Z0-9_]*\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*=/gi;
  const joinOnMatches = sql.matchAll(joinOnRegex);
  for (const match of joinOnMatches) {
    const fieldPart = match[1];
    const parts = fieldPart.split('.');
    const tablePrefix = parts[0];
    const fieldName = parts[1];
    if (fieldName && !isSqlKeyword(fieldName)) {
      fields.push({
        name: fieldName,
        source: 'mapper',
        clauseType: 'join',
        tablePrefix,
      });
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
        fields.push({
          name: f,
          source: 'mapper',
          clauseType: 'insert',
        });
      }
    }
  }

  // Match UPDATE fields (SET field = value)
  const setRegex = /SET\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*=/gi;
  const setMatches = sql.matchAll(setRegex);
  for (const match of setMatches) {
    const fieldPart = match[1];
    const parts = fieldPart.split('.');
    const tablePrefix = parts.length > 1 ? parts[0] : undefined;
    const fieldName = parts[parts.length - 1];
    if (fieldName && !isSqlKeyword(fieldName)) {
      fields.push({
        name: fieldName,
        source: 'mapper',
        clauseType: 'update',
        tablePrefix,
      });
    }
  }

  // Match WHERE fields (field = value)
  const whereRegex = /WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*=/gi;
  const whereMatches = sql.matchAll(whereRegex);
  for (const match of whereMatches) {
    const fieldPart = match[1];
    const parts = fieldPart.split('.');
    const tablePrefix = parts.length > 1 ? parts[0] : undefined;
    const fieldName = parts[parts.length - 1];
    if (fieldName && !isSqlKeyword(fieldName)) {
      fields.push({
        name: fieldName,
        source: 'mapper',
        clauseType: 'where',
        tablePrefix,
      });
    }
  }

  // Deduplicate by name (keep the one with most info)
  const uniqueFields = new Map<string, FieldCandidate>();
  for (const f of fields) {
    const existing = uniqueFields.get(f.name);
    if (!existing || (f.sqlAlias && !existing.sqlAlias) || (f.tablePrefix && !existing.tablePrefix)) {
      uniqueFields.set(f.name, f);
    }
  }

  return [...uniqueFields.values()];
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
    'order', 'group', 'having', 'limit', 'offset', 'by', 'desc', 'asc',
    'join', 'outer', 'full', 'cross', 'natural', 'using',
  ];
  return keywords.includes(word.toLowerCase());
}

/**
 * Build all DB table bundles for a repository.
 */
export async function buildAllDbTableBundles(repoPath: string): Promise<DbTableEvidenceBundle[]> {
  const bundles: DbTableEvidenceBundle[] = [];

  // Parse all mappers
  const mappers = await parseAllMapperFiles(repoPath);

  // Collect all tables from all statements (statement-scoped)
  const allTables: Set<string> = new Set();

  for (const mapper of mappers) {
    for (const draft of mapper.statements) {
      const resolved = resolveStatementSql(draft, mapper);
      const tables = extractTablesFromSql(resolved.sql);
      for (const table of tables) {
        allTables.add(table);
      }
    }
  }

  for (const table of allTables) {
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
      entityEvidence: tableBundles.flatMap((b) => b.entityEvidence),
      callerEvidence: tableBundles.flatMap((b) => b.callerEvidence),
      gaps: tableBundles.flatMap((b) => b.gaps),
      provenance: tableBundles[0].provenance,
    });
  }

  return merged;
}