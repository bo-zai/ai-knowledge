import type { EvidenceAtom, EvidenceRef } from "../evidence/types.js";
import type { PartitionCandidate } from "../../partitioning/types.js";
import type { SubjectBehaviorCluster } from "./types.js";

export function buildBehaviorCluster(
  candidate: PartitionCandidate,
  atoms: EvidenceAtom[],
): SubjectBehaviorCluster {
  const candidateAtoms = atoms.filter(
    (atom) => atom.attributes["candidateId"] === candidate.candidateId,
  );
  const serviceCallAtoms = candidateAtoms.filter(
    (atom) => atom.atomKind === "service-call",
  );
  const moduleNames = new Set<string>();
  const serviceNames = new Set<string>();
  const mapperNames = new Set(
    candidate.mappers.map((mapper) => mapper.className),
  );
  let totalCallChainDepth = 0;
  let maxCallChainDepth = 0;
  let crossBoundaryHintCount = 0;

  for (const entryPoint of candidate.entryPoints) {
    moduleNames.add(entryPoint.module);
  }

  for (const service of candidate.services) {
    serviceNames.add(service.className);
  }

  for (const atom of serviceCallAtoms) {
    for (const subject of atom.subjects) {
      if (subject.kind === "service") {
        serviceNames.add(subject.name);
      }
    }

    const crossDomainHint = atom.attributes["crossDomainHint"];
    if (typeof crossDomainHint === "string" && crossDomainHint.length > 0) {
      crossBoundaryHintCount += 1;
    }
  }

  for (const entryPoint of candidate.entryPoints) {
    totalCallChainDepth += candidate.callChainSummary.depth;
    maxCallChainDepth = Math.max(
      maxCallChainDepth,
      candidate.callChainSummary.depth,
    );
  }

  return {
    serviceNames: [...serviceNames].sort(),
    mapperNames: [...mapperNames].sort(),
    moduleNames: [...moduleNames].sort(),
    averageCallChainDepth:
      candidate.entryPoints.length === 0
        ? 0
        : totalCallChainDepth / candidate.entryPoints.length,
    maxCallChainDepth,
    crossBoundaryHintCount,
    evidenceRefs: dedupeEvidenceRefs(serviceCallAtoms.map(toEvidenceRef)),
  };
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
