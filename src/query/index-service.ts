/**
 * Query Index Service
 *
 * Provides high-level query operations for the embedded GitNexus runtime.
 * Used by generate.ts and other consumers to discover and query code knowledge.
 */

import { initLbug, executeQuery, closeLbug } from '../engine/lbug/lbug-adapter.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';
import { checkEmbeddedIndex, ensureEmbeddedIndex } from '../knowledge/embedded-adapter.js';

export interface QueryServiceOptions {
  repoPath: string;
  skipIndexCheck?: boolean;
}

/**
 * Initialize query service for a repository.
 * Ensures the repo has an index and returns a connection.
 */
export async function initQueryService(repoPath: string): Promise<void> {
  const indexed = await checkEmbeddedIndex(repoPath);
  if (!indexed) {
    await ensureEmbeddedIndex(repoPath);
  }
}

/**
 * Execute a Cypher query against the embedded runtime.
 */
export async function runCypherQuery(repoPath: string, cypher: string, limit?: number): Promise<any[]> {
  const { lbugPath } = getStoragePaths(repoPath);

  await initLbug(lbugPath);

  const query = limit ? `${cypher} LIMIT ${limit}` : cypher;

  try {
    return await executeQuery(query);
  } finally {
    await closeLbug();
  }
}

/**
 * Find all database table references in the code.
 */
export async function findDbTables(repoPath: string, limit?: number): Promise<DbTableNode[]> {
  const cypher = `
    MATCH (n:Class) WHERE n.name =~ '(?i).*(table|entity|dao)$'
    RETURN n.tableName as tableName, n.name as name, n.filePath as filePath, 'Class' as kind
    UNION ALL
    MATCH (n:Interface) WHERE n.name =~ '(?i).*(table|entity|dao)$'
    RETURN n.tableName as tableName, n.name as name, n.filePath as filePath, 'Interface' as kind
    ORDER BY tableName
  `;

  const results = await runCypherQuery(repoPath, cypher, limit);
  return results.map((row) => ({
    tableName: row.tableName || row.name,
    name: row.name,
    filePath: row.filePath,
    kind: row.kind,
  }));
}

export interface DbTableNode {
  tableName: string;
  name: string;
  filePath: string;
  kind: string;
}

/**
 * Get context for a specific database table (related code, queries, etc).
 */
export async function getDbTableContext(repoPath: string, tableName: string): Promise<DbTableContext> {
  // LadybugDB doesn't support `Function|Method` syntax; query each label separately
  const callers: Array<{ name: string; filePath: string }> = [];
  const classes: Array<{ name: string; filePath: string }> = [];
  const fields: string[] = [];

  // Find methods that reference this table
  for (const label of ['Function', 'Method']) {
    const cypher = `
      MATCH (f:${label})-[:ACCESSES]->(t)
      WHERE t.name = '${tableName.replace(/'/g, "''")}'
      RETURN f.name as name, f.filePath as filePath
    `;
    const results = await runCypherQuery(repoPath, cypher);
    for (const row of results) {
      callers.push({ name: row.name, filePath: row.filePath });
    }
  }

  return {
    tableName,
    callers,
    classes,
    fields,
    queries: [],
  };
}

export interface DbTableContext {
  tableName: string;
  callers: Array<{ name: string; filePath: string }>;
  classes: Array<{ name: string; filePath: string }>;
  fields: string[];
  queries: string[];
}

/**
 * Find mapper.xml files that reference a table.
 */
export async function findMapperFilesForTable(repoPath: string, tableName: string): Promise<string[]> {
  // Use MyBatis parser for mapper discovery instead of Cypher regex
  const { findMapperFiles, parseMapperFile } = await import('../mybatis/index.js');
  const mapperFiles = await findMapperFiles(repoPath);
  const matchingFiles: string[] = [];

  for (const mapperFile of mapperFiles) {
    const info = await parseMapperFile(mapperFile);
    if (info && info.referencedTables.includes(tableName)) {
      matchingFiles.push(mapperFile);
    }
  }

  return matchingFiles;
}