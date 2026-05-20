/**
 * Include Resolver
 *
 * Resolves <include refid="..."> fragments into final SQL.
 */

import type { StatementDraft, SqlFragment, MapperDocument, ResolvedStatement } from './types.js';

/**
 * Resolve all include references in a statement and produce final SQL.
 */
export function resolveStatementSql(
  statement: StatementDraft,
  mapper: MapperDocument,
  visited: Set<string> = new Set()
): ResolvedStatement {
  const fragmentRefs: string[] = [];
  const sql = resolveSqlParts(statement.rawSqlParts, mapper.sqlFragments, fragmentRefs, visited);

  return {
    id: statement.id,
    type: statement.type,
    namespace: mapper.namespace,
    mapperFile: mapper.filePath,
    sql,
    fragmentRefs,
    parameterType: statement.parameterType,
    resultType: statement.resultType,
    resultMap: statement.resultMap,
  };
}

/**
 * Resolve SQL parts recursively, expanding includes.
 */
function resolveSqlParts(
  parts: Array<{ kind: 'text' | 'include'; value: string }>,
  fragments: SqlFragment[],
  collectedRefs: string[],
  visited: Set<string>
): string {
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (part.kind === 'text') {
      resolvedParts.push(part.value);
    } else if (part.kind === 'include') {
      const refid = part.value;

      // Prevent circular references
      if (visited.has(refid)) {
        resolvedParts.push(`<!-- circular ref: ${refid} -->`);
        continue;
      }

      collectedRefs.push(refid);
      visited.add(refid);

      // Find the fragment
      const fragment = fragments.find((f) => f.id === refid);
      if (fragment) {
        // Recursively resolve nested includes in fragment
        const nestedSql = resolveSqlParts(fragment.rawSqlParts, fragments, collectedRefs, visited);
        resolvedParts.push(nestedSql);
      } else {
        resolvedParts.push(`<!-- missing fragment: ${refid} -->`);
      }

      visited.delete(refid);
    }
  }

  return resolvedParts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve all statements in a mapper document.
 */
export function resolveAllStatements(mapper: MapperDocument): ResolvedStatement[] {
  return mapper.statements.map((stmt) => resolveStatementSql(stmt, mapper));
}

/**
 * Get fragment by ID from mapper.
 */
export function getFragmentById(mapper: MapperDocument, id: string): SqlFragment | null {
  return mapper.sqlFragments.find((f) => f.id === id) || null;
}