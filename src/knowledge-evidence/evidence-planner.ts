import { logger } from "../shared/logger.js";
import {
  assessGap,
  executeLlmSupplement,
  mergeEvidenceGroups,
} from "../evidence/extractors/hybrid/index.js";
import { buildGraphEvidenceGroups } from "./graph-provider.js";
import { loadPartitionEvidence } from "./partition-provider.js";
import { buildConceptEvidenceGroupsFromPartitions } from "./concept/concept-evidence-planner.js";
import { buildCapabilityEvidenceGroupsFromPartitions } from "./capability/capability-evidence-planner.js";
import { writeEvidencePlanArtifact } from "./artifact-writer.js";
import type {
  KnowledgeEvidencePlanInput,
  PlannedEvidenceGroupsResult,
} from "./types.js";
import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";

export async function buildPlannedEvidenceGroups(
  input: KnowledgeEvidencePlanInput,
): Promise<PlannedEvidenceGroupsResult> {
  const graphGroups = await buildGraphEvidenceGroups(input);
  const partitionEvidence = await loadPartitionEvidence(input.repoPath);
  const repoName = input.repoPath.split(/[\\/]/).pop() || "unknown";

  if (
    partitionEvidence.available &&
    (input.type === "CONCEPT" || input.type === "CAPABILITY")
  ) {
    const groups =
      input.type === "CONCEPT"
        ? buildConceptEvidenceGroupsFromPartitions({
            repoName,
            scopes: partitionEvidence.scopes,
            graphGroups,
          })
        : buildCapabilityEvidenceGroupsFromPartitions({
            repoName,
            scopes: partitionEvidence.scopes,
          });

    if (groups.length > 0) {
      const warnings = [
        ...partitionEvidence.warnings,
        ...(graphGroups.length === 0 ? ["graph_supplement_empty"] : []),
      ];
      await writeEvidencePlanArtifact(
        input.repoPath,
        buildArtifact(
          input.type,
          "hybrid",
          partitionEvidence.partitionMode,
          groups,
          warnings,
        ),
      );
      logger.info(
        `${input.type}: ${groups.length} partition-scoped evidence groups planned`,
      );
      return { groups, source: "hybrid", warnings };
    }
  }

  const groups = await maybeSupplementWithLlm(input, graphGroups);
  await writeEvidencePlanArtifact(
    input.repoPath,
    buildArtifact(
      input.type,
      "graph",
      partitionEvidence.partitionMode,
      groups,
      partitionEvidence.warnings,
    ),
  );
  return { groups, source: "graph", warnings: partitionEvidence.warnings };
}

async function maybeSupplementWithLlm(
  input: KnowledgeEvidencePlanInput,
  staticGroups: EvidenceGroup[],
): Promise<EvidenceGroup[]> {
  if (!input.claimsProvider) {
    return staticGroups;
  }

  const gapAssessment = assessGap(input.type, staticGroups);
  logger.info(`Gap assessment: ${gapAssessment.reason}`);

  if (!gapAssessment.needsLlmSupplement) {
    return staticGroups;
  }

  logger.info(`Triggering LLM supplement for ${input.type}`);
  const supplementResult = await executeLlmSupplement(
    {
      type: input.type,
      repoPath: input.repoPath,
      staticGroups,
      gapReason: gapAssessment.reason,
    },
    input.claimsProvider,
  );

  const mergedGroups = mergeEvidenceGroups(
    staticGroups,
    supplementResult.groups,
  );
  logger.info(
    `Hybrid graph result: ${mergedGroups.length} groups (${staticGroups.length} static + ${supplementResult.groups.length} LLM)`,
  );
  return mergedGroups;
}

function buildArtifact(
  type: KnowledgeEvidencePlanInput["type"],
  source: "partition" | "graph" | "hybrid",
  partitionMode: string | undefined,
  groups: EvidenceGroup[],
  warnings: string[],
) {
  return {
    type,
    source,
    partitionMode,
    groupCount: groups.length,
    warnings,
    groups: groups.map((group) => ({
      groupId: group.groupId,
      packagePath: group.packagePath,
      entryPointCount: group.bundle.entryPoints.length,
      behaviorCount: group.bundle.behaviorSlices.length,
      dataContractCount: group.bundle.dataContracts.length,
      moduleCount: group.bundle.moduleSurfaces.length,
    })),
  };
}
