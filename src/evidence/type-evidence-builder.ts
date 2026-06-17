import type { KnowledgeType } from "../schemas/knowledge-type.js";
import type { EvidenceBundle } from "./evidence-bundle-schema.js";
import type { GraphStatus } from "../query/prepare-generation.js";
import type { GenerateTarget } from "../knowledge/generate-scope.js";
import type { ReadOnlyQueryExecutor } from "../engine/lbug/read-only-session.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import { getStoragePaths } from "../engine/storage/repo-manager.js";
import { withReadOnlyLbug } from "../engine/lbug/read-only-session.js";
import { logger } from "../shared/logger.js";
import {
  queryConceptEvidenceByPackage,
  queryDataModelEvidenceByPackage,
  queryCapabilityEvidenceByPackage,
  queryBoundaryEvidenceByPackage,
  queryExternalEvidenceByPackage,
  queryConstraintEvidenceByPackage,
  queryRelationEvidenceByPackage,
  queryWorkflowEvidenceByPackage,
} from "./extractors/index.js";
import {
  assessGap,
  executeLlmSupplement,
  mergeEvidenceGroups,
} from "./extractors/hybrid/index.js";

export interface BuildEvidenceInput {
  repoPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  graphStatus: GraphStatus;
  claimsProvider?: LlmClaimsProvider;
}

/**
 * Evidence group for batched LLM generation.
 * Each group contains evidence from the same package/directory.
 */
export interface EvidenceGroup {
  groupId: string;
  packagePath: string;
  bundle: EvidenceBundle;
}

/** Number of times to retry on a BUSY / lock-held error before giving up. */
const LOCK_RETRY_ATTEMPTS = 10;
/** Base back-off in ms between BUSY retries. */
const LOCK_RETRY_DELAY_MS = 1000;

/**
 * Return true when the error message indicates that another process holds
 * an exclusive lock on the LadybugDB file.
 */
function isDbBusyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("busy") ||
    msg.includes("lock") ||
    msg.includes("already in use") ||
    msg.includes("cannot read from file") ||
    msg.includes("access is denied") ||
    msg.includes("another process has locked")
  );
}

/**
 * Build evidence bundles grouped by package path for a knowledge type.
 * Returns multiple groups for parallel LLM generation.
 * Includes retry logic for database lock conflicts on Windows.
 *
 * Supports hybrid extraction: static Cypher + LLM supplement when gaps detected.
 */
