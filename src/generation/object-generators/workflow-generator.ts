/**
 * WORKFLOW (跨域业务流程) Generator
 *
 * 构建跨域业务流程知识生成的 prompt，包含：
 * - 流程名称和业务目标
 * - 涉及域和流程步骤
 * - 触发条件和完成标志
 */

import type { EvidenceBundle } from '../../evidence/evidence-bundle-schema.js';

interface WorkflowPromptInput {
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
 * Build WORKFLOW generation prompt.
 */
export function buildWorkflowPrompt(input: WorkflowPromptInput): { system: string; user: string } {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent workflows or domains. All output must be Chinese except code identifiers.

CRITICAL RULES:
- workflow_name MUST be business-oriented (e.g., "用户下单完整流程", "商品上架审核流程")
- business_goal MUST describe the end-to-end business objective
- involved_domains MUST reference at least 2 capabilities from capability_names
- steps MUST describe the ordered sequence of actions
- trigger_condition MUST describe how the workflow starts
- completion_flag MUST describe the success end state
- Do NOT create workflows within a single domain
- Do NOT infer workflows without evidence support
- Focus on cross-domain flows visible in code

WORKFLOW REQUIREMENTS:
- Must involve at least 2 different capability domains
- Steps must be ordered and traceable
- Each step must belong to a domain
- Must provide clear start and end conditions`;

  const evidence = buildEvidenceFromBundle(input.evidence_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: 'WORKFLOW', generation_mode: 'bootstrap' },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
        capability_names: input.capability_names ?? [],
      },
      output_schema: {
        id: 'string (WORKFLOW-{workflow_name})',
        type: 'WORKFLOW',
        workflow_name: 'string (流程名称)',
        business_goal: 'string (业务目标)',
        involved_domains: 'array of 2+ strings (涉及的能力域)',
        steps: [
          {
            order: 'number (步骤序号)',
            domain: 'string (所属能力域)',
            action: 'string (操作名称)',
            description: 'string (步骤描述)',
          },
        ],
        trigger_condition: 'string (触发条件)',
        completion_flag: 'string (完成标志)',
        key_branches: 'array of strings (optional - 关键分支)',
        name_zh: 'string (中文显示名称)',
        summary_zh: 'string (一句话定位)',
        applicable_scope: 'string (适用范围)',
        tags: 'array of 1-3 strings',
        evidence: 'array of file paths',
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
function buildEvidenceFromBundle(bundle: EvidenceBundle | undefined): Record<string, unknown> {
  if (!bundle) {
    return { evidence_bundle: null };
  }

  return {
    evidence_bundle: {
      bundle_id: bundle.bundleId,
      repo_profile: bundle.repoProfile,
      confidence: bundle.confidence,
      flow_traces: bundle.flowTraces?.slice(0, 15) ?? [],
    },
  };
}