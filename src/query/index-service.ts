/**
 * Index Service
 *
 * Provides index management and discovery operations for the embedded runtime.
 * This is the typed boundary for CLI generation and query operations.
 */

import { runFullAnalysis, type AnalyzeResult } from '../engine/analyze/run-analyze.js';
import { initLbug, executeQuery, closeLbug } from '../engine/lbug/lbug-adapter.js';
import { getStoragePaths, loadMeta } from '../engine/storage/repo-manager.js';

/**
 * Check if repo has an index.
 */
export async function hasIndex(repoPath: string): Promise<boolean> {
  try {
    const { storagePath } = getStoragePaths(repoPath);
    const meta = await loadMeta(storagePath);
    return meta !== null && meta.lastCommit !== undefined;
  } catch {
    return false;
  }
}

/**
 * Ensure embedded analysis index exists.
 * Runs analysis if no index is present.
 */
export async function ensureIndex(repoPath: string, options?: { force?: boolean }): Promise<void> {
  const indexed = await hasIndex(repoPath);
  if (indexed && !options?.force) return;
  await runAnalysis(repoPath, options);
}

/**
 * Run embedded analysis.
 */
export async function runAnalysis(repoPath: string, options?: { force?: boolean }): Promise<AnalyzeResult> {
  return runFullAnalysis(
    repoPath,
    {
      force: options?.force ?? false,
      embeddings: false,
      skipAgentsMd: true,
      noStats: true,
    },
    {
      onProgress: (phase, percent, message) => {
        // Silent progress - could log to console if needed
      },
      onLog: (message) => {
        // Silent log
      },
    },
  );
}

/**
 * Discovery result - structured slice seeds.
 */
export interface DiscoveryResult {
  routes: Array<{ id: string; method: string; path: string }>;
  processes: Array<{ id: string; name: string }>;
  tools: Array<{ id: string; name: string }>;
  communities: Array<{ id: string; name: string }>;
  tables: Array<{ id: string; name: string }>;
}

/**
 * Run slice discovery query.
 * Returns structured discovery result (not stdout text).
 */
export async function discoverSlices(repoPath: string): Promise<DiscoveryResult> {
  const { lbugPath } = getStoragePaths(repoPath);
  await initLbug(lbugPath);

  try {
    // Query each node label for slice discovery
    const routes: DiscoveryResult['routes'] = [];
    const processes: DiscoveryResult['processes'] = [];
    const tools: DiscoveryResult['tools'] = [];
    const communities: DiscoveryResult['communities'] = [];
    const tables: DiscoveryResult['tables'] = [];

    // For now, query known patterns for routes/processes/tools
    // Route pattern: functions/methods matching route handler signatures
    const routeCypher = `
      MATCH (n:Function) WHERE n.name =~ '(?i).*(route|handler|controller).*'
      RETURN n.name as name, n.filePath as filePath
    `;
    const routeResults = await executeQuery(routeCypher);
    for (const row of routeResults) {
      // Parse route pattern from name (e.g., "GET /api/users")
      const name = row.name as string;
      const routeMatch = name.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i);
      if (routeMatch) {
        routes.push({
          id: `route:${routeMatch[1]}:${routeMatch[2]}`,
          method: routeMatch[1].toUpperCase(),
          path: routeMatch[2],
        });
      }
    }

    // Process pattern: functions with specific naming
    const processCypher = `
      MATCH (n:Function) WHERE n.name =~ '(?i).*(process|workflow|flow).*'
      RETURN n.name as name, n.filePath as filePath
    `;
    const processResults = await executeQuery(processCypher);
    for (const row of processResults) {
      const name = row.name as string;
      processes.push({
        id: `process:${name}`,
        name,
      });
    }

    // Tool pattern: utility classes/functions
    const toolCypher = `
      MATCH (n:Class) WHERE n.name =~ '(?i).*(tool|util|helper|service).*'
      RETURN n.name as name, n.filePath as filePath
    `;
    const toolResults = await executeQuery(toolCypher);
    for (const row of toolResults) {
      const name = row.name as string;
      tools.push({
        id: `tool:${name}`,
        name,
      });
    }

    // Community pattern: modules/packages
    const communityCypher = `
      MATCH (n:Community) RETURN n.name as name, n.members as members
    `;
    const communityResults = await executeQuery(communityCypher);
    for (const row of communityResults) {
      const name = row.name as string;
      communities.push({
        id: `community:${name}`,
        name,
      });
    }

    // Table pattern: database-related classes
    const tableCypher = `
      MATCH (n:Class) WHERE n.name =~ '(?i).*(table|entity|dao|mapper).*'
      RETURN n.name as name
    `;
    const tableResults = await executeQuery(tableCypher);
    for (const row of tableResults) {
      const name = row.name as string;
      tables.push({
        id: `table:${name.toLowerCase()}`,
        name: name.toLowerCase(),
      });
    }

    return { routes, processes, tools, communities, tables };
  } finally {
    await closeLbug();
  }
}

// ============================================
// Query Service Operations (moved from query-service.ts)
// ============================================

export interface QueryServiceOptions {
  repoPath: string;
  skipIndexCheck?: boolean;
}

/**
 * Initialize query service for a repository.
 * Ensures the repo has an index and returns a connection.
 */
export async function initQueryService(repoPath: string): Promise<void> {
  const indexed = await hasIndex(repoPath);
  if (!indexed) {
    await ensureIndex(repoPath);
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
 * Uses statement-scoped table extraction.
 */
export async function findMapperFilesForTable(repoPath: string, tableName: string): Promise<string[]> {
  // Use MyBatis parser for mapper discovery with statement-scoped extraction
  const { findMapperFiles, parseMapperFile, resolveStatementSql, extractTablesFromSql } = await import('../mybatis/index.js');
  const mapperFiles = await findMapperFiles(repoPath);
  const matchingFiles: string[] = [];

  for (const mapperFile of mapperFiles) {
    const mapper = await parseMapperFile(mapperFile);
    if (mapper) {
      // Check each statement individually (statement-scoped)
      for (const stmt of mapper.statements) {
        const resolved = resolveStatementSql(stmt, mapper);
        const tables = extractTablesFromSql(resolved.sql);
        if (tables.includes(tableName.toLowerCase())) {
          matchingFiles.push(mapperFile);
          break; // Don't add same file multiple times
        }
      }
    }
  }

  return matchingFiles;
}