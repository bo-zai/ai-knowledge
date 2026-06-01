import type { DiscoverCapabilitiesInput } from '../slicing/capability-discovery.js';
import type { CapabilityCandidate } from '../slicing/capability-candidate-schema.js';
import { discoverCapabilities } from '../slicing/capability-discovery.js';
import { buildEvidenceBundle } from '../evidence/capability-evidence-builder.js';
import { filterCandidateClaims, buildSkeletonClaims, type CandidateClaim } from '../generation/capability-claim-generator.js';
import { assembleCapabilityKnowledgeObjects, type KnowledgeObject } from './capability-object-assembler.js';
import { buildCapabilityKnowledgeFiles, type EvidenceIndexItem, type CapabilityGenerationReport, type CapabilityLlmDebug } from '../packaging/capability-knowledge-writer.js';
import { buildCapabilityDocModel } from './capability-doc-model.js';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import { isTechnicalTerm } from '../generation/capability-claim-generator.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';

export class CapabilityKnowledgeGenerationError extends Error {
  constructor(
    message: string,
    public debugFiles: Array<{ path: string; content: string }>,
  ) {
    super(message);
    this.name = 'CapabilityKnowledgeGenerationError';
  }
}

const BAD_DEFAULT_PHRASES = [
  'is a discovered business capability supported by repository evidence',
  'has a repository-derived execution flow',
  'is a data or schema contract related',
];

function hasBadDefaultPhrase(text: string): boolean {
  const normalized = text.toLowerCase();
  return BAD_DEFAULT_PHRASES.some(phrase => normalized.includes(phrase));
}

function claimIsLlm(claim: CandidateClaim): boolean {
  return (claim.source ?? 'llm') === 'llm';
}

export interface CapabilityLlmMode {
  requested: boolean;
  required: boolean;
  model?: string;
}

export interface CapabilityLlmMetadata {
  requested: boolean;
  required: boolean;
  called: boolean;
  succeeded: boolean;
  fallbackUsed: boolean;
  model?: string;
  error?: string;
  rawClaimCount: number;
  acceptedClaimCount: number;
  skeletonClaimCount: number;
  finalClaimCount: number;
}

export interface CapabilityClaimsProviderResult {
  claims: CandidateClaim[];
  parseError?: string;
  debug?: {
    request?: {
      model?: string;
      systemPrompt: string;
      userPrompt: string;
    };
    response?: {
      rawText?: string;
      error?: string;
    };
  };
  graphTrace?: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
}

export interface RunCapabilityKnowledgePipelineInput {
  repoRoot: string;
  targetTerms?: string[];
  targetPaths?: string[];
  claimsProvider?: (bundle: EvidenceBundle) => Promise<CapabilityClaimsProviderResult>;
  llmMode?: CapabilityLlmMode;
  llmSetupError?: string;
}

export interface RunCapabilityKnowledgePipelineResult {
  files: Array<{ path: string; content: string }>;
  objects: KnowledgeObject[];
  evidenceIndex: EvidenceIndexItem[];
  metadata: {
    capabilityId: string;
    confidence: number;
    objectCount: number;
    llm: CapabilityLlmMetadata;
    warnings: string[];
  };
  report: CapabilityGenerationReport;
  debug?: CapabilityLlmDebug;
}

