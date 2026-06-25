import type { EvidenceAtom, EvidenceSubjectRef } from "../types.js";
import type {
  CommitInfo,
  PartitionCandidate,
} from "../../../partitioning/types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export class CommitSource implements EvidenceSource {
  readonly sourceName = "commit";
  readonly sourceKind = "git" as const;

  async collect(
    clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];
    const candidateCommits = clusterInput.commitHistory?.candidateCommits;

    if (!candidateCommits) {
      return {
        sourceName: this.sourceName,
        sourceKind: this.sourceKind,
        atoms,
        metadata: {
          hasCommitHistory: false,
        },
      };
    }

    for (const candidate of clusterInput.candidates) {
      const commits = candidateCommits.get(candidate.candidateId) ?? [];
      for (const commit of commits) {
        atoms.push(buildCommitAtom(candidate, commit));
      }
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        hasCommitHistory: true,
        commitEvidenceCount: atoms.length,
      },
    };
  }
}

export function createCommitSource(): CommitSource {
  return new CommitSource();
}

function buildCommitAtom(
  candidate: PartitionCandidate,
  commit: CommitInfo,
): EvidenceAtom {
  const subjects: EvidenceSubjectRef[] = [
    {
      kind: "table",
      id: candidate.anchorTable,
      name: candidate.anchorTable,
    },
  ];

  for (const entryPoint of candidate.entryPoints) {
    subjects.push({
      kind: "file",
      id: entryPoint.filePath,
      name: entryPoint.filePath,
    });
  }

  return {
    id: `commit-cochange:${candidate.candidateId}:${commit.hash}`,
    atomKind: "commit-cochange",
    sourceKind: "git",
    summary: `候选 ${candidate.candidateId} 的相关文件出现在提交 ${commit.hash.slice(0, 7)} 中`,
    subjects,
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      commitHash: commit.hash,
      message: commit.message,
      date: commit.date,
      author: commit.author,
    },
    confidence: 0.7,
    locations: candidate.entryPoints.map((entryPoint) => ({
      path: entryPoint.filePath,
    })),
  };
}
