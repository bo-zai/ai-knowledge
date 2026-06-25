import type { EvidenceAtom, EvidenceSubjectRef } from "../types.js";
import type { PartitionCandidate } from "../../../partitioning/types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export class CodeEntrySource implements EvidenceSource {
  readonly sourceName = "code-entry";
  readonly sourceKind = "code" as const;

  async collect(
    clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];

    for (const candidate of clusterInput.candidates) {
      for (const entryPoint of candidate.entryPoints) {
        atoms.push(buildEntryPointAtom(candidate, entryPoint));
      }
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        candidateCount: clusterInput.candidates.length,
        entryPointCount: atoms.length,
      },
    };
  }
}

export function createCodeEntrySource(): CodeEntrySource {
  return new CodeEntrySource();
}

function buildEntryPointAtom(
  candidate: PartitionCandidate,
  entryPoint: PartitionCandidate["entryPoints"][number],
): EvidenceAtom {
  const subjects: EvidenceSubjectRef[] = [
    {
      kind: "entry-point",
      id: `${entryPoint.filePath}#${entryPoint.className}.${entryPoint.methodName}`,
      name: `${entryPoint.className}.${entryPoint.methodName}`,
    },
    {
      kind: "module",
      id: entryPoint.module,
      name: entryPoint.module,
    },
  ];

  for (const table of candidate.tables) {
    subjects.push({
      kind: "table",
      id: table.tableName,
      name: table.tableName,
    });
  }

  return {
    id: `entry-point:${candidate.candidateId}:${buildEntryPointToken(entryPoint)}`,
    atomKind: "entry-point",
    sourceKind: "code",
    summary: `入口 ${entryPoint.className}.${entryPoint.methodName} 暴露了候选 ${candidate.candidateId} 的行为表面`,
    subjects,
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      entryPointKind: entryPoint.kind,
      module: entryPoint.module,
      apiInfo: entryPoint.apiInfo,
      scheduledInfo: entryPoint.scheduledInfo,
      mqInfo: entryPoint.mqInfo,
      callChainDepth: candidate.callChainSummary.depth,
      callPathCount: candidate.callChainSummary.pathCount,
    },
    confidence: 0.95,
    locations: [
      {
        path: entryPoint.filePath,
      },
    ],
    tags: [entryPoint.kind, "entry-surface"],
  };
}

function buildEntryPointToken(
  entryPoint: PartitionCandidate["entryPoints"][number],
): string {
  const pathToken = entryPoint.filePath.replace(/[\\/:\s.]+/g, "_");
  return `${pathToken}:${entryPoint.className}.${entryPoint.methodName}`;
}
