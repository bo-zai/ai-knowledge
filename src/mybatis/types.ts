/**
 * MyBatis Evidence Types
 *
 * Shared type definitions for MyBatis evidence pipeline.
 * These types support statement-scoped DB knowledge generation.
 */

/**
 * SQL part representation - preserves structure for include resolution.
 */
export interface SqlPart {
  kind: 'text' | 'include';
  value: string;
}

/**
 * Draft statement before include resolution.
 * Preserves raw SQL parts for downstream fragment expansion.
 */
export interface StatementDraft {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete';
  rawSqlParts: SqlPart[];
  includeRefs: string[];
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}

/**
 * SQL fragment definition from <sql id="...">.
 */
export interface SqlFragment {
  id: string;
  rawSqlParts: SqlPart[];
}

/**
 * ResultMap definition with property/column mappings.
 */
export interface ResultMapDef {
  id: string;
  type?: string;
  mappings: Array<{ property: string; column: string }>;
}

/**
 * Complete mapper document with all extracted elements.
 */
export interface MapperDocument {
  filePath: string;
  namespace: string;
  statements: StatementDraft[];
  sqlFragments: SqlFragment[];
  resultMaps: ResultMapDef[];
}

/**
 * Resolved statement after include expansion.
 */
export interface ResolvedStatement {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete';
  namespace: string;
  mapperFile: string;
  sql: string;
  fragmentRefs: string[];
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}

/**
 * Statement-level table reference.
 */
export interface StatementTableRef {
  namespace: string;
  mapperFile: string;
  statementId: string;
  statementType: 'select' | 'insert' | 'update' | 'delete';
  sql: string;
  tables: string[];
}

/**
 * Statement-level field reference.
 */
export interface StatementFieldRef {
  table: string;
  fieldName: string;
  clauseType: 'select' | 'insert' | 'update' | 'where' | 'join';
  sourceStatementId: string;
  sqlAlias?: string;
  fragmentSource?: string;
}

/**
 * Java entity evidence from resultType/resultMap.
 */
export interface EntityEvidence {
  sourceStatementId: string;
  javaType: string;
  javaFile: string;
  classComment?: string;
  fields: Array<{
    javaProperty: string;
    javaFieldName: string;
    javaFieldType?: string;
    javaFieldComment?: string;
    mappedColumn?: string;
  }>;
}

/**
 * Java caller evidence from Service/Controller classes.
 */
export interface CallerEvidence {
  sourceStatementId: string;
  callerMethod: string;
  callerClass: string;
  callerFile: string;
  callSiteSnippet?: string;
  nearbyComments: string[];
  businessHints: string[];
}

/**
 * Mapper method binding info.
 */
export interface MapperMethodBinding {
  namespace: string;
  methodId: string;
  javaMapperClass: string;
  javaMapperFile: string;
  javaMethod: string;
}

/**
 * DB table evidence bundle - complete evidence for single-table generation.
 */
export interface DbTableEvidenceBundle {
  table: string;
  mapperBindings: MapperMethodBinding[];
  sqlStatements: Array<{
    id: string;
    sql: string;
    statementType: 'select' | 'insert' | 'update' | 'delete';
    tables: string[];
    fragmentRefs: string[];
  }>;
  fieldCandidates: Array<{
    dbField: string;
    sqlAlias?: string;
    sourceStatementId: string;
    sourceKind: 'mapper' | 'entity' | 'caller' | 'inferred';
    fragmentSource?: string;
    mappedJavaProperty?: string;
    javaFieldComment?: string;
    callerHints: string[];
  }>;
  entityEvidence: EntityEvidence[];
  callerEvidence: CallerEvidence[];
  gaps: GapInfo[];
  provenance: {
    source: string;
    repoPath: string;
    generatedAt: string;
  };
}

/**
 * Gap information for missing evidence.
 */
export interface GapInfo {
  type: 'missing_entity' | 'missing_caller' | 'missing_fragment' | 'unresolved_column';
  description: string;
  context?: string;
}