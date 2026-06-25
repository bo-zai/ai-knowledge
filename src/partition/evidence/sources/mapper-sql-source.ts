import type { EvidenceAtom, EvidenceSubjectRef } from "../types.js";
import type { PartitionCandidate } from "../../../partitioning/types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";
import {
  extractTablesFromSql,
  parseMapperFile,
  resolveStatementSql,
} from "../../../mybatis/index.js";

export class MapperSqlSource implements EvidenceSource {
  readonly sourceName = "mapper-sql";
  readonly sourceKind = "sql" as const;

  async collect(
    clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];

    for (const candidate of clusterInput.candidates) {
      for (const mapper of candidate.mappers) {
        const mapperAtoms = await collectMapperAtoms(candidate, mapper);
        atoms.push(...mapperAtoms);
      }
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        mapperSqlEvidenceCount: atoms.length,
      },
    };
  }
}

export function createMapperSqlSource(): MapperSqlSource {
  return new MapperSqlSource();
}

async function collectMapperAtoms(
  candidate: PartitionCandidate,
  mapper: PartitionCandidate["mappers"][number],
): Promise<EvidenceAtom[]> {
  if (!mapper.xmlPath) {
    return [];
  }

  const mapperDoc = await parseMapperFile(mapper.xmlPath);
  if (!mapperDoc) {
    return [];
  }

  const atoms: EvidenceAtom[] = [];

  for (const statement of mapperDoc.statements) {
    const resolved = resolveStatementSql(statement, mapperDoc);
    const statementSql = normalizeSql(resolved.sql);
    const tables = [...new Set(extractTablesFromSql(statementSql))];

    atoms.push(
      buildSqlStatementAtom(
        candidate,
        mapper,
        statement.id,
        statementSql,
        tables,
      ),
    );

    for (const tableName of tables) {
      atoms.push(
        buildTableAccessAtom(
          candidate,
          mapper,
          statement.id,
          tableName,
          statementSql,
        ),
      );
    }

    for (const joinedTable of extractJoinedTables(statementSql)) {
      atoms.push(
        buildTableJoinAtom(
          candidate,
          mapper,
          statement.id,
          joinedTable,
          statementSql,
        ),
      );
    }
  }

  return atoms;
}

function buildSqlStatementAtom(
  candidate: PartitionCandidate,
  mapper: PartitionCandidate["mappers"][number],
  statementId: string,
  sql: string,
  tables: string[],
): EvidenceAtom {
  return {
    id: `sql-statement:${candidate.candidateId}:${mapper.className}:${statementId}`,
    atomKind: "sql-statement",
    sourceKind: "sql",
    summary: `${mapper.className}.${statementId} 涉及 ${tables.length} 张表`,
    subjects: buildMapperSubjects(mapper, tables),
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      mapperClassName: mapper.className,
      statementId,
      tables,
      operation: inferSqlOperation(sql),
    },
    confidence: 0.95,
    locations: [
      {
        path: mapper.xmlPath ?? mapper.filePath,
        snippet: truncateSnippet(sql),
      },
    ],
    tags: ["mapper-sql"],
  };
}

function buildTableAccessAtom(
  candidate: PartitionCandidate,
  mapper: PartitionCandidate["mappers"][number],
  statementId: string,
  tableName: string,
  sql: string,
): EvidenceAtom {
  return {
    id: `table-access:${candidate.candidateId}:${mapper.className}:${statementId}:${tableName}`,
    atomKind: "table-access",
    sourceKind: "sql",
    summary: `${mapper.className}.${statementId} 访问表 ${tableName}`,
    subjects: buildMapperSubjects(mapper, [tableName]),
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      statementId,
      tableName,
      operation: inferSqlOperation(sql),
    },
    confidence: 0.95,
    locations: [
      {
        path: mapper.xmlPath ?? mapper.filePath,
        snippet: truncateSnippet(sql),
      },
    ],
  };
}

function buildTableJoinAtom(
  candidate: PartitionCandidate,
  mapper: PartitionCandidate["mappers"][number],
  statementId: string,
  joinedTable: string,
  sql: string,
): EvidenceAtom {
  return {
    id: `table-join:${candidate.candidateId}:${mapper.className}:${statementId}:${joinedTable}`,
    atomKind: "table-join",
    sourceKind: "sql",
    summary: `${mapper.className}.${statementId} 通过 join 使用表 ${joinedTable}`,
    subjects: buildMapperSubjects(mapper, [joinedTable]),
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      statementId,
      joinedTable,
    },
    confidence: 0.9,
    locations: [
      {
        path: mapper.xmlPath ?? mapper.filePath,
        snippet: truncateSnippet(sql),
      },
    ],
    tags: ["sql-join"],
  };
}

function buildMapperSubjects(
  mapper: PartitionCandidate["mappers"][number],
  tables: string[],
): EvidenceSubjectRef[] {
  const subjects: EvidenceSubjectRef[] = [
    {
      kind: "mapper",
      id: mapper.filePath,
      name: mapper.className,
    },
  ];

  for (const tableName of tables) {
    subjects.push({
      kind: "table",
      id: tableName,
      name: tableName,
    });
  }

  return subjects;
}

function inferSqlOperation(
  sql: string,
): "select" | "insert" | "update" | "delete" | "unknown" {
  const normalized = sql.trim().toLowerCase();
  if (normalized.startsWith("select")) {
    return "select";
  }
  if (normalized.startsWith("insert")) {
    return "insert";
  }
  if (normalized.startsWith("update")) {
    return "update";
  }
  if (normalized.startsWith("delete")) {
    return "delete";
  }
  return "unknown";
}

function extractJoinedTables(sql: string): string[] {
  const pattern =
    /\b(?:left|right|inner|outer|cross)?\s*join\s+([a-zA-Z0-9_$.]+)/gi;
  const tables = new Set<string>();
  for (const match of sql.matchAll(pattern)) {
    const tableName = match[1]?.trim();
    if (tableName) {
      tables.add(tableName);
    }
  }
  return [...tables];
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function truncateSnippet(sql: string): string {
  if (sql.length <= 400) {
    return sql;
  }
  return `${sql.slice(0, 397)}...`;
}