function buildEvidenceIndexFromBundle(bundle: EvidenceBundle): EvidenceIndexItem[] {
  const items: EvidenceIndexItem[] = [];

  for (const item of bundle.entryPoints) {
    items.push({
      ref: item.ref,
      kind: 'entry',
      location: item.location,
      name: item.name,
      summary: item.description,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.behaviorSlices) {
    items.push({
      ref: item.ref,
      kind: 'behavior',
      location: item.location,
      name: `${item.verb} ${item.object}`,
      summary: item.summary,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.dataContracts) {
    items.push({
      ref: item.ref,
      kind: 'contract',
      location: item.location,
      name: item.name,
      summary: item.description,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.moduleSurfaces) {
    items.push({
      ref: item.ref,
      kind: 'module',
      location: item.rootPath,
      name: item.rootPath,
      summary: item.responsibilities.join('; '),
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.validationAnchors) {
    items.push({
      ref: item.ref,
      kind: 'validation',
      location: item.location,
      name: item.name,
      summary: item.assertion ?? item.oracle,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.flowTraces) {
    items.push({
      ref: item.ref,
      kind: 'flow',
      name: 'flow trace',
      summary: item.steps.map(step => step.action).join(' -> '),
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
    });
  }

  for (const item of bundle.docs) {
    items.push({
      ref: item.ref,
      kind: 'doc',
      location: item.location,
      name: item.terms?.join(', '),
      summary: item.excerpt,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
    });
  }

  return items;
}

function hasNonEmptyArrayMetadata(object: KnowledgeObject, key: string): boolean {
  const value = object.metadata[key];
  return Array.isArray(value) && value.length > 0;
}

function collectTechnicalTermLeakage(objects: KnowledgeObject[]): string[] {
  return objects
    .filter(object => object.type === 'TERM')
    .map(object => String(object.metadata.canonicalTerm ?? object.id.replace(/^TERM-/, '')))
    .filter(term => isTechnicalTerm(term));
}

function buildSyntheticCandidate(targetTerms: string[], targetPaths: string[]): CapabilityCandidate {
  const termKey = targetTerms.length > 0 ? targetTerms.join('-') : 'unknown';
  return {
    candidateId: `CAND-SYNTH-${termKey.toUpperCase()}`,
    nameCandidates: [termKey],
    confidence: 0.55,
    confidenceBreakdown: {
      entrySignal: 0.55,
      behaviorSignal: 0.3,
      dataSignal: 0.3,
      testSignal: 0.2,
      docSignal: 0.4,
      graphCohesion: 0.5,
    },
    primaryEntryPoints: [],
    behaviorAnchors: [],
    dataAnchors: [],
    testAnchors: [],
    docAnchors: [],
    moduleClusters: targetPaths.map(p => ({
      rootPath: p,
      moduleNames: [p.split('/').pop() || p],
      cohesionScore: 0.3,
      targetRelevance: 0.3,
      matchedTerms: [],
    })),
    relatedTerms: [...targetTerms],
    risks: ['no_external_boundary_found'],
    missingSignals: ['No repository evidence — synthetic candidate'],
  };
}

function buildMinimalBundle(candidate: CapabilityCandidate, repoName: string): EvidenceBundle {
  return {
    bundleId: candidate.candidateId.replace('CAND-', 'BUNDLE-'),
    candidateId: candidate.candidateId,
    repoProfile: { name: repoName },
    confidence: candidate.confidence,
    risks: candidate.risks,
    capabilityHints: {
      nameCandidates: candidate.nameCandidates,
      relatedTerms: candidate.relatedTerms,
    },
    entryPoints: [],
    flowTraces: [],
    behaviorSlices: [],
    dataContracts: [],
    moduleSurfaces: candidate.moduleClusters.map((c, i) => ({
      ref: `evidence://module/MOD-${String(i + 1).padStart(3, '0')}`,
      rootPath: c.rootPath,
      exports: c.moduleNames,
      responsibilities: [],
      targetRelevance: c.targetRelevance,
      matchedTerms: c.matchedTerms,
      sourceLocation: c.rootPath,
    })),
    validationAnchors: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

export async function runCapabilityKnowledgePipeline(
  input: RunCapabilityKnowledgePipelineInput,
): Promise<RunCapabilityKnowledgePipelineResult> {
  const { repoRoot, targetTerms = [], targetPaths = [], claimsProvider, llmSetupError } = input;
  const llmMode = input.llmMode ?? { requested: true, required: true };

  if (!claimsProvider) {
    throw new Error('LLM claimsProvider is required for capability knowledge generation');
  }

  const warnings: string[] = [];

  // 处理 LLM setup error
  if (llmSetupError) {
    throw new Error(`LLM generation failed: ${llmSetupError}`);
  }

  // 默认空结果
  const emptyLlmMetadata: CapabilityLlmMetadata = {
    requested: llmMode.requested,
    required: llmMode.required,
    called: false,
    succeeded: false,
    fallbackUsed: false,
    model: llmMode.model,
    rawClaimCount: 0,
    acceptedClaimCount: 0,
    skeletonClaimCount: 0,
    finalClaimCount: 0,
  };

  const emptyResult: RunCapabilityKnowledgePipelineResult = {
    files: [],
    objects: [],
    evidenceIndex: [],
    metadata: {
      capabilityId: '',
      confidence: 0,
      objectCount: 0,
      llm: emptyLlmMetadata,
      warnings,
    },
    report: {
      mode: 'llm',
      llmRequested: true,
      llmRequired: true,
      llmCalled: false,
      llmSucceeded: false,
      model: llmMode.model,
      claimCounts: { llmRaw: 0, llmAccepted: 0, skeletonAdded: 0, final: 0 },
      warnings,
    },
  };

  // Step 1: 发现候选能力
  const discoveryInput: DiscoverCapabilitiesInput = {
    repoRoot,
    targetTerms,
    targetPaths,
  };

  const candidates = await discoverCapabilities(discoveryInput);

  // Step 2: 选择置信度最高的候选（无候选时创建合成候选以支持 provider claims）
  const repoName = repoRoot.split('/').pop() || 'unknown';
  let topCandidate: CapabilityCandidate;
  let bundle: EvidenceBundle;

  if (candidates.length === 0) {
    if (targetTerms.length === 0 && targetPaths.length === 0) {
      return emptyResult;
    }
    topCandidate = buildSyntheticCandidate(targetTerms, targetPaths);
    bundle = buildMinimalBundle(topCandidate, repoName);
  } else {
    topCandidate = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    if (!topCandidate) {
      return emptyResult;
    }
    bundle = buildEvidenceBundle(topCandidate, repoName);
  }

  // Step 4: 获取 claims (必须使用 provider)
  let providerClaims: CandidateClaim[] = [];
  let providerDebug: CapabilityClaimsProviderResult['debug'] | undefined;
  let providerGraphTrace: CapabilityClaimsProviderResult['graphTrace'] | undefined;
  let llmCalled = false;
  let llmSucceeded = false;
  let llmError: string | undefined;

  llmCalled = true;
  try {
    const providerResult = await claimsProvider(bundle);
    providerClaims = providerResult.claims;
    providerDebug = providerResult.debug;
    providerGraphTrace = providerResult.graphTrace;

    // Check if parsing failed
    if (providerResult.parseError) {
      llmError = providerResult.parseError;
      throw new Error(`LLM generation failed: ${llmError}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('LLM generation failed:')) {
      throw error;
    }
    throw new Error(`LLM generation failed: ${message}`);
  }

  const filteredProviderClaims = filterCandidateClaims(providerClaims, bundle);
  const skeletonClaims = filterCandidateClaims(buildSkeletonClaims(bundle), bundle);

  const hasAcceptedNonOpenProviderClaim = filteredProviderClaims.some(claim => claim.suggestedType !== 'OPEN');

  if (!hasAcceptedNonOpenProviderClaim) {
    llmSucceeded = false;
    llmError = llmError ?? 'LLM generation produced no accepted non-OPEN claims after evidence filtering';
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  // 质量门禁：LLM 必须生成 CAP claim
  const llmClaims = filteredProviderClaims.filter(claim => claimIsLlm(claim));
  const hasLlmCap = llmClaims.some(claim => claim.suggestedType === 'CAP' && !hasBadDefaultPhrase(claim.claimText));
  if (!hasLlmCap) {
    llmSucceeded = false;
    llmError = 'LLM CAP claim is required for business capability knowledge';
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  // 质量门禁：LLM 必须生成 FLOW 或 CON claim
  const hasLlmFlowOrCon = llmClaims.some(claim =>
    (claim.suggestedType === 'FLOW' || claim.suggestedType === 'CON') &&
    !hasBadDefaultPhrase(claim.claimText),
  );
  if (!hasLlmFlowOrCon) {
    llmSucceeded = false;
    llmError = 'LLM FLOW or CON claim is required for business capability knowledge';
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  llmSucceeded = true;
  const claims = mergeClaimsByTypeAndText(filteredProviderClaims, skeletonClaims);

  // 统计 claim counts
  const rawClaimCount = providerClaims.length;
  const acceptedClaimCount = filteredProviderClaims.length;
  const skeletonClaimCount = skeletonClaims.length;
  const finalClaimCount = claims.length;
  const fallbackUsed = false;

  // Step 6: 组装知识对象
  const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });

  if (objects.length === 0) {
    return emptyResult;
  }

  // 最终对象质量门禁
  const capFromLlm = objects.some(o => o.type === 'CAP' && o.metadata.source === 'llm');
  const flowOrConFromLlm = objects.some(o =>
    (o.type === 'FLOW' || o.type === 'CON') && o.metadata.source === 'llm',
  );
  const modPresent = objects.some(o => o.type === 'MOD');
  const modHasTouchGuidance = objects.some(o =>
    o.type === 'MOD' &&
    o.metadata.source === 'llm' &&
    hasNonEmptyArrayMetadata(o, 'touchWhen') &&
    hasNonEmptyArrayMetadata(o, 'doNotTouchWhen'),
  );
  const verHasOracle = objects.some(o =>
    o.type === 'VER' &&
    hasNonEmptyArrayMetadata(o, 'acceptanceOracle') &&
    typeof o.metadata.verificationGoal === 'string' &&
    o.metadata.verificationGoal.length > 0,
  );
  const openHasMinimalNextEvidence = objects.some(o =>
    o.type === 'OPEN' &&
    o.blockedDecisions.length > 0 &&
    hasNonEmptyArrayMetadata(o, 'minimalNextEvidence'),
  );
  const verOrValidationOpenPresent = verHasOracle || openHasMinimalNextEvidence;
  const technicalTermLeakage = collectTechnicalTermLeakage(objects);
  const noTechnicalTermLeakage = technicalTermLeakage.length === 0;

  if (!capFromLlm) throw new CapabilityKnowledgeGenerationError('LLM generation failed: LLM CAP object is required', []);
  if (!flowOrConFromLlm) throw new CapabilityKnowledgeGenerationError('LLM generation failed: LLM FLOW or CON object is required', []);
  if (!modPresent) throw new CapabilityKnowledgeGenerationError('LLM generation failed: MOD object is required', []);
  if (!modHasTouchGuidance) throw new CapabilityKnowledgeGenerationError('LLM generation failed: LLM MOD touch guidance is required for business capability knowledge', []);
  if (!verOrValidationOpenPresent) throw new CapabilityKnowledgeGenerationError('LLM generation failed: validation oracle or validation OPEN is required', []);
  if (!noTechnicalTermLeakage) {
    const debugFiles = buildCapabilityKnowledgeFiles({ objects, capabilityId: topCandidate.candidateId, evidenceIndex: buildEvidenceIndexFromBundle(bundle), report: { mode: 'llm', llmRequested: true, llmRequired: true, llmCalled, llmSucceeded: false, model: llmMode.model, claimCounts: { llmRaw: 0, llmAccepted: 0, skeletonAdded: 0, final: 0 }, warnings: [`Technical TERM leakage: ${technicalTermLeakage.join(', ')}`] }, debug: providerDebug });
    throw new CapabilityKnowledgeGenerationError(`LLM generation failed: technical TERM leakage: ${technicalTermLeakage.join(', ')}`, debugFiles);
  }

  // Step 7: 找到 CAP 对象的 ID 作为 capabilityId
  const capObject = objects.find(o => o.type === 'CAP');
  const capabilityId = capObject?.id || 'UNKNOWN-CAPABILITY';

  // Guard against repository fallback capability only when no explicit target
  const noExplicitTarget = input.targetTerms.length === 0 && input.targetPaths.length === 0;
  if (isRepositoryFallbackCapability(capabilityId, topCandidate.candidateId) && noExplicitTarget) {
    throw new CapabilityKnowledgeGenerationError(
      'Capability generation failed: repository-level fallback capability is not a valid business capability',
      buildCapabilityKnowledgeFiles({
        objects,
        capabilityId,
        evidenceIndex: buildEvidenceIndexFromBundle(bundle),
        report: {
          mode: 'llm',
          capabilityGenerationMode: 'single',
          selectedCandidateId: topCandidate.candidateId,
          candidateCount: candidates.length,
          llmRequested: true,
          llmRequired: true,
          llmCalled,
          llmSucceeded: false,
          llmRuntime: 'langgraph',
          model: llmMode.model,
          claimCounts: {
            llmRaw: rawClaimCount,
            llmAccepted: acceptedClaimCount,
            skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
            final: finalClaimCount,
          },
          warnings: ['Repository fallback capability is not a valid business capability'],
        },
        debug: providerDebug,
      }),
    );
  }

  // Step 8: 构建证据索引
  const evidenceIndex = buildEvidenceIndexFromBundle(bundle);

  // 文档模型可用性检查
  const docModel = buildCapabilityDocModel({ objects, capabilityId, evidenceIndex });
  const docHasSummary = docModel.summaryZh.trim().length > 0;
  const docHasCodeAnchors = docModel.codeAnchors.length > 0;
  const docHasValidation = docModel.validation.length > 0;

  if (!docHasSummary) {
    throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown summary is empty', []);
  }
  if (!docHasCodeAnchors) {
    throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown has no code anchors', []);
  }
  if (!docHasValidation) {
    throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown has no validation section', []);
  }

  // 构建 LLM metadata
  const llmMetadata: CapabilityLlmMetadata = {
    requested: llmMode.requested,
    required: llmMode.required,
    called: llmCalled,
    succeeded: llmSucceeded,
    fallbackUsed,
    model: llmMode.model,
    error: llmError,
    rawClaimCount,
    acceptedClaimCount,
    skeletonClaimCount,
    finalClaimCount,
  };

  // 构建 report
  const report: CapabilityGenerationReport = {
    mode: 'llm',
    capabilityGenerationMode: 'single',
    selectedCandidateId: topCandidate.candidateId,
    candidateCount: candidates.length,
    llmRequested: true,
    llmRequired: true,
    llmCalled,
    llmSucceeded,
    llmRuntime: 'langgraph',
    model: llmMode.model,
    graph: providerGraphTrace,
    claimCounts: {
      llmRaw: rawClaimCount,
      llmAccepted: acceptedClaimCount,
      skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
      final: finalClaimCount,
    },
    objectSourceCounts: countObjectSources(objects),
    requiredBusinessObjects: {
      capFromLlm,
      flowOrConFromLlm,
      modPresent,
      modHasTouchGuidance,
      verOrValidationOpenPresent,
      verHasOracle,
      openHasMinimalNextEvidence,
      noTechnicalTermLeakage,
    },
    technicalTermLeakage,
    warnings,
  };

  // 构建 debug
  const debug: CapabilityLlmDebug | undefined = providerDebug ? {
    request: providerDebug.request,
    response: providerDebug.response,
    graphTrace: providerGraphTrace,
  } : undefined;

  // Step 9: 生成文件
  const files = buildCapabilityKnowledgeFiles({ objects, capabilityId, evidenceIndex, report, debug });

  return {
    files,
    objects,
    evidenceIndex,
    metadata: {
      capabilityId,
      confidence: topCandidate.confidence,
      objectCount: objects.length,
      llm: llmMetadata,
      warnings,
    },
    report,
    debug,
  };
}

function isRepositoryFallbackCapability(capabilityId: string, candidateId?: string): boolean {
  return capabilityId === 'CAP-REPOSITORY-CAPABILITY' || candidateId === 'CAND-';
}

function countObjectSources(objects: KnowledgeObject[]): { llm: number; skeleton: number; evidence_seed: number } {
  const counts = { llm: 0, skeleton: 0, evidence_seed: 0 };
  for (const obj of objects) {
    const source = obj.metadata.source;
    if (source === 'skeleton') counts.skeleton += 1;
    else if (source === 'evidence_seed') counts.evidence_seed += 1;
    else counts.llm += 1;
  }
  return counts;
}

function mergeClaimsByTypeAndText(
  providerClaims: CandidateClaim[],
  skeletonClaims: CandidateClaim[],
): CandidateClaim[] {
  const result: CandidateClaim[] = [...providerClaims];
  const providerKeys = new Set(
    providerClaims.map(c => `${c.suggestedType}:${c.claimText}`),
  );

  // Track which types the LLM already provides (ignoring bad default phrases)
  const llmProvidedTypes = new Set(
    providerClaims
      .filter(c => claimIsLlm(c) && !hasBadDefaultPhrase(c.claimText))
      .map(c => c.suggestedType),
  );

  for (const skeleton of skeletonClaims) {
    const key = `${skeleton.suggestedType}:${skeleton.claimText}`;
    if (providerKeys.has(key)) continue;

    // Suppress skeleton claims for types the LLM already provides with quality content
    if (llmProvidedTypes.has(skeleton.suggestedType)) continue;

    result.push(skeleton);
  }

  return result;
}

const TYPE_TO_DIR: Record<string, string> = {
  CAP: 'capabilities',
  TERM: 'terms',
  FLOW: 'flows',
  MOD: 'modules',
  CON: 'contracts',
  VER: 'validation',
  OPEN: 'open',
};

export function capabilityResultToContribution(
  result: RunCapabilityKnowledgePipelineResult,
): KnowledgePackageContribution {
  return {
    stage: 'capability',
    files: result.files.filter(f => f.path !== 'catalog.yaml'),
    objects: result.objects.map(obj => ({
      id: obj.id,
      type: obj.type,
      path: `objects/${TYPE_TO_DIR[obj.type] || 'unknown'}/${obj.id}.yaml`,
    })),
    report: {
      stage: 'capability',
      ran: true,
      succeeded: result.objects.length,
      failed: 0,
      details: {
        capabilityGenerationMode: 'single',
        selectedCandidateId: result.report.selectedCandidateId,
        candidateCount: result.report.candidateCount,
        llmRuntime: 'langgraph',
        llmCalled: result.metadata.llm.called,
        llmSucceeded: result.metadata.llm.succeeded,
        objectSourceCounts: result.report.objectSourceCounts,
        requiredBusinessObjects: result.report.requiredBusinessObjects,
      },
    },
    warnings: result.metadata.warnings,
  };
}