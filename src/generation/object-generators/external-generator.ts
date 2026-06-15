/**
 * EXTERNAL (外部系统交互) Generator
 *
 * 构建外部系统交互知识生成的 prompt，包含：
 * - 外部系统名称
 * - 交互目的和方式
 * - 当前仓库角色
 * - 可见交互范围
 */

import type { EvidenceBundle } from '../../evidence/evidence-bundle-schema.js';

interface ExternalPromptInput {
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
 * Build EXTERNAL generation prompt.
 */
export function buildExternalPrompt(input: ExternalPromptInput): { system: string; user: string } {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent external systems or interactions. All output must be Chinese except code identifiers.

CRITICAL RULES:
- external_system_name MUST be a real external system name (e.g., "支付宝", "微信支付", "阿里云OSS")
- interaction_purpose_zh MUST explain the business purpose of the interaction
- interaction_method MUST be one of: sdk, http_api, callback, data_exchange, rpc
- repository_role MUST be one of: caller, callee, data_producer, data_consumer
- visible_interaction_scope MUST list concrete operations visible from code
- Do NOT describe external system internal behavior
- Do NOT infer interactions without evidence support
- Prefer concise descriptions

INTERACTION METHOD MEANINGS:
- sdk: Using official SDK or client library
- http_api: Direct HTTP API calls
- callback: Receiving callbacks from external system
- data_exchange: Data file exchange (CSV, JSON files)
- rpc: RPC protocol calls (Dubbo, gRPC)

REPOSITORY ROLE MEANINGS:
- caller: Current repo calls external system
- callee: External system calls current repo
- data_producer: Current repo produces data for external system
- data_consumer: Current repo consumes data from external system`;

  const evidence = buildEvidenceFromBundle(input.evidence_bundle);

  const user = JSON.stringify(
    {
      task: { object_type: 'EXTERNAL', generation_mode: 'bootstrap' },
      evidence,
      context: {
        repo_name: input.repoName,
        concept_names: input.concept_names ?? [],
        capability_names: input.capability_names ?? [],
      },
      output_schema: {
        id: 'string (EXTERNAL-{external_system_name})',
        type: 'EXTERNAL',
        external_system_name: 'string (外部系统名称)',
        interaction_purpose_zh: 'string (交互目的)',
        interaction_method: 'sdk | http_api | callback | data_exchange | rpc',
        repository_role: 'caller | callee | data_producer | data_consumer',
        interaction_entry: 'string (optional - 交互入口代码位置)',
        visible_interaction_scope: 'array of strings (可见交互操作列表)',
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
      behavior_slices: bundle.behaviorSlices?.slice(0, 10) ?? [],
    },
  };
}