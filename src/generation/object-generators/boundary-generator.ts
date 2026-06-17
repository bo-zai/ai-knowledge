/**
 * BOUNDARY (边界知识) Generator
 *
 * 构建边界知识生成的 prompt，包含：
 * - 边界标题和类型
 * - 详细描述
 * - 关联能力
 */

import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";

interface BoundaryPromptInput {
  /** 证据包 */
  evidence_bundle?: EvidenceBundle;
  /** 仓库名称 */
  repoName?: string;
  /** 已生成的概念名称列表（用于引用） */
  concept_names?: string[];
  /** 已生成的能力名称列表（用于引用） */
  capability_names?: string[];
}

/**
 * Build BOUNDARY generation prompt.
 */
export function buildBoundaryPrompt(input: BoundaryPromptInput): {
  system: string;
  user: string;
} {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent boundaries or capabilities. All output must be Chinese except code identifiers.

CRITICAL RULES:
- boundary_title MUST be concise and business-oriented (e.g., "支付功能限制", "未启用的短信通知")
- boundary_type MUST be either 'limitation' (局限性) or 'disabled_feature' (禁用功能)
- detailed_description_zh MUST explain what the boundary is and why it exists
- related_capability MUST reference an existing capability from capability_names if provided
- Do NOT infer boundaries without evidence support
- Prefer concise descriptions (one to two sentences)

BOUNDARY TYPE MEANINGS:
- limitation: A known limitation of an existing capability (e.g., "不支持退款金额超过订单总额")
- disabled_feature: A feature that is intentionally disabled or not implemented (e.g., "短信通知功能已禁用")`;

  const evidence = buildEvidenceFromBundle(input.evidence_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: "BOUNDARY", generation_mode: "bootstrap" },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
        capability_names: input.capability_names ?? [],
      },
      output_schema: {
        id: "string (BOUNDARY-{boundary_title})",
        type: "BOUNDARY",
        boundary_title: "string (简短描述边界内容)",
        boundary_type: "limitation | disabled_feature",
        detailed_description_zh: "string (该边界的具体描述)",
        related_capability: "string (optional - 关联的能力名称)",
        name_zh: "string (中文显示名称)",
        summary_zh: "string (一句话定位)",
        applicable_scope: "string (适用范围)",
        tags: "array of 1-3 strings",
        evidence: "array of file paths",
      },
    },
    null,
    2,
  );

  return { system, user };
}

/**
 * Build structured evidence from EvidenceBundle.
 */
function buildEvidenceFromBundle(
  bundle: EvidenceBundle | undefined,
): Record<string, unknown> {
  if (!bundle) {
    return { evidence_bundle: null };
  }

  return {
    evidence_bundle: {
      bundle_id: bundle.bundleId,
      repo_profile: bundle.repoProfile,
      confidence: bundle.confidence,
      risks: bundle.risks,
      docs: bundle.docs?.slice(0, 5) ?? [],
      related_terms: bundle.capabilityHints?.relatedTerms ?? [],
    },
  };
}
