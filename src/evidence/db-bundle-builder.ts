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
  directStatements: SqlStatementInfo[];
  joinedStatements: SqlStatementInfo[];
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
  accessType: 'direct' | 'joined';
}

export interface SqlStatementInfo {
  id: string;
  sql: string;
  statementType: string;
  tables: string[];
  fragmentRefs: string[];
  accessType: 'direct' | 'joined';
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
  clauseType?: 'select' | 'insert' | 'update' | 'where' | 'join' | 'order_by';
  sqlAlias?: string;
  tablePrefix?: string;
  mappedJavaProperty?: string;
  javaFieldComment?: string;
  javaType?: string;
  typeSource?: 'resultMap' | 'resultType' | 'insertParam' | 'updateParam' | 'sqlInferred';
  sourceStatementId?: string;
  sourceMapper?: string;
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

  // Build mapper bindings (statement-scoped, with access type)
  const mapperBindings: MapperBinding[] = [];
  for (const { mapper, resolved, accessType } of tableMappers) {
    mapperBindings.push({
      namespace: mapper.namespace,
      methodId: resolved.id,
      statementType: resolved.type as 'select' | 'insert' | 'update' | 'delete',
      mapperFile: mapper.filePath,
      resultType: resolved.resultType,
      resultMap: resolved.resultMap,
      accessType,
    });
  }

