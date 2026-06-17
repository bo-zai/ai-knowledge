import type { EvidenceGroup } from "../../type-evidence-builder.js";

/**
 * Merge static extraction results with LLM supplement results.
 *
 * Priority: Static > LLM supplement (static is higher confidence).
 * Deduplication by groupId.
 */
export function mergeEvidenceGroups(
  staticGroups: EvidenceGroup[],
  llmGroups: EvidenceGroup[],
): EvidenceGroup[] {
  const merged: EvidenceGroup[] = [];
  const seenIds = new Set<string>();

  // Add static groups first (higher priority)
  for (const group of staticGroups) {
    if (!seenIds.has(group.groupId)) {
      seenIds.add(group.groupId);
      merged.push(group);
    }
  }

  // Add LLM supplement groups (deduplicated)
  for (const group of llmGroups) {
    if (!seenIds.has(group.groupId)) {
      seenIds.add(group.groupId);
      // Mark as LLM-derived for transparency
      merged.push({
        ...group,
        bundle: {
          ...group.bundle,
          confidence: Math.min(group.bundle.confidence, 0.7), // Cap confidence for LLM
        },
      });
    } else {
      // Merge fields into existing group if supplement has additional info
      const existingIndex = merged.findIndex(
        (g) => g.groupId === group.groupId,
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = mergeFields(merged[existingIndex], group);
      }
    }
  }

  return merged;
}

/**
 * Merge fields from supplement into existing group.
 * Static fields take precedence.
 */
function mergeFields(
  staticGroup: EvidenceGroup,
  supplementGroup: EvidenceGroup,
): EvidenceGroup {
  const staticBundle = staticGroup.bundle;
  const supplementBundle = supplementGroup.bundle;

  return {
    ...staticGroup,
    bundle: {
      ...staticBundle,
      // Merge arrays - static items first, then supplement items not in static
      entryPoints: mergeArrays(
        staticBundle.entryPoints,
        supplementBundle.entryPoints,
      ),
      behaviorSlices: mergeArrays(
        staticBundle.behaviorSlices,
        supplementBundle.behaviorSlices,
      ),
      flowTraces: mergeArrays(
        staticBundle.flowTraces,
        supplementBundle.flowTraces,
      ),
      dataContracts: mergeArrays(
        staticBundle.dataContracts,
        supplementBundle.dataContracts,
      ),
      validationAnchors: mergeArrays(
        staticBundle.validationAnchors,
        supplementBundle.validationAnchors,
      ),
      moduleSurfaces: mergeArrays(
        staticBundle.moduleSurfaces,
        supplementBundle.moduleSurfaces,
      ),
      // Add LLM-derived open questions
      openQuestions: [
        ...staticBundle.openQuestions,
        ...supplementBundle.openQuestions,
      ],
    },
  };
}

/**
 * Merge two arrays, preserving unique items.
 * Items from first array have priority.
 */
function mergeArrays<T extends { ref?: string }>(
  staticArray: T[],
  supplementArray: T[],
): T[] {
  if (!Array.isArray(staticArray)) return supplementArray || [];
  if (!Array.isArray(supplementArray)) return staticArray;

  const refs = new Set(
    staticArray.map((item) => item.ref || JSON.stringify(item)),
  );

  const result = [...staticArray];
  for (const item of supplementArray) {
    const key = item.ref || JSON.stringify(item);
    if (!refs.has(key)) {
      refs.add(key);
      result.push(item);
    }
  }

  return result;
}
