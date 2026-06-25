import type { EvidenceAtom, EvidenceRef } from "../evidence/types.js";
import type { PartitionCandidate } from "../../partitioning/types.js";
import type { SubjectTableCohesion } from "./types.js";

export function buildTableCohesion(
  candidate: PartitionCandidate,
  atoms: EvidenceAtom[],
): SubjectTableCohesion {
  const candidateAtoms = atoms.filter(
    (atom) => atom.attributes["candidateId"] === candidate.candidateId,
  );
  const tableAccessAtoms = candidateAtoms.filter(
    (atom) => atom.atomKind === "table-access",
  );
  const tableJoinAtoms = candidateAtoms.filter(
    (atom) => atom.atomKind === "table-join",
  );
  const operationTypes = new Set<string>();
  const joinedTableNames = new Set<string>();
  const relatedTableNames = new Set<string>();
  const writeTableNames = new Set<string>();
  const readOnlyTableNames = new Set<string>();
  const evidenceRefs: EvidenceRef[] = [];

  for (const atom of tableAccessAtoms) {
    const operation = readStringAttribute(atom, "operation");
    if (operation) {
      operationTypes.add(operation);
    }

    const tableName = readStringAttribute(atom, "tableName");
    if (tableName && tableName !== candidate.anchorTable) {
      relatedTableNames.add(tableName);
    }
    if (tableName) {
      if (isWriteOperation(operation)) {
        writeTableNames.add(tableName);
      } else {
        readOnlyTableNames.add(tableName);
      }
    }
    evidenceRefs.push(toEvidenceRef(atom));
  }

  for (const atom of tableJoinAtoms) {
    const joinedTableName = readStringAttribute(atom, "joinedTable");
    if (joinedTableName) {
      joinedTableNames.add(joinedTableName);
      if (joinedTableName !== candidate.anchorTable) {
        relatedTableNames.add(joinedTableName);
      }
    }
    evidenceRefs.push(toEvidenceRef(atom));
  }

  for (const table of candidate.supportingTableNames) {
    relatedTableNames.add(table);
  }

  const normalizedJoinedTableNames = [...joinedTableNames].sort();
  const ownedTableNames = inferOwnedTableNames({
    candidate,
    writeTableNames,
    joinedTableNames,
  });
  const dependencyTableNames = inferDependencyTableNames({
    candidate,
    ownedTableNames,
    readOnlyTableNames,
    joinedTableNames,
  });

  return {
    anchorTable: candidate.anchorTable,
    ownedTableNames,
    dependencyTableNames,
    relatedTableNames: [...relatedTableNames].sort(),
    tableAccessCount: tableAccessAtoms.length,
    joinedTableNames: normalizedJoinedTableNames,
    writeTableNames: [...writeTableNames].sort(),
    readOnlyTableNames: [...readOnlyTableNames].sort(),
    operationTypes: [...operationTypes].sort(),
    evidenceRefs: dedupeEvidenceRefs(evidenceRefs),
  };
}

function inferOwnedTableNames(params: {
  candidate: PartitionCandidate;
  writeTableNames: Set<string>;
  joinedTableNames: Set<string>;
}): string[] {
  const { candidate, writeTableNames, joinedTableNames } = params;
  const ownedTables = new Set<string>([candidate.anchorTable]);

  for (const tableName of candidate.coreTableNames) {
    if (tableName === candidate.anchorTable) {
      ownedTables.add(tableName);
      continue;
    }
    if (writeTableNames.has(tableName)) {
      ownedTables.add(tableName);
      continue;
    }
    if (candidate.supportingTableNames.includes(tableName)) {
      ownedTables.add(tableName);
      continue;
    }
    if (
      !joinedTableNames.has(tableName) &&
      candidate.coreTableNames.length <= 2
    ) {
      ownedTables.add(tableName);
    }
  }

  return [...ownedTables].sort();
}

function inferDependencyTableNames(params: {
  candidate: PartitionCandidate;
  ownedTableNames: string[];
  readOnlyTableNames: Set<string>;
  joinedTableNames: Set<string>;
}): string[] {
  const { candidate, ownedTableNames, readOnlyTableNames, joinedTableNames } =
    params;
  const ownedTableSet = new Set(ownedTableNames);
  const dependencyTables = new Set<string>();

  for (const tableName of candidate.coreTableNames) {
    if (!ownedTableSet.has(tableName)) {
      dependencyTables.add(tableName);
    }
  }
  for (const tableName of candidate.supportingTableNames) {
    if (!ownedTableSet.has(tableName)) {
      dependencyTables.add(tableName);
    }
  }
  for (const tableName of readOnlyTableNames) {
    if (!ownedTableSet.has(tableName) || joinedTableNames.has(tableName)) {
      dependencyTables.add(tableName);
    }
  }

  dependencyTables.delete(candidate.anchorTable);
  return [...dependencyTables].sort();
}

function isWriteOperation(operation: string | undefined): boolean {
  return (
    operation === "insert" || operation === "update" || operation === "delete"
  );
}

function readStringAttribute(
  atom: EvidenceAtom,
  key: string,
): string | undefined {
  const value = atom.attributes[key];
  return typeof value === "string" ? value : undefined;
}

function toEvidenceRef(atom: EvidenceAtom): EvidenceRef {
  return {
    evidenceId: atom.id,
    atomKind: atom.atomKind,
    sourceKind: atom.sourceKind,
  };
}

function dedupeEvidenceRefs(evidenceRefs: EvidenceRef[]): EvidenceRef[] {
  const refMap = new Map<string, EvidenceRef>();
  for (const ref of evidenceRefs) {
    refMap.set(ref.evidenceId, ref);
  }
  return [...refMap.values()].sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
}
