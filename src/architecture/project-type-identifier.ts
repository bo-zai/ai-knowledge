import {
  collectProjectTypeEvidence,
  identifyProjectType,
  saveProjectContext,
  loadProjectContext,
  buildClassificationBase,
} from "../project-classification/index.js";
import type {
  ProjectContext,
  ProjectTypeIdentificationResult,
} from "./project-context.js";

export {
  collectProjectTypeEvidence,
  identifyProjectType,
  saveProjectContext,
  loadProjectContext,
};

export function buildProjectContext(
  result: ProjectTypeIdentificationResult | Record<string, unknown>,
): ProjectContext {
  const base = buildClassificationBase(result);
  return {
    ...base,
    identifiedAt: new Date().toISOString(),
    partitionMode: "degraded-structure",
    partitionModeConfidence: 0,
    partitionModeEvidence: [],
  };
}