export async function buildEvidenceBundlesByPackage(
  input: BuildEvidenceInput,
): Promise<EvidenceGroup[]> {
  const { type, target, repoPath, claimsProvider } = input;
  const { lbugPath } = getStoragePaths(repoPath);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      logger.info(
        `Opening graph for ${type} evidence: ${lbugPath} (attempt ${attempt})`,
      );
      const staticGroups = await withReadOnlyLbug(lbugPath, async (query) => {
        switch (type) {
          case "CONCEPT":
            return queryConceptEvidenceByPackage(
              repoPath,
              lbugPath,
              target,
              query,
            );
          case "DATA_MODEL":
            return queryDataModelEvidenceByPackage(repoPath, target, query);
          case "CAPABILITY":
            return queryCapabilityEvidenceByPackage(repoPath, target, query);
          case "BOUNDARY":
            return queryBoundaryEvidenceByPackage(repoPath, target, query);
          case "EXTERNAL":
            return queryExternalEvidenceByPackage(repoPath, target, query);
          case "CONSTRAINT":
            return queryConstraintEvidenceByPackage(repoPath, target, query);
          case "RELATION":
            return queryRelationEvidenceByPackage(repoPath, target, query);
          case "WORKFLOW":
            return queryWorkflowEvidenceByPackage(repoPath, target, query);
          default:
            return [];
        }
      });

      logger.info(
        `Static extraction: ${staticGroups.length} evidence groups for ${type}`,
      );

      // Hybrid extraction: check gaps and supplement with LLM if needed
      if (claimsProvider) {
        const gapAssessment = assessGap(type, staticGroups);
        logger.info(`Gap assessment: ${gapAssessment.reason}`);

        if (gapAssessment.needsLlmSupplement) {
          logger.info(`Triggering LLM supplement for ${type}`);
          const supplementResult = await executeLlmSupplement(
            { type, repoPath, staticGroups, gapReason: gapAssessment.reason },
            claimsProvider,
          );

          const mergedGroups = mergeEvidenceGroups(
            staticGroups,
            supplementResult.groups,
          );
          logger.info(
            `Hybrid result: ${mergedGroups.length} groups (${staticGroups.length} static + ${supplementResult.groups.length} LLM)`,
          );
          return mergedGroups;
        }
      }

      return staticGroups;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isDbBusyError(error) || attempt === LOCK_RETRY_ATTEMPTS) {
        const msg = lastError.message;
        logger.warn(`Graph query failed for ${type}: ${msg}`);
        return [];
      }

      logger.warn(
        `Database lock detected for ${type}, retrying (${attempt}/${LOCK_RETRY_ATTEMPTS})...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt),
      );
    }
  }

  logger.warn(
    `Graph query failed for ${type} after ${LOCK_RETRY_ATTEMPTS} retries`,
  );
  return [];
}

/**
 * Legacy single-bundle function for backward compatibility.
 * @deprecated Use buildEvidenceBundlesByPackage instead.
 */
export async function buildMinimalEvidenceBundle(
  input: BuildEvidenceInput,
): Promise<EvidenceBundle> {
  const groups = await buildEvidenceBundlesByPackage(input);

  if (groups.length === 0) {
    return createEmptyBundle(input.type, input.target);
  }

  // Merge all groups into single bundle
  return mergeGroupsToBundle(groups, input.type, input.target);
}

function createEmptyBundle(
  type: KnowledgeType,
  target?: GenerateTarget,
): EvidenceBundle {
  const targetId = target
    ? `-${target.value.toLowerCase().replace(/\s+/g, "-")}`
    : "";
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  return {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: "unknown" },
    confidence: 0.3,
    risks: ["no_evidence_found"],
    capabilityHints: {
      nameCandidates: target ? [target.value] : [],
      relatedTerms: [],
    },
    entryPoints: [],
    behaviorSlices: [],
    dataContracts: [],
    validationAnchors: [],
    moduleSurfaces: [],
    flowTraces: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
    functionCandidates: [],
  };
}

function mergeGroupsToBundle(
  groups: EvidenceGroup[],
  type: KnowledgeType,
  target?: GenerateTarget,
): EvidenceBundle {
  const targetId = target
    ? `-${target.value.toLowerCase().replace(/\s+/g, "-")}`
    : "";
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  const merged: EvidenceBundle = {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: groups[0]?.bundle.repoProfile?.name || "unknown" },
    confidence: Math.max(...groups.map((g) => g.bundle.confidence)),
    risks: groups.flatMap((g) => g.bundle.risks),
    capabilityHints: {
      nameCandidates: groups.flatMap(
        (g) => g.bundle.capabilityHints?.nameCandidates || [],
      ),
      relatedTerms: groups.flatMap(
        (g) => g.bundle.capabilityHints?.relatedTerms || [],
      ),
    },
    entryPoints: groups.flatMap((g) => g.bundle.entryPoints || []),
    behaviorSlices: groups.flatMap((g) => g.bundle.behaviorSlices || []),
    dataContracts: groups.flatMap((g) => g.bundle.dataContracts || []),
    validationAnchors: groups.flatMap((g) => g.bundle.validationAnchors || []),
    moduleSurfaces: groups.flatMap((g) => g.bundle.moduleSurfaces || []),
    flowTraces: groups.flatMap((g) => g.bundle.flowTraces || []),
    docs: groups.flatMap((g) => g.bundle.docs || []),
    negativeEvidence: groups.flatMap((g) => g.bundle.negativeEvidence || []),
    openQuestions: groups.flatMap((g) => g.bundle.openQuestions || []),
    functionCandidates: groups.flatMap(
      (g) => g.bundle.functionCandidates || [],
    ),
  };

  return merged;
}
