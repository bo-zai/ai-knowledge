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

  // Join parts and normalize SQL with proper keyword boundaries
  const rawSql = resolvedParts.join(' ');
  return normalizeSql(rawSql);
}

/**
 * Normalize SQL string to ensure proper keyword and token boundaries.
 */
function normalizeSql(sql: string): string {
  // First, compress multiple whitespaces to single space
  let normalized = sql.replace(/\s+/g, ' ').trim();

  // Fix obvious keyword boundary issues where keywords are glued together
  // These are the most common patterns from include expansion
  const keywordGluePatterns: Array<{ pattern: RegExp; replacement: string }> = [
    // SELECT glued to next word
    { pattern: /SELECTFROM/gi, replacement: 'SELECT FROM' },
    { pattern: /SELECTJOIN/gi, replacement: 'SELECT ' },
    // FROM glued to next word
    { pattern: /FROMJOIN/gi, replacement: 'FROM JOIN' },
    { pattern: /FROMLEFT/gi, replacement: 'FROM LEFT' },
    { pattern: /FROMRIGHT/gi, replacement: 'FROM RIGHT' },
    { pattern: /FROMINNER/gi, replacement: 'FROM INNER' },
    // JOIN glued to ON
    { pattern: /JOINON/gi, replacement: 'JOIN ON' },
    // WHERE glued to condition keyword
    { pattern: /WHEREAND/gi, replacement: 'WHERE AND' },
    { pattern: /WHEREOR\b/gi, replacement: 'WHERE OR' }, // \b to not break 'order'
    // AND/OR glued together
    { pattern: /ANDOR\b/gi, replacement: 'AND OR' },
    { pattern: /ORAND\b/gi, replacement: 'OR AND' },
    // ORDER BY glued
    { pattern: /ORDERBY/gi, replacement: 'ORDER BY' },
    { pattern: /GROUPBY/gi, replacement: 'GROUP BY' },
    // INSERT INTO glued
    { pattern: /INSERTINTO/gi, replacement: 'INSERT INTO' },
    // Table name glued to WHERE (common MyBatis dynamic SQL issue)
    // Match: tablenamewhere -> tablename WHERE
    // Pattern: word + 'where' at word boundary -> word + ' WHERE'
    { pattern: /(\w)where\b/gi, replacement: '$1 WHERE' },
    // Table name glued to SET
    { pattern: /(\w)set\b/gi, replacement: '$1 SET' },
    // Table name glued to AND
    { pattern: /(\w)and\b/gi, replacement: '$1 AND' },
  ];

  for (const { pattern, replacement } of keywordGluePatterns) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Fix comma boundaries: ensure space after comma
  normalized = normalized.replace(/,([a-zA-Z_])/g, ', $1');

  // Final cleanup
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
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