import type { EvidenceAtom, EvidenceSubjectRef } from "../types.js";
import type { PartitionCandidate } from "../../../partitioning/types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

export class ServiceCallSource implements EvidenceSource {
  readonly sourceName = "service-call";
  readonly sourceKind = "code" as const;

  async collect(
    clusterInput: DomainClusterInput,
    _context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];

    for (const candidate of clusterInput.candidates) {
      const representativeEntryPoint = candidate.entryPoints[0];
      if (!representativeEntryPoint) {
        continue;
      }

      for (let index = 0; index < candidate.services.length; index += 1) {
        const service = candidate.services[index];
        atoms.push(
          buildServiceCallAtom(
            candidate,
            representativeEntryPoint,
            service,
            index,
          ),
        );
      }
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        callEvidenceCount: atoms.length,
      },
    };
  }
}

export function createServiceCallSource(): ServiceCallSource {
  return new ServiceCallSource();
}

function buildServiceCallAtom(
  candidate: PartitionCandidate,
  entryPoint: PartitionCandidate["entryPoints"][number],
  service: PartitionCandidate["services"][number],
  index: number,
): EvidenceAtom {
  const subjects: EvidenceSubjectRef[] = [
    {
      kind: "entry-point",
      id: `${entryPoint.filePath}#${entryPoint.className}.${entryPoint.methodName}`,
      name: `${entryPoint.className}.${entryPoint.methodName}`,
    },
    {
      kind: "service",
      id: service.filePath,
      name: service.className,
    },
  ];

  return {
    id: `service-call:${candidate.candidateId}:${buildEntryPointToken(entryPoint)}:${index}`,
    atomKind: "service-call",
    sourceKind: "code",
    summary: `${entryPoint.className}.${entryPoint.methodName} 到达 ${service.className}`,
    subjects,
    attributes: {
      candidateId: candidate.candidateId,
      anchorTable: candidate.anchorTable,
      entryPointKind: entryPoint.kind,
      serviceFilePath: service.filePath,
    },
    confidence: 0.7,
    locations: [
      {
        path: service.filePath,
      },
    ],
    tags: ["service-reachability"],
  };
}

function buildEntryPointToken(
  entryPoint: PartitionCandidate["entryPoints"][number],
): string {
  const pathToken = entryPoint.filePath.replace(/[\\/:\s.]+/g, "_");
  return `${pathToken}:${entryPoint.className}.${entryPoint.methodName}`;
}
