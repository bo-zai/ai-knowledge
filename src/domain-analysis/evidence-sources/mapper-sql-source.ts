import type { DomainEvidenceSource } from "./types.js";
import type {
  DomainAnalysisContext,
  DomainDependencyMatrixEntry,
  DomainEvidenceBundle,
} from "../types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";
import {
  extractTablesFromSql,
  parseMapperFile,
  resolveStatementSql,
} from "../../mybatis/index.js";

export class MapperSqlSource implements DomainEvidenceSource {
  readonly sourceName = "mapper-sql";

  async collect(
    clusterInput: DomainClusterInput,
    _context: DomainAnalysisContext,
  ): Promise<Partial<DomainEvidenceBundle>> {
    const tableToCandidate = new Map<string, string>();
    for (const candidate of clusterInput.candidates) {
      for (const table of candidate.tables) {
        tableToCandidate.set(table.tableName, candidate.candidateId);
      }
    }

    const entries: DomainDependencyMatrixEntry[] = [];

    for (const candidate of clusterInput.candidates) {
      for (const mapper of candidate.mappers) {
        if (!mapper.xmlPath) {
          continue;
        }

        const mapperDoc = await parseMapperFile(mapper.xmlPath);
        if (!mapperDoc) {
          continue;
        }

        for (const statement of mapperDoc.statements) {
          const resolved = resolveStatementSql(statement, mapperDoc);
          const tables = [...new Set(extractTablesFromSql(resolved.sql))];
          if (tables.length < 2) {
            continue;
          }

          const localTables = tables.filter((tableName) =>
            candidate.tables.some((table) => table.tableName === tableName),
          );
          if (localTables.length === 0) {
            continue;
          }

          const foreignCandidates = [...new Set(tables)]
            .map((tableName) => ({
              tableName,
              candidateId: tableToCandidate.get(tableName),
            }))
            .filter(
              (item): item is { tableName: string; candidateId: string } =>
                Boolean(item.candidateId) &&
                item.candidateId !== candidate.candidateId,
            );

          for (const target of foreignCandidates) {
            const hasJoinEvidence = hasJoinWithTable(
              resolved.sql,
              target.tableName,
            );
            entries.push({
              sourceCandidateId: candidate.candidateId,
              targetCandidateId: target.candidateId,
              relationReasons: [
                `sql-statement:${statement.id}:${target.tableName}`,
                ...extractJoinReasons(resolved.sql, target.tableName),
              ],
              relationScore: hasJoinEvidence ? 4 : 3,
            });
          }
        }
      }
    }

    return {
      dependencyMatrix: entries,
    };
  }
}

export function createMapperSqlSource(): MapperSqlSource {
  return new MapperSqlSource();
}

function hasJoinWithTable(sql: string, tableName: string): boolean {
  const pattern = new RegExp(
    String.raw`\bjoin\s+${escapeRegExp(tableName)}\b`,
    "i",
  );
  return pattern.test(sql);
}

function extractJoinReasons(sql: string, tableName: string): string[] {
  const reasons: string[] = [];
  const joinPattern = new RegExp(
    String.raw`\b(?:left|right|inner|outer)?\s*join\s+${escapeRegExp(tableName)}\b`,
    "ig",
  );
  if (joinPattern.test(sql)) {
    reasons.push(`sql-join:${tableName}`);
  }
  return reasons;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
