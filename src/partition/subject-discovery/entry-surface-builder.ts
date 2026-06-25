import type { EvidenceAtom, EvidenceRef } from "../evidence/types.js";
import type { PartitionCandidate } from "../../partitioning/types.js";
import type { SubjectEntrySurface } from "./types.js";

export function buildEntrySurface(
  candidate: PartitionCandidate,
  atoms: EvidenceAtom[],
): SubjectEntrySurface[] {
  const entryPointAtoms = atoms.filter(
    (atom) =>
      atom.atomKind === "entry-point" &&
      atom.attributes["candidateId"] === candidate.candidateId,
  );
  const evidenceRefByEntryPointId = new Map<string, EvidenceRef[]>();

  for (const atom of entryPointAtoms) {
    const entryPointId = getEntryPointSubjectId(atom);
    if (!entryPointId) {
      continue;
    }

    const refs = evidenceRefByEntryPointId.get(entryPointId) ?? [];
    refs.push(toEvidenceRef(atom));
    evidenceRefByEntryPointId.set(entryPointId, refs);
  }

  return candidate.entryPoints.map((entryPoint) => {
    const entryPointId = `${entryPoint.filePath}#${entryPoint.className}.${entryPoint.methodName}`;
    return {
      entryPointId,
      kind: entryPoint.kind,
      className: entryPoint.className,
      methodName: entryPoint.methodName,
      moduleName: entryPoint.module,
      filePath: entryPoint.filePath,
      evidenceRefs: evidenceRefByEntryPointId.get(entryPointId) ?? [],
    };
  });
}

function getEntryPointSubjectId(atom: EvidenceAtom): string | undefined {
  return atom.subjects.find((subject) => subject.kind === "entry-point")?.id;
}

function toEvidenceRef(atom: EvidenceAtom): EvidenceRef {
  return {
    evidenceId: atom.id,
    atomKind: atom.atomKind,
    sourceKind: atom.sourceKind,
  };
}
