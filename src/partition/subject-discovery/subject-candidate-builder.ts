import type {
  EvidenceAtom,
  EvidenceRef,
  EvidenceSubjectRef,
} from "../evidence/types.js";
import type { DomainClusterInput } from "../../partitioning/types.js";
import { buildBehaviorCluster } from "./behavior-cluster-builder.js";
import { buildEntrySurface } from "./entry-surface-builder.js";
import { buildTableCohesion } from "./table-cohesion-builder.js";
import type {
  SubjectCandidate,
  SubjectDiscoveryInput,
  SubjectDiscoveryResult,
} from "./types.js";

export function discoverSubjectCandidates(
  input: SubjectDiscoveryInput,
): SubjectDiscoveryResult {
  const candidates = input.clusterInput.candidates.map((candidate) =>
    buildSubjectCandidate(candidate, input.clusterInput, input.atoms),
  );

  return {
    candidates,
    metadata: {
      candidateCount: candidates.length,
      atomCount: input.atoms.length,
      relationCount: input.clusterInput.candidateRelations.length,
    },
  };
}

function buildSubjectCandidate(
  candidate: DomainClusterInput["candidates"][number],
  clusterInput: DomainClusterInput,
  atoms: EvidenceAtom[],
): SubjectCandidate {
  const candidateAtoms = atoms.filter(
    (atom) => atom.attributes["candidateId"] === candidate.candidateId,
  );
  const entrySurface = buildEntrySurface(candidate, atoms);
  const tableCohesion = buildTableCohesion(candidate, atoms);
  const behaviorCluster = buildBehaviorCluster(candidate, atoms);
  const ownedArtifacts = collectOwnedArtifacts(candidateAtoms);
  const uncertaintyFlags = collectUncertaintyFlags(
    candidate,
    clusterInput,
    candidateAtoms,
  );

  return {
    subjectId: candidate.candidateId,
    anchor: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      anchorQuality: candidate.anchorQuality,
    },
    entrySurface,
    tableCohesion,
    behaviorCluster,
    ownedArtifacts,
    evidenceRefs: dedupeEvidenceRefs(candidateAtoms.map(toEvidenceRef)),
    uncertaintyFlags,
    metadata: {
      entryPointCount: candidate.entryPoints.length,
      tableCount: candidate.tables.length,
      mapperCount: candidate.mappers.length,
      serviceCount: candidate.services.length,
      isAggregatorCandidate: candidate.isAggregatorCandidate,
      isInfrastructureCandidate: candidate.isInfrastructureCandidate,
    },
  };
}

function collectOwnedArtifacts(atoms: EvidenceAtom[]): EvidenceSubjectRef[] {
  const subjectMap = new Map<string, EvidenceSubjectRef>();
  for (const atom of atoms) {
    for (const subject of atom.subjects) {
      const key = `${subject.kind}:${subject.id}`;
      subjectMap.set(key, subject);
    }
  }

  return [...subjectMap.values()].sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
}

function collectUncertaintyFlags(
  candidate: DomainClusterInput["candidates"][number],
  clusterInput: DomainClusterInput,
  atoms: EvidenceAtom[],
): string[] {
  const flags = new Set<string>();
  const relationCount = clusterInput.candidateRelations.filter(
    (relation) =>
      relation.candidateIdA === candidate.candidateId ||
      relation.candidateIdB === candidate.candidateId,
  ).length;
  const hasTableAccess = atoms.some((atom) => atom.atomKind === "table-access");
  const hasJoinEvidence = atoms.some((atom) => atom.atomKind === "table-join");

  if (candidate.anchorQuality === "low") {
    flags.add("low-anchor-quality");
  }
  if (candidate.isAggregatorCandidate) {
    flags.add("aggregator-shape");
  }
  if (candidate.isInfrastructureCandidate) {
    flags.add("infrastructure-shape");
  }
  if (candidate.entryPoints.length === 0) {
    flags.add("no-entry-surface");
  }
  if (!hasTableAccess) {
    flags.add("no-direct-sql-evidence");
  }
  if (candidate.tables.length > 1 && !hasJoinEvidence) {
    flags.add("multi-table-without-join-evidence");
  }
  if (relationCount >= 4) {
    flags.add("high-neighbor-count");
  }

  return [...flags].sort();
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