  // Build SQL statements (statement-scoped, with access type)
  const sqlStatements: SqlStatementInfo[] = [];
  const directStatements: SqlStatementInfo[] = [];
  const joinedStatements: SqlStatementInfo[] = [];
  for (const { mapper, resolved, accessType } of tableMappers) {
    const stmtInfo: SqlStatementInfo = {
      id: `${mapper.namespace}.${resolved.id}`,
      sql: resolved.sql,
      statementType: resolved.type,
      tables: extractTablesFromSql(resolved.sql),
      fragmentRefs: resolved.fragmentRefs,
      accessType,
    };
    sqlStatements.push(stmtInfo);
    if (accessType === 'direct') {
      directStatements.push(stmtInfo);
    } else {
      joinedStatements.push(stmtInfo);
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

  // Define strong clause types (should be in main field list)
  const strongClauseTypes = ['select', 'insert', 'update'];

  // First, extract from SQL
  for (const stmtInfo of sqlStatements) {
    // Parse statement ID to get mapper namespace
    const statementId = stmtInfo.id.split('.').pop() || stmtInfo.id;
    const mapperNamespace = stmtInfo.id.split('.').slice(0, -1).join('.') || '';

    const detailedFields = extractDetailedFieldsFromSql(
      stmtInfo.sql,
      statementId,
      mapperNamespace
    );
    for (const field of detailedFields) {
      const existing = fieldCandidates.find((f) => f.name === field.name);
      if (!existing) {
        fieldCandidates.push(field);
      } else {
        // Merge additional info, but prefer strong clause types
        if (field.sqlAlias && !existing.sqlAlias) existing.sqlAlias = field.sqlAlias;
        if (field.tablePrefix && !existing.tablePrefix) existing.tablePrefix = field.tablePrefix;
        // Only upgrade clause type if new one is stronger
        if (field.clauseType && strongClauseTypes.includes(field.clauseType)) {
          if (!existing.clauseType || !strongClauseTypes.includes(existing.clauseType)) {
            existing.clauseType = field.clauseType;
            existing.sourceStatementId = field.sourceStatementId;
            existing.sourceMapper = field.sourceMapper;
          }
        }
        // Keep source info from first encounter
        if (!existing.sourceStatementId && field.sourceStatementId) {
          existing.sourceStatementId = field.sourceStatementId;
        }
        if (!existing.sourceMapper && field.sourceMapper) {
          existing.sourceMapper = field.sourceMapper;
        }
      }
    }
  }

  // Then, merge entity evidence into field candidates
  for (const entity of entityEvidence) {
    for (const entityField of entity.fields) {
      const existing = fieldCandidates.find(
        (f) => f.name === entityField.mappedColumn || f.sqlAlias === entityField.javaProperty
      );
      if (existing) {
        // Add Java property mapping
        existing.mappedJavaProperty = entityField.javaProperty;
        existing.javaFieldComment = entityField.javaFieldComment;
        // Add Java type if available
        if (entityField.javaFieldType) {
          existing.javaType = entityField.javaFieldType;
          existing.typeSource = entity.sourceStatementId.includes('select')
            ? 'resultMap'
            : entity.sourceStatementId.includes('insert')
            ? 'insertParam'
            : entity.sourceStatementId.includes('update')
            ? 'updateParam'
            : 'resultType';
        }
      } else if (entityField.mappedColumn) {
        // Add field from entity mapping that wasn't in SQL
        fieldCandidates.push({
          name: entityField.mappedColumn,
          source: 'entity',
          mappedJavaProperty: entityField.javaProperty,
          javaFieldComment: entityField.javaFieldComment,
          javaType: entityField.javaFieldType,
          typeSource: 'resultMap',
          sourceStatementId: entity.sourceStatementId,
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
    directStatements,
    joinedStatements,
    relatedCode,
    fieldCandidates,
    entityEvidence,
    callerEvidence,
    gaps,
    provenance: {
      source: 'embedded-analysis',
      repoPath,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Find all mapper/statement pairs that touch a specific table.
 * Statement-scoped: only includes statements that actually reference the table.
 * Returns resolved statements with access type classification.
 */
function findTableMappers(
  mappers: MapperDocument[],
  tableName: string
): Array<{ mapper: MapperDocument; resolved: ResolvedStatement; accessType: 'direct' | 'joined' }> {
  const result: Array<{ mapper: MapperDocument; resolved: ResolvedStatement; accessType: 'direct' | 'joined' }> = [];

  for (const mapper of mappers) {
    for (const draft of mapper.statements) {
      const resolved = resolveStatementSql(draft, mapper);
      const tables = extractTablesFromSql(resolved.sql);

      // Only include if this specific statement touches the target table
      if (tables.includes(tableName)) {
        const accessType = classifyTableAccessType(resolved.sql, tableName, resolved.type);
        result.push({ mapper, resolved, accessType });
      }
    }
  }

  return result;
}

/**
 * Classify whether a table is accessed directly or via join.
 * - Direct: table appears in FROM clause (main target)
 * - Joined: table only appears in JOIN clause (joined for reference)
 * - INSERT/UPDATE/DELETE are always direct
 */
function classifyTableAccessType(
  sql: string,
  tableName: string,
  statementType: string
): 'direct' | 'joined' {
  // INSERT/UPDATE/DELETE are always direct
  if (statementType === 'insert' || statementType === 'update' || statementType === 'delete') {
    return 'direct';
  }

  // For SELECT, check FROM clause vs JOIN clause
  const lowerSql = sql.toLowerCase();
  const lowerTable = tableName.toLowerCase();

  // Check if table appears in FROM clause
  const fromRegex = /FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(?:\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(?:\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*/gi;
  const fromMatch = lowerSql.match(fromRegex);

  if (fromMatch) {
    // Check if target table is in FROM clause (before any JOIN)
    const fromClause = fromMatch[0];
    const beforeJoin = fromClause.split(/\s+(?:left|right|inner|outer|cross|natural)?\s*join/i)[0];
    if (beforeJoin.includes(lowerTable)) {
      return 'direct';
    }
  }

  // Check if table appears in JOIN clause
  const joinRegex = /JOIN\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(?:\s+[a-zA-Z_][a-zA-Z0-9_]*)?\s+ON/gi;
  const joinMatches = lowerSql.matchAll(joinRegex);
  for (const match of joinMatches) {
    if (match[0].toLowerCase().includes(lowerTable)) {
      return 'joined';
    }
  }

  // Default to direct if table appears somewhere but classification unclear
  return 'direct';
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
function extractDetailedFieldsFromSql(
  sql: string,
  statementId?: string,
  mapperNamespace?: string
): FieldCandidate[] {
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
          sourceStatementId: statementId,
          sourceMapper: mapperNamespace,
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
        sourceStatementId: statementId,
        sourceMapper: mapperNamespace,
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
          sourceStatementId: statementId,
          sourceMapper: mapperNamespace,
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
        sourceStatementId: statementId,
        sourceMapper: mapperNamespace,
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
        sourceStatementId: statementId,
        sourceMapper: mapperNamespace,
      });
    }
  }

  // Match ORDER BY fields
  const orderByRegex = /ORDER\s+BY\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi;
  const orderByMatches = sql.matchAll(orderByRegex);
  for (const match of orderByMatches) {
    const fieldPart = match[1];
    const parts = fieldPart.split('.');
    const tablePrefix = parts.length > 1 ? parts[0] : undefined;
    const fieldName = parts[parts.length - 1];
    if (fieldName && !isSqlKeyword(fieldName) && fieldName !== 'desc' && fieldName !== 'asc') {
      fields.push({
        name: fieldName,
        source: 'mapper',
        clauseType: 'order_by',
        tablePrefix,
        sourceStatementId: statementId,
        sourceMapper: mapperNamespace,
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
      directStatements: tableBundles.flatMap((b) => b.directStatements),
      joinedStatements: tableBundles.flatMap((b) => b.joinedStatements),
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