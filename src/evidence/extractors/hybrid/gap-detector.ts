import type { KnowledgeType } from "../../../schemas/knowledge-type.js";
import type { EvidenceGroup } from "../../type-evidence-builder.js";

/**
 * Gap assessment thresholds for each knowledge type
 */
export const GAP_THRESHOLDS: Record<
  KnowledgeType,
  {
    minCount: number;
    triggerRatio: number;
  }
> = {
  ARCHITECTURE: { minCount: 1, triggerRatio: 0.5 },
  BOUNDARY: { minCount: 3, triggerRatio: 0.4 },
  CAPABILITY: { minCount: 3, triggerRatio: 0.5 },
  CONCEPT: { minCount: 5, triggerRatio: 0.3 },
  CONSTRAINT: { minCount: 2, triggerRatio: 0.4 },
  DATA_MODEL: { minCount: 5, triggerRatio: 0.3 },
  EXTERNAL: { minCount: 2, triggerRatio: 0.4 },
  RELATION: { minCount: 2, triggerRatio: 0.4 },
  WORKFLOW: { minCount: 2, triggerRatio: 0.5 },
};

/**
 * Gap detection result
 */
export interface GapAssessment {
  needsLlmSupplement: boolean;
  reason: string;
  staticCount: number;
  threshold: { minCount: number; triggerRatio: number };
  fieldCompleteness?: number;
}

/**
 * Assess whether static extraction results are sufficient
 * or need LLM supplement.
 *
 * Trigger conditions:
 * 1. Static results empty → MUST trigger LLM
 * 2. Count below threshold → trigger LLM supplement
 * 3. Field info missing ratio high → trigger LLM for fields
 * 4. Results sufficient → NO LLM (cost control)
 */
export function assessGap(
  type: KnowledgeType,
  staticGroups: EvidenceGroup[],
): GapAssessment {
  const threshold = GAP_THRESHOLDS[type];
  const staticCount = staticGroups.length;

  // Condition 1: Empty results → MUST trigger
  if (staticCount === 0) {
    return {
      needsLlmSupplement: true,
      reason: "静态抽取结果为空，必须触发LLM补充",
      staticCount: 0,
      threshold,
    };
  }

  // Condition 2: Count below minimum threshold
  if (staticCount < threshold.minCount) {
    return {
      needsLlmSupplement: true,
      reason: `静态抽取数量(${staticCount})低于最小阈值(${threshold.minCount})`,
      staticCount,
      threshold,
    };
  }

  // Condition 3: Check field completeness
  const completeness = assessFieldCompleteness(staticGroups);
  if (completeness < threshold.triggerRatio) {
    return {
      needsLlmSupplement: true,
      reason: `字段完整度(${completeness.toFixed(2)})低于阈值(${threshold.triggerRatio})`,
      staticCount,
      threshold,
      fieldCompleteness: completeness,
    };
  }

  // Condition 4: Results sufficient
  return {
    needsLlmSupplement: false,
    reason: `静态抽取结果充足(${staticCount}个，完整度${completeness.toFixed(2)})`,
    staticCount,
    threshold,
    fieldCompleteness: completeness,
  };
}

/**
 * Calculate field completeness ratio.
 * Checks if evidence bundles have essential fields filled.
 */
function assessFieldCompleteness(groups: EvidenceGroup[]): number {
  if (groups.length === 0) return 0;

  const essentialFields = ["entryPoints", "behaviorSlices", "flowTraces"];

  let filledCount = 0;
  let totalChecks = 0;

  for (const group of groups) {
    const bundle = group.bundle;
    for (const field of essentialFields) {
      totalChecks++;
      const value = bundle[field as keyof typeof bundle];
      if (Array.isArray(value) && value.length > 0) {
        filledCount++;
      }
    }
  }

  return filledCount / totalChecks;
}
