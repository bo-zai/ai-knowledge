/**
 * Embedded GitNexus Runtime Adapter
 *
 * Replaces external gitnexus CLI calls with embedded engine calls.
 * Provides the same interface expected by generate.ts and status.ts.
 */

import { runFullAnalysis, type AnalyzeResult } from '../engine/analyze/run-analyze.js';
import { initLbug, executeQuery, closeLbug } from '../engine/lbug/lbug-adapter.js';
import { getStoragePaths, loadMeta } from '../engine/storage/repo-manager.js';

export interface EmbeddedGitNexusResult {
  stdout: string;
}

export interface EmbeddedGitNexusExecutor {
  (args: string[], cwd?: string): Promise<EmbeddedGitNexusResult>;
}

/**
 * Run embedded GitNexus analysis.
 */
export async function runEmbeddedAnalyze(repoPath: string, options?: { force?: boolean }): Promise<AnalyzeResult> {
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
        // Silent progress for now - could log to console if needed
      },
      onLog: (message) => {
        // Silent log for now
      },
    },
  );
}

/**
 * Run embedded GitNexus query (Cypher).
 */
export async function runEmbeddedQuery(
  repoPath: string,
  cypherQuery: string,
  limit?: number,
): Promise<EmbeddedGitNexusResult> {
  // Get lbug file path for the repo (not the directory)
  const { lbugPath } = getStoragePaths(repoPath);

  // Initialize connection
  await initLbug(lbugPath);

  // Apply limit if specified
  const query = limit ? `${cypherQuery} LIMIT ${limit}` : cypherQuery;

  try {
    const results = await executeQuery(query);
    return { stdout: JSON.stringify(results, null, 2) };
  } finally {
    await closeLbug();
  }
}

/**
 * Run embedded GitNexus list command.
 */
export async function runEmbeddedList(repoPath: string): Promise<EmbeddedGitNexusResult> {
  // LadybugDB stores nodes in separate tables per label.
  // Query each table and UNION the results.
  const cypher = `
    MATCH (n:Function) RETURN n.name as name, n.filePath as filePath, 'Function' as kind
    UNION ALL
    MATCH (n:Method) RETURN n.name as name, n.filePath as filePath, 'Method' as kind
    UNION ALL
    MATCH (n:Class) RETURN n.name as name, n.filePath as filePath, 'Class' as kind
    UNION ALL
    MATCH (n:Interface) RETURN n.name as name, n.filePath as filePath, 'Interface' as kind
    ORDER BY name
  `;
  return runEmbeddedQuery(repoPath, cypher);
}

/**
 * Check if repo has an index.
 */
export async function checkEmbeddedIndex(repoPath: string): Promise<boolean> {
  try {
    const { storagePath } = getStoragePaths(repoPath);
    const meta = await loadMeta(storagePath);
    return meta !== null && meta.lastCommit !== undefined;
  } catch {
    return false;
  }
}

/**
 * Ensure embedded GitNexus index exists.
 */
export async function ensureEmbeddedIndex(repoPath: string): Promise<void> {
  const indexed = await checkEmbeddedIndex(repoPath);
  if (indexed) return;
  await runEmbeddedAnalyze(repoPath);
}

/**
 * Create an executor compatible with OrchestrationDeps interface.
 */
export function createEmbeddedGitNexusExecutor(): EmbeddedGitNexusExecutor {
  return async (args: string[], cwd?: string): Promise<EmbeddedGitNexusResult> => {
    const repoPath = cwd || process.cwd();

    // Parse command
    const [command, ...rest] = args;

    switch (command) {
      case 'analyze':
        const force = rest.includes('--force');
        await runEmbeddedAnalyze(repoPath, { force });
        return { stdout: 'Analysis complete' };

      case 'list':
        return runEmbeddedList(repoPath);

      case 'query':
        const queryText = rest[0] || '';
        const limitArg = rest.indexOf('-l');
        const limit = limitArg >= 0 ? parseInt(rest[limitArg + 1], 10) : undefined;
        return runEmbeddedQuery(repoPath, queryText, limit);

      case 'status':
        const indexed = await checkEmbeddedIndex(repoPath);
        return { stdout: indexed ? 'indexed' : 'not indexed' };

      default:
        throw new Error(`Unknown gitnexus command: ${command}`);
    }
  };
}