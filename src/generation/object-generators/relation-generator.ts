/**
 * RELATION (能力关系) Generator
 *
 * 构建能力关系知识生成的 prompt，包含：
 * - 关系名称和类型
 * - 参与能力列表
 * - 关系描述
 */

import type { EvidenceBundle } from '../../evidence/evidence-bundle-schema.js';

interface RelationPromptInput {
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
 * Build RELATION generation prompt.
 */
export function buildRelationPrompt(input: RelationPromptInput): { system: string; user: string } {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent relations or capabilities. All output must be Chinese except code identifiers.

CRITICAL RULES:
- relation_name MUST be concise and descriptive (e.g., "订单创建触发库存扣减")
- relation_type MUST be one of: call_dependency, trigger_chain, async_trigger, shared_entity, composition
- participating_capabilities MUST reference existing capabilities from capability_names
- relation_description_zh MUST explain the nature of the relation
- Do NOT create relations between non-existent capabilities
- Do NOT infer relations without evidence support
- Prefer concrete code-based relations

RELATION TYPE MEANINGS:
- call_dependency: Capability A directly calls Capability B (sync method call)
- trigger_chain: Capability A execution triggers Capability B (sync)
- async_trigger: Capability A triggers Capability B via event/message (async)
- shared_entity: Both capabilities operate on the same business entity
- composition: Capability A is composed of B, C, D (orchestrator pattern)`;

  const evidence = buildEvidenceFromBundle(input.evidence_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: 'RELATION', generation_mode: 'bootstrap' },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
        capability_names: input.capability_names ?? [],
      },
      output_schema: {
        id: 'string (RELATION-{relation_name})',
        type: 'RELATION',
        relation_name: 'string (关系名称)',
        relation_type: 'call_dependency | trigger_chain | async_trigger | shared_entity | composition',
        participating_capabilities: 'array of 2+ strings (参与能力名称)',
        relation_description_zh: 'string (关系描述)',
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
      flow_traces: bundle.flowTraces?.slice(0, 10) ?? [],
    },
  };
}