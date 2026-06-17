/**
 * Knowledge Generation Preflight Module
 *
 * Provides unified preflight analysis check for all knowledge generation commands.
 * This module ensures that graph data (analysis index) is ready before generation.
 */

import { logger } from "../shared/logger.js";
import { hasIndex, runAnalysis } from "./index-service.js";
import { getStoragePaths, loadMeta } from "../engine/storage/repo-manager.js";
import { withReadOnlyLbug } from "../engine/lbug/read-only-session.js";
import { NODE_TABLES, REL_TABLE_NAME } from "../engine/lbug/schema.js";

export type GraphStatusType =
  | "created"
  | "reused"
  | "reanalyzed"
  | "skipped_for_mock";

/**
 * Graph initialization result with statistics.
 */
export interface GraphStatus {
  status: GraphStatusType;
  nodeCount: number;
  edgeCount: number;
  analyzedAt: string; // ISO timestamp
  analysisDuration?: number; // milliseconds
}

export interface PreflightInput {
  repoPath: string;
  forceAnalyze?: boolean;
  mockMode?: boolean;
}

/** Number of times to retry on a BUSY / lock-held error before giving up. */
const LOCK_RETRY_ATTEMPTS = 5;
/** Base back-off in ms between BUSY retries. */
const LOCK_RETRY_DELAY_MS = 1000;

// Multi-language table names that were created with backticks
const BACKTICK_TABLES = new Set([
  "Struct",
  "Enum",
  "Macro",
  "Typedef",
  "Union",
  "Namespace",
  "Trait",
  "Impl",
  "TypeAlias",
  "Const",
  "Static",
  "Property",
  "Record",
  "Delegate",
  "Annotation",
  "Constructor",
  "Template",
  "Module",
]);

function escapeTableName(table: string): string {
  return BACKTICK_TABLES.has(table) ? `\`${table}\`` : table;
}

/**
 * Return true when the error message indicates that another process holds
 * an exclusive lock on the LadybugDB file.
 */
function isDbBusyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("busy") ||
    msg.includes("lock") ||
    msg.includes("already in use") ||
    msg.includes("could not set lock")
  );
}

/**
 * Query graph statistics from LadybugDB using a read-only connection.
 *
 * Uses read-only mode to avoid lock conflicts with concurrent writes.
 * Retries on lock errors (e.g., when another process holds a write lock).
 */
async function queryGraphStats(
  repoPath: string,
): Promise<{ nodeCount: number; edgeCount: number }> {
  const { lbugPath } = getStoragePaths(repoPath);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withReadOnlyLbug(lbugPath, async (query) => {
        let nodeCount = 0;
        for (const tableName of NODE_TABLES) {
          try {
            const data = await query(
              `MATCH (n:${escapeTableName(tableName)}) RETURN count(n) AS cnt`,
            );
            if (data.length > 0) {
              nodeCount += Number(data[0]?.cnt ?? data[0]?.[0] ?? 0);
            }
          } catch {
            // Some tables may not exist, skip
          }
        }

        let edgeCount = 0;
        try {
          const data = await query(
            `MATCH ()-[r:${REL_TABLE_NAME}]->() RETURN count(r) AS cnt`,
          );
          if (data.length > 0) {
            edgeCount = Number(data[0]?.cnt ?? data[0]?.[0] ?? 0);
          }
        } catch {
          // Relationship table may not exist
        }

        return { nodeCount, edgeCount };
      });
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isDbBusyError(err) || attempt === LOCK_RETRY_ATTEMPTS) {
        throw new Error(
          `Failed to query graph stats after ${attempt} attempts: ${lastError.message}`,
        );
      }

      logger.warn(
        `Database lock detected, retrying (${attempt}/${LOCK_RETRY_ATTEMPTS})...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt),
      );
    }
  }

  throw new Error(
    `Failed to query graph stats: database locked after ${LOCK_RETRY_ATTEMPTS} retries. ` +
      `Another process may be analyzing the repository. Wait and retry.`,
  );
}

/**
 * Unified preflight analysis check for knowledge generation.
 *
 * Rules:
 * 1. If mockMode, skip analysis (return skipped_for_mock)
 * 2. If forceAnalyze, rebuild index (return reanalyzed)
 * 3. If no index, create new index (return created)
 * 4. If index exists, reuse it (return reused)
 */
export async function initGraphData(
  input: PreflightInput,
): Promise<GraphStatus> {
  const { repoPath, forceAnalyze = false, mockMode = false } = input;

  logger.info("Checking analysis state...");

  if (mockMode) {
    logger.info("Mock mode: skipping analysis");
    return {
      status: "skipped_for_mock",
      nodeCount: 0,
      edgeCount: 0,
      analyzedAt: new Date().toISOString(),
    };
  }

  const hadIndex = await hasIndex(repoPath);
  const startTime = Date.now();

  if (forceAnalyze) {
    logger.info("Force analyze: rebuilding index");
    await runAnalysis(repoPath, { force: true });
    const { nodeCount, edgeCount } = await queryGraphStats(repoPath);
    const { storagePath } = getStoragePaths(repoPath);
    const meta = await loadMeta(storagePath);
    return {
      status: "reanalyzed",
      nodeCount,
      edgeCount,
      analyzedAt: meta?.indexedAt ?? new Date().toISOString(),
      analysisDuration: Date.now() - startTime,
    };
  }

  if (!hadIndex) {
    logger.info("No index found: creating new index");
    await runAnalysis(repoPath, { force: false });

    // Wait for database file handle to be released on Windows
    // LadybugDB may not immediately release file locks after close()
    // 2 seconds is enough for most cases based on testing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const { nodeCount, edgeCount } = await queryGraphStats(repoPath);
    const { storagePath } = getStoragePaths(repoPath);
    const meta = await loadMeta(storagePath);
    return {
      status: "created",
      nodeCount,
      edgeCount,
      analyzedAt: meta?.indexedAt ?? new Date().toISOString(),
      analysisDuration: Date.now() - startTime,
    };
  }

  logger.info("Index found: reusing existing index");
  const { nodeCount, edgeCount } = await queryGraphStats(repoPath);
  const { storagePath } = getStoragePaths(repoPath);
  const meta = await loadMeta(storagePath);
  return {
    status: "reused",
    nodeCount,
    edgeCount,
    analyzedAt: meta?.indexedAt ?? new Date().toISOString(),
  };
}

/**
 * Legacy alias for backward compatibility.
 * @deprecated Use initGraphData instead
 */
export async function prepareKnowledgeGeneration(
  input: PreflightInput,
): Promise<GraphStatus> {
  return initGraphData(input);
}
