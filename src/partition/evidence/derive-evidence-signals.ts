import type { EvidenceAtom, EvidenceBundleContainer } from "./types.js";

export interface EvidenceSignals {
  atomIdsByKind: Partial<Record<EvidenceAtom["atomKind"], string[]>>;
  atomIdsBySource: Partial<Record<EvidenceAtom["sourceKind"], string[]>>;
  subjectCountByKind: Record<string, number>;
  candidateAtomCount: Record<string, number>;
  candidateAnchorTableCount: Record<string, number>;
  tableAccessCount: Record<string, number>;
  tableJoinCount: Record<string, number>;
  coAccessTablePairs: Array<{
    pairKey: string;
    leftTable: string;
    rightTable: string;
    evidenceCount: number;
  }>;
}

export function deriveEvidenceSignals(
  bundle: Pick<EvidenceBundleContainer, "atoms">,
): EvidenceSignals {
  const atomIdsByKind: Partial<Record<EvidenceAtom["atomKind"], string[]>> = {};
  const atomIdsBySource: Partial<Record<EvidenceAtom["sourceKind"], string[]>> =
    {};
  const subjectCountByKind = new Map<string, number>();
  const candidateAtomCount = new Map<string, number>();
  const candidateAnchorTableCount = new Map<string, number>();
  const tableAccessCount = new Map<string, number>();
  const tableJoinCount = new Map<string, number>();
  const coAccessPairCount = new Map<string, number>();

  for (const atom of bundle.atoms) {
    appendRecordList(atomIdsByKind, atom.atomKind, atom.id);
    appendRecordList(atomIdsBySource, atom.sourceKind, atom.id);

    for (const subject of atom.subjects) {
      subjectCountByKind.set(
        subject.kind,
        (subjectCountByKind.get(subject.kind) ?? 0) + 1,
      );
    }

    const candidateId = readStringAttribute(atom, "candidateId");
    if (candidateId) {
      candidateAtomCount.set(
        candidateId,
        (candidateAtomCount.get(candidateId) ?? 0) + 1,
      );
    }

    const anchorTable = readStringAttribute(atom, "anchorTable");
    if (anchorTable) {
      candidateAnchorTableCount.set(
        anchorTable,
        (candidateAnchorTableCount.get(anchorTable) ?? 0) + 1,
      );
    }

    if (atom.atomKind === "table-access") {
      const tableName = readStringAttribute(atom, "tableName");
      if (tableName) {
        tableAccessCount.set(
          tableName,
          (tableAccessCount.get(tableName) ?? 0) + 1,
        );
      }
    }

    if (atom.atomKind === "table-join") {
      const joinedTable = readStringAttribute(atom, "joinedTable");
      if (joinedTable) {
        tableJoinCount.set(
          joinedTable,
          (tableJoinCount.get(joinedTable) ?? 0) + 1,
        );
      }
    }

    if (atom.atomKind === "sql-statement") {
      const tables = readStringArrayAttribute(atom, "tables");
      for (const pairKey of buildPairKeys(tables)) {
        coAccessPairCount.set(
          pairKey,
          (coAccessPairCount.get(pairKey) ?? 0) + 1,
        );
      }
    }
  }

  return {
    atomIdsByKind,
    atomIdsBySource,
    subjectCountByKind: toSortedRecord(subjectCountByKind),
    candidateAtomCount: toSortedRecord(candidateAtomCount),
    candidateAnchorTableCount: toSortedRecord(candidateAnchorTableCount),
    tableAccessCount: toSortedRecord(tableAccessCount),
    tableJoinCount: toSortedRecord(tableJoinCount),
    coAccessTablePairs: [...coAccessPairCount.entries()]
      .map(([pairKey, evidenceCount]) => {
        const [leftTable, rightTable] = pairKey.split("::");
        return {
          pairKey,
          leftTable,
          rightTable,
          evidenceCount,
        };
      })
      .sort(compareCoAccessPairs),
  };
}

function appendRecordList<K extends string>(
  target: Partial<Record<K, string[]>>,
  key: K,
  value: string,
): void {
  const existing = target[key];
  if (existing) {
    existing.push(value);
    return;
  }
  target[key] = [value];
}

function readStringAttribute(
  atom: EvidenceAtom,
  key: string,
): string | undefined {
  const value = atom.attributes[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readStringArrayAttribute(atom: EvidenceAtom, key: string): string[] {
  const value = atom.attributes[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function buildPairKeys(tableNames: string[]): string[] {
  const uniqueNames = [...new Set(tableNames)].sort((left, right) =>
    left.localeCompare(right),
  );
  const pairKeys: string[] = [];

  for (let index = 0; index < uniqueNames.length; index += 1) {
    for (
      let innerIndex = index + 1;
      innerIndex < uniqueNames.length;
      innerIndex += 1
    ) {
      pairKeys.push(`${uniqueNames[index]}::${uniqueNames[innerIndex]}`);
    }
  }

  return pairKeys;
}

function toSortedRecord(source: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...source.entries()].sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey),
    ),
  );
}

function compareCoAccessPairs(
  left: { pairKey: string; evidenceCount: number },
  right: { pairKey: string; evidenceCount: number },
): number {
  if (right.evidenceCount !== left.evidenceCount) {
    return right.evidenceCount - left.evidenceCount;
  }
  return left.pairKey.localeCompare(right.pairKey);
}
