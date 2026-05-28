import type { DiscoverCapabilitiesInput } from '../slicing/capability-discovery.js';
import { discoverCapabilities } from '../slicing/capability-discovery.js';
import { buildEvidenceBundle } from '../evidence/capability-evidence-builder.js';
import { filterCandidateClaims, type CandidateClaim } from '../generation/capability-claim-generator.js';
import { assembleCapabilityKnowledgeObjects } from './capability-object-assembler.js';
import { buildCapabilityKnowledgeFiles } from '../packaging/capability-knowledge-writer.js';

export interface RunCapabilityKnowledgePipelineInput {
  repoRoot: string;
  targetTerms?: string[];
  targetPaths?: string[];
  claimsProvider?: () => Promise<CandidateClaim[]>;
}

export interface RunCapabilityKnowledgePipelineResult {
  files: Array<{ path: string; content: string }>;
  metadata: {
    capabilityId: string;
    confidence: number;
    objectCount: number;
  };
}

export async function runCapabilityKnowledgePipeline(
  input: RunCapabilityKnowledgePipelineInput,
): Promise<RunCapabilityKnowledgePipelineResult> {
  const { repoRoot, targetTerms = [], targetPaths = [], claimsProvider } = input;

  // 默认返回空结果
  const emptyResult: RunCapabilityKnowledgePipelineResult = {
    files: [],
    metadata: {
      capabilityId: '',
      confidence: 0,
      objectCount: 0,
    },
  };

  // Step 1: 发现候选能力
  const discoveryInput: DiscoverCapabilitiesInput = {
    repoRoot,
    targetTerms,
    targetPaths,
  };

  const candidates = await discoverCapabilities(discoveryInput);

  if (candidates.length === 0) {
    return emptyResult;
  }

  // Step 2: 选择置信度最高的候选
  const topCandidate = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!topCandidate) {
    return emptyResult;
  }

  // Step 3: 构建证据包
  const repoName = repoRoot.split('/').pop() || 'unknown';
  const bundle = buildEvidenceBundle(topCandidate, repoName);

  // Step 4: 获取 claims (使用注入的 provider 或默认空)
  const rawClaims = claimsProvider ? await claimsProvider() : [];

  // Step 5: 过滤 claims
  const claims = filterCandidateClaims(rawClaims, bundle);

  // Step 6: 组装知识对象
  const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });

  if (objects.length === 0) {
    return emptyResult;
  }

  // Step 7: 找到 CAP 对象的 ID 作为 capabilityId
  const capObject = objects.find(o => o.type === 'CAP');
  const capabilityId = capObject?.id || 'UNKNOWN-CAPABILITY';

  // Step 8: 生成文件
  const files = buildCapabilityKnowledgeFiles({ objects, capabilityId });

  return {
    files,
    metadata: {
      capabilityId,
      confidence: topCandidate.confidence,
      objectCount: objects.length,
    },
  };
}