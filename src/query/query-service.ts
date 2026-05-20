/**
 * Query Service
 *
 * Provides query operations for building DB evidence bundles.
 * Wraps embedded runtime for table-centric queries.
 */

import {
  findDbTables,
  getDbTableContext,
  type DbTableNode,
  type DbTableContext,
} from './index-service.js';

export interface QueryServiceDeps {
  repoPath: string;
}

/**
 * Create a query service for a repository.
 */
export function createQueryService(deps: QueryServiceDeps): QueryService {
  return {
    repoPath: deps.repoPath,
    findDbTables: (limit?: number) => findDbTables(deps.repoPath, limit),
    getDbTableContext: (tableName: string) => getDbTableContext(deps.repoPath, tableName),
    buildDbEvidenceBundle: (tableName: string) => buildDbEvidenceBundle(deps.repoPath, tableName),
  };
}

export interface QueryService {
  repoPath: string;
  findDbTables: (limit?: number) => Promise<DbTableNode[]>;
  getDbTableContext: (tableName: string) => Promise<DbTableContext>;
  buildDbEvidenceBundle: (tableName: string) => Promise<DbEvidenceBundle>;
}

/**
 * Build a DB evidence bundle for a table.
 */
export async function buildDbEvidenceBundle(repoPath: string, tableName: string): Promise<DbEvidenceBundle> {
  const context = await getDbTableContext(repoPath, tableName);

  return {
    tableName,
    evidence: {
      callers: context.callers.map((c) => ({
        symbol: c.name,
        file: c.filePath,
        kind: 'caller',
      })),
      classes: context.classes.map((c) => ({
        symbol: c.name,
        file: c.filePath,
        kind: 'class',
      })),
      fields: context.fields.map((f) => ({
        symbol: f,
        kind: 'field',
      })),
      queries: context.queries.map((q) => ({
        content: q,
        kind: 'query',
      })),
    },
    provenance: {
      source: 'embedded-gitnexus',
      repoPath,
      generatedAt: new Date().toISOString(),
    },
  };
}

export interface DbEvidenceBundle {
  tableName: string;
  evidence: {
    callers: Array<{ symbol: string; file?: string; kind: string }>;
    classes: Array<{ symbol: string; file?: string; kind: string }>;
    fields: Array<{ symbol: string; kind: string }>;
    queries: Array<{ content: string; kind: string }>;
  };
  provenance: {
    source: string;
    repoPath: string;
    generatedAt: string;
  };
}