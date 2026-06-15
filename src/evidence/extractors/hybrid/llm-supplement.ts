import type { EvidenceGroup } from '../../type-evidence-builder.js';
import type { KnowledgeType } from '../../../schemas/knowledge-type.js';
import type { LlmClaimsProvider } from '../../../generation/knowledge-generator.js';
import { TYPE_SUPPLEMENT_STRATEGY } from './hybrid-config.js';
import { PromptLoader } from '../../../shared/prompt-loader.js';
import { logger } from '../../../shared/logger.js';

/**
 * LLM supplement input
 */
export interface LlmSupplementInput {
  type: KnowledgeType;
  repoPath: string;
  staticGroups: EvidenceGroup[];
  gapReason: string;
}

/**
 * LLM supplement result
 */
export interface LlmSupplementResult {
  groups: EvidenceGroup[];
  modelUsed: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
  warnings: string[];
}

/**
 * Execute LLM supplement when static extraction insufficient.
 *
 * Uses type-specific prompts to extract additional evidence
 * from code context that static Cypher cannot capture.
 */
export async function executeLlmSupplement(
  input: LlmSupplementInput,
  claimsProvider: LlmClaimsProvider,
): Promise<LlmSupplementResult> {
  const { type, repoPath, staticGroups, gapReason } = input;
  const strategy = TYPE_SUPPLEMENT_STRATEGY[type];

  if (!strategy) {
    return {
      groups: [],
      modelUsed: 'none',
      warnings: [`No supplement strategy for type ${type}`],
    };
  }

  logger.info(`LLM supplement triggered for ${type}: ${gapReason}`);

  // Load supplement prompt template
  const promptTemplate = PromptLoader.load('evidence-supplement');

  // Build context from static groups
  const staticContext = buildStaticContext(staticGroups);

  // Build user prompt with type-specific focus areas
  const userPrompt = `
## 知识类型: ${type}

## 补充焦点: ${strategy.focusAreas.join(', ')}

## 静态抽取结果摘要:
${staticContext}

## 任务:
基于上述静态抽取结果，请识别并补充以下内容：
1. 静态抽取遗漏的关键信息
2. ${strategy.focusAreas.map((f: string) => `-${f}`).join('\n')}

请返回JSON格式的补充证据，结构如下：
{
  "supplementGroups": [
    {
      "groupId": "SUPPLEMENT-xxx",
      "packagePath": "...",
      "bundle": {
        "entryPoints": [...],
        "behaviorSlices": [...],
        "flowTraces": [...],
        ...
      }
    }
  ]
}
`;

  try {
    const result = await claimsProvider(promptTemplate.raw, userPrompt);

    // Parse supplement groups from LLM response
    const parsed = parseSupplementResponse(result.rawText, type, repoPath);

    return {
      groups: parsed.groups,
      modelUsed: result.model,
      tokenUsage: result.usage,
      warnings: parsed.warnings,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`LLM supplement failed: ${msg}`);
    return {
      groups: [],
      modelUsed: 'failed',
      warnings: [msg],
    };
  }
}

/**
 * Build context summary from static groups for LLM input.
 */
function buildStaticContext(groups: EvidenceGroup[]): string {
  if (groups.length === 0) {
    return '静态抽取无结果';
  }

  const lines: string[] = [];
  lines.push(`已提取 ${groups.length} 个证据组:`);

  for (const group of groups.slice(0, 5)) { // Limit to 5 for context
    lines.push(`- ${group.groupId} (${group.packagePath})`);

    const bundle = group.bundle;
    if (bundle.entryPoints?.length > 0) {
      lines.push(`  入口点: ${bundle.entryPoints.length}`);
    }
    if (bundle.flowTraces?.length > 0) {
      lines.push(`  流程追踪: ${bundle.flowTraces.length}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse LLM supplement response into evidence groups.
 */
function parseSupplementResponse(
  rawText: string,
  type: KnowledgeType,
  repoPath: string,
): { groups: EvidenceGroup[]; warnings: string[] } {
  const warnings: string[] = [];

  // Extract JSON
  let jsonText = rawText.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  }
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  try {
    const parsed = JSON.parse(jsonText);

    if (!parsed.supplementGroups || !Array.isArray(parsed.supplementGroups)) {
      warnings.push('LLM response missing supplementGroups array');
      return { groups: [], warnings };
    }

    const groups: EvidenceGroup[] = parsed.supplementGroups.map((item: any) => ({
      groupId: item.groupId || `SUPPLEMENT-${Date.now()}`,
      packagePath: item.packagePath || 'unknown',
      bundle: {
        bundleId: `BUNDLE-SUPPLEMENT-${type}`,
        candidateId: `CAND-SUPPLEMENT-${item.groupId || Date.now()}`,
        repoProfile: { name: repoPath.split('/').pop() || 'unknown' },
        confidence: 0.6, // Lower confidence for LLM-derived
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: item.bundle?.entryPoints || [],
        behaviorSlices: item.bundle?.behaviorSlices || [],
        dataContracts: item.bundle?.dataContracts || [],
        validationAnchors: item.bundle?.validationAnchors || [],
        moduleSurfaces: item.bundle?.moduleSurfaces || [],
        flowTraces: item.bundle?.flowTraces || [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    }));

    return { groups, warnings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to parse supplement response: ${msg}`);
    warnings.push(`Raw text (first 300 chars): ${rawText.slice(0, 300)}`);
    return { groups: [], warnings };
  }
}