import {
  collectProjectTypeEvidence,
  identifyProjectType,
  saveProjectContext,
  loadProjectContext,
  buildClassificationBase,
  resolvePartitionMode,
} from "../project-classification/index.js";
import type {
  ProjectContext,
  ProjectTypeIdentificationResult,
  ProjectTypeEvidence,
} from "./project-context.js";

export {
  collectProjectTypeEvidence,
  identifyProjectType,
  saveProjectContext,
  loadProjectContext,
};

/**
 * 构建项目上下文（轻量级版本，仅基于识别结果）
 *
 * 注意：此函数返回硬编码的 partitionMode='degraded-structure'，因为缺少完整证据。
 * 如需动态解析 partitionMode，请使用 classify-repository.ts 中的完整流程。
 */
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

/**
 * 构建完整项目上下文（包含动态 partitionMode 解析）
 *
 * 此函数需要完整的证据数据才能正确解析 partitionMode。
 */
export function buildProjectContextWithEvidence(
  result: ProjectTypeIdentificationResult | Record<string, unknown>,
  evidence: ProjectTypeEvidence,
): ProjectContext {
  const base = buildClassificationBase(result);
  const partitionModeResult = resolvePartitionMode(evidence, {
    projectType: base.projectType,
    primaryLanguage: base.primaryLanguage,
    framework: base.framework,
    techStack: base.techStack,
    confidence: base.confidence,
    identificationEvidence: base.identificationEvidence,
  });

  return {
    ...base,
    identifiedAt: new Date().toISOString(),
    partitionMode: partitionModeResult.partitionMode,
    partitionModeConfidence: partitionModeResult.confidence,
    partitionModeEvidence: partitionModeResult.evidence,
  };
}
