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
  resolveStatementSql,
  extractTablesFromSql,
  type MapperDocument,
  type StatementDraft,
  type ResolvedStatement,
} from "./index.js";
import type { DbTableContext } from "../query/index-service.js";

export interface SqlLineageEdge {
  type: "QUERIES" | "ACCESSES";
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
  statements: ResolvedStatement[];
}

/**
 * Build lineage edges from mapper document.
 */
export function buildLineageEdges(mapper: MapperDocument): SqlLineageEdge[] {
  const edges: SqlLineageEdge[] = [];
  const namespace = mapper.namespace;

  // Resolve all statements first
  const resolvedStatements = mapper.statements.map((stmt) =>
    resolveStatementSql(stmt, mapper),
  );

  for (const stmt of resolvedStatements) {
    // Create method-to-statement edge
    edges.push({
      type: "QUERIES",
      from: `${namespace}.${stmt.id}`,
      to: `sql:${stmt.id}`,
      evidence: {
        mapperFile: mapper.filePath,
        statementId: stmt.id,
        statementType: stmt.type,
        sql: stmt.sql,
      },
    });

    // Create statement-to-table edges (statement-scoped)
    const tables = extractTablesFromSql(stmt.sql);
    for (const table of tables) {
      edges.push({
        type: "ACCESSES",
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
 * Build mapper method bindings for Java-to-SQL linkage.
 */
export function buildMapperMethodBindings(
  mapper: MapperDocument,
): MapperMethodBinding[] {
  const bindings: MapperMethodBinding[] = [];
  const namespace = mapper.namespace;

  // Parse namespace to get Java class name
  const javaClass = namespace;

  // Resolve all statements
  const resolvedStatements = mapper.statements.map((stmt) =>
    resolveStatementSql(stmt, mapper),
  );

  for (const stmt of resolvedStatements) {
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
    if (statements.includes(edge.to) && edge.type === "QUERIES") {
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
    queries: lineage.statements.map((s) => s.replace("sql:", "")),
  };
}

/**
 * Extract tables from a resolved statement (statement-scoped).
 */
export function extractTablesFromResolvedStatement(
  stmt: ResolvedStatement,
): string[] {
  return extractTablesFromSql(stmt.sql);
}
