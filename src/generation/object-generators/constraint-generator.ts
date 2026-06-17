/**
 * CONSTRAINT (约束知识) Generator
 *
 * 构建约束知识生成的 prompt，包含：
 * - 约束名称和类型
 * - 约束描述和触发条件
 * - 作用范围和违反后果
 */

import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";

interface ConstraintPromptInput {
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
 * Build CONSTRAINT generation prompt.
 */
export function buildConstraintPrompt(input: ConstraintPromptInput): {
  system: string;
  user: string;
} {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent constraints. All output must be Chinese except code identifiers.

CRITICAL RULES:
- constraint_name MUST be concise and business-oriented (e.g., "订单金额限制", "库存检查约束")
- constraint_type MUST be one of: business_rule, technical, data
- constraint_description_zh MUST explain the constraint content
- trigger_condition MUST describe when the constraint is checked
- impact_scope MUST list affected capabilities or concepts
- Do NOT include generic validation constraints (e.g., "参数非空检查")
- Do NOT infer constraints without evidence support
- Focus on BUSINESS constraints that provide information value

CONSTRAINT TYPE MEANINGS:
- business_rule: Business logic constraint (e.g., "订单金额必须大于0")
- technical: Technical limitation (e.g., "并发数限制")
- data: Data integrity constraint (e.g., "外键约束")

GENERIC CONSTRAINTS TO SKIP:
- Parameter null/empty validation
- Standard format validation (email, phone)
- Framework-level validation
- Simple type checks`;

  const evidence = buildEvidenceFromBundle(input.evidence_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: "CONSTRAINT", generation_mode: "bootstrap" },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
        capability_names: input.capability_names ?? [],
      },
      output_schema: {
        id: "string (CONSTRAINT-{constraint_name})",
        type: "CONSTRAINT",
        constraint_name: "string (约束名称)",
        constraint_type: "business_rule | technical | data",
        constraint_description_zh: "string (约束描述)",
        trigger_condition: "string (触发条件)",
        impact_scope: "array of strings (作用范围)",
        violation_consequence: "string (optional - 违反后果)",
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
      behavior_slices: bundle.behaviorSlices?.slice(0, 10) ?? [],
    },
  };
}
