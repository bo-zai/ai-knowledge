import path from "path";
import type { Database } from "@ladybugdb/core";
import { executeQuery, initLbug, initLbugWithDb } from "./pool-adapter.js";

export type ReadOnlyQueryExecutor = (
  cypher: string,
) => Promise<Record<string, unknown>[]>;

function getReadOnlyRepoId(dbPath: string): string {
  return `read-only:${path.resolve(dbPath)}`;
}

export async function initReadOnlyLbugWithDb(
  dbPath: string,
  db: Database,
): Promise<void> {
  await initLbugWithDb(getReadOnlyRepoId(dbPath), db, dbPath);
}

export async function withReadOnlyLbug<T>(
  dbPath: string,
  operation: (query: ReadOnlyQueryExecutor) => Promise<T>,
): Promise<T> {
  const repoId = getReadOnlyRepoId(dbPath);
  await initLbug(repoId, dbPath);
  return operation((cypher) => executeQuery(repoId, cypher));
}
