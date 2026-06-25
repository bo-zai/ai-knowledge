import type { DiscoverCapabilitiesInput } from "../slicing/capability-discovery.js";
import type { CapabilityCandidate } from "../slicing/capability-candidate-schema.js";
import { discoverCapabilities } from "../slicing/capability-discovery.js";
import { buildEvidenceBundle } from "../evidence/capability-evidence-builder.js";
import {
  filterCandidateClaims,
  buildSkeletonClaims,
  type CandidateClaim,
} from "../generation/capability-claim-generator.js";
import {
  assembleCapabilityKnowledgeObjects,
  makeObjectId,
  type KnowledgeObject,
} from "./capability-object-assembler.js";
import {
  buildCapabilityKnowledgeFiles,
  type EvidenceIndexItem,
  type CapabilityGenerationReport,
  type CapabilityLlmDebug,
} from "../packaging/capability-knowledge-writer.js";
import { buildCapabilityDocModel } from "./capability-doc-model.js";
import type { EvidenceBundle } from "../evidence/evidence-bundle-schema.js";
import { isTechnicalTerm } from "../generation/capability-claim-generator.js";
import type { KnowledgePackageContribution } from "../packaging/knowledge-package-contribution.js";

export class CapabilityKnowledgeGenerationError extends Error {
  constructor(
    message: string,
    public debugFiles: Array<{ path: string; content: string }>,
  ) {
    super(message);
    this.name = "CapabilityKnowledgeGenerationError";
  }
}

const BAD_DEFAULT_PHRASES = [
  "is a discovered business capability supported by repository evidence",
  "has a repository-derived execution flow",
  "is a data or schema contract related",
];

const GENERIC_CAPABILITY_NAME_TERMS = new Set([
  "admin",
  "all",
  "api",
  "app",
  "capability",
  "controller",
  "impl",
  "manager",
  "module",
  "portal",
  "repository",
  "service",
  "system",
]);

const LOW_VALUE_CAPABILITY_START_TERMS = new Set([
  "find",
  "get",
  "list",
  "query",
  "search",
]);

function hasBadDefaultPhrase(text: string): boolean {
  const normalized = text.toLowerCase();
  return BAD_DEFAULT_PHRASES.some((phrase) => normalized.includes(phrase));
}

function claimIsLlm(claim: CandidateClaim): boolean {
  return (claim.source ?? "llm") === "llm";
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
  domainKey?: string;
  domainName?: string;
  modulePaths?: string[];
  evidenceBundle?: EvidenceBundle;
  claimsProvider?: (
    bundle: EvidenceBundle,
    repairPrompt?: string,
  ) => Promise<CapabilityClaimsProviderResult>;
  llmMode?: CapabilityLlmMode;
  llmSetupError?: string;
  shouldWriteLlmFlowFunctionFiles?: boolean;
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

function buildEvidenceIndexFromBundle(
  bundle: EvidenceBundle,
): EvidenceIndexItem[] {
  const items: EvidenceIndexItem[] = [];

  for (const item of bundle.entryPoints) {
    items.push({
      ref: item.ref,
      kind: "entry",
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
      kind: "behavior",
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
      kind: "contract",
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
      kind: "module",
      location: item.rootPath,
      name: item.rootPath,
      summary: item.responsibilities.join("; "),
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
      startLine: item.startLine,
    });
  }

  for (const item of bundle.validationAnchors) {
    items.push({
      ref: item.ref,
      kind: "validation",
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
      kind: "flow",
      name: "flow trace",
      summary: item.steps.map((step) => step.action).join(" -> "),
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
    });
  }

  for (const item of bundle.docs) {
    items.push({
      ref: item.ref,
      kind: "doc",
      location: item.location,
      name: item.terms?.join(", "),
      summary: item.excerpt,
      targetRelevance: item.targetRelevance,
      matchedTerms: item.matchedTerms,
    });
  }

  return items;
}

function hasNonEmptyArrayMetadata(
  object: KnowledgeObject,
  key: string,
): boolean {
  const value = object.metadata[key];
  return Array.isArray(value) && value.length > 0;
}

function collectTechnicalTermLeakage(objects: KnowledgeObject[]): string[] {
  return objects
    .filter((object) => object.type === "TERM")
    .map((object) =>
      String(object.metadata.canonicalTerm ?? object.id.replace(/^TERM-/, "")),
    )
    .filter((term) => isTechnicalTerm(term));
}

function buildSyntheticCandidate(
  targetTerms: string[],
  targetPaths: string[],
): CapabilityCandidate {
  const termKey = targetTerms.length > 0 ? targetTerms.join("-") : "unknown";
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
    moduleClusters: targetPaths.map((p) => ({
      rootPath: p,
      moduleNames: [p.split("/").pop() || p],
      cohesionScore: 0.3,
      targetRelevance: 0.3,
      matchedTerms: [],
    })),
    relatedTerms: [...targetTerms],
    risks: ["no_external_boundary_found"],
    missingSignals: ["No repository evidence — synthetic candidate"],
  };
}

function buildMinimalBundle(
  candidate: CapabilityCandidate,
  repoName: string,
): EvidenceBundle {
  return {
    bundleId: candidate.candidateId.replace("CAND-", "BUNDLE-"),
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
      ref: `evidence://module/MOD-${String(i + 1).padStart(3, "0")}`,
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
    functionCandidates: [],
  };
}

function buildCandidateFromBundle(bundle: EvidenceBundle): CapabilityCandidate {
  return {
    candidateId: bundle.candidateId,
    nameCandidates:
      bundle.capabilityHints.nameCandidates.length > 0
        ? bundle.capabilityHints.nameCandidates
        : [bundle.candidateId],
    summaryHint: bundle.capabilityHints.summaryHint,
    confidence: bundle.confidence,
    confidenceBreakdown: {
      entrySignal: bundle.entryPoints.length > 0 ? 0.8 : 0.2,
      behaviorSignal: bundle.behaviorSlices.length > 0 ? 0.7 : 0.2,
      dataSignal: bundle.dataContracts.length > 0 ? 0.7 : 0.2,
      testSignal: bundle.validationAnchors.length > 0 ? 0.6 : 0.2,
      docSignal: bundle.docs.length > 0 ? 0.5 : 0.2,
      graphCohesion: bundle.confidence,
    },
    primaryEntryPoints: [],
    behaviorAnchors: [],
    dataAnchors: [],
    testAnchors: [],
    docAnchors: [],
    moduleClusters: bundle.moduleSurfaces.map((module) => ({
      rootPath: module.rootPath,
      moduleNames: module.exports,
      cohesionScore: module.targetRelevance ?? 0.5,
      targetRelevance: module.targetRelevance,
      matchedTerms: module.matchedTerms,
    })),
    relatedTerms: bundle.capabilityHints.relatedTerms,
    risks: bundle.risks,
    missingSignals: [],
  };
}

function collectClaimQualityIssues(claims: CandidateClaim[]): string[] {
  const issues: string[] = [];
  const capClaims = claims.filter((claim) => claim.suggestedType === "CAP");
  if (capClaims.length === 0) {
    issues.push("missing_cap_claim");
  }
  for (const claim of capClaims) {
    const term = claim.objectHints?.canonicalTerm ?? claim.claimText;
    if (isWeakCapabilityName(term)) {
      issues.push(`weak_capability_name:${term}`);
    }
  }
  const flowClaims = claims.filter((claim) => claim.suggestedType === "FLOW");
  if (flowClaims.some((claim) => isWeakFlowClaim(claim))) {
    issues.push("weak_flow_subject_or_steps");
  }
  if (
    !claims.some(
      (claim) =>
        claim.suggestedType === "FLOW" || claim.suggestedType === "CON",
    )
  ) {
    issues.push("missing_flow_or_contract_claim");
  }
  const modClaims = claims.filter((claim) => claim.suggestedType === "MOD");
  if (modClaims.length === 0) {
    issues.push("missing_mod_claim");
  }
  if (modClaims.some((claim) => isWeakModClaim(claim))) {
    issues.push("missing_mod_touch_guidance");
  }
  const hasValidationClaim = claims.some(
    (claim) =>
      claim.suggestedType === "VER" ||
      (claim.suggestedType === "OPEN" &&
        (claim.blockedDecisions.some((decision) =>
          decision.toLowerCase().includes("validation"),
        ) ||
          (claim.objectHints?.minimalNextEvidence ?? []).some(
            (item) =>
              item.toLowerCase().includes("test") ||
              item.toLowerCase().includes("validation"),
          ))),
  );
  if (!hasValidationClaim) {
    issues.push("missing_validation_or_validation_open_claim");
  }
  return [...new Set(issues)];
}

function collectObjectQualityIssues(objects: KnowledgeObject[]): string[] {
  const issues: string[] = [];
  for (const object of objects) {
    if (object.type === "FLOW" && object.id === "FLOW-UNKNOWN") {
      issues.push("flow_object_unknown");
    }
    if (object.type === "CAP") {
      const term = String(object.metadata.canonicalTerm ?? object.id);
      if (isWeakCapabilityName(term)) {
        issues.push(`weak_capability_object_name:${term}`);
      }
    }
  }
  return [...new Set(issues)];
}

function normalizeCapabilityObjectsFromEvidence(input: {
  objects: KnowledgeObject[];
  bundle: EvidenceBundle;
}): string[] {
  const warnings: string[] = [];
  const fallbackName = selectEvidenceBackedCapabilityName(input.bundle);
  if (!fallbackName) return warnings;

  for (const object of input.objects) {
    if (object.type !== "CAP") continue;
    const currentTerm = String(object.metadata.canonicalTerm ?? object.id);
    if (!isWeakCapabilityName(currentTerm)) continue;
    const nextId = makeObjectId("CAP", fallbackName);
    warnings.push(
      `CAP canonicalTerm normalized from weak LLM name "${currentTerm}" to evidence-backed name "${fallbackName}"`,
    );
    object.id = nextId;
    object.metadata = {
      ...object.metadata,
      canonicalTerm: fallbackName,
      normalizedFromWeakName: currentTerm,
    };
  }

  return warnings;
}

function selectEvidenceBackedCapabilityName(
  bundle: EvidenceBundle,
): string | undefined {
  const names = [
    ...bundle.capabilityHints.nameCandidates,
    ...(bundle.functionCandidates ?? []).map(
      (candidate) => candidate.canonicalName,
    ),
    ...bundle.capabilityHints.relatedTerms,
    bundle.candidateId,
  ];
  return names
    .map((name) => name.trim())
    .filter(
      (name, index, array) => name.length > 0 && array.indexOf(name) === index,
    )
    .find((name) => !isWeakCapabilityName(name));
}

function isWeakCapabilityName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return true;
  if (hasBadDefaultPhrase(normalized)) return true;
  const terms = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (terms.length === 0) return true;
  if (terms.length > 1 && LOW_VALUE_CAPABILITY_START_TERMS.has(terms[0] ?? ""))
    return true;
  const genericCount = terms.filter((term) =>
    GENERIC_CAPABILITY_NAME_TERMS.has(term),
  ).length;
  return genericCount >= Math.max(1, terms.length - 1);
}

function isWeakFlowClaim(claim: CandidateClaim): boolean {
  const subject = claim.objectHints?.subject?.trim().toLowerCase() ?? "";
  const steps = claim.objectHints?.orderedSteps ?? [];
  return (
    subject.length === 0 ||
    subject === "unknown" ||
    subject === "flow-unknown" ||
    hasBadDefaultPhrase(claim.claimText) ||
    steps.length === 0
  );
}

function isWeakModClaim(claim: CandidateClaim): boolean {
  return (
    (claim.objectHints?.touchWhen?.length ?? 0) === 0 ||
    (claim.objectHints?.doNotTouchWhen?.length ?? 0) === 0 ||
    !claim.objectHints?.modulePath
  );
}

function buildCapabilityQualityRepairPrompt(
  issues: string[],
  bundle: EvidenceBundle,
): string {
  return [
    "Regenerate the capability claims because the previous output failed business-quality checks.",
    "",
    `Issues: ${issues.join(", ")}`,
    "",
    "Required corrections:",
    "- CAP canonicalTerm must be a business capability name, not a project/module/layer name.",
    "- Avoid generic names made mostly from words like admin, portal, service, controller, module, capability, all.",
    "- Do not start CAP canonicalTerm with low-value access verbs such as get, list, query, find, search; prefer the managed business object or a user-visible business outcome.",
    "- Prefer names from BUSINESS FUNCTION CANDIDATES and primary business objects.",
    "- FLOW objectHints.subject must be a stable business function name, never unknown.",
    "- FLOW orderedSteps must contain evidence-grounded business actions.",
    "- MOD claims must include objectHints.modulePath, touchWhen[], and doNotTouchWhen[].",
    "- Include either a VER claim with verificationGoal and acceptanceOracle, or an OPEN claim explaining what validation evidence is missing.",
    "- Keep all evidenceRefs from the supplied bundle only.",
    "",
    `Business function candidates: ${(bundle.functionCandidates ?? []).map((candidate) => candidate.canonicalName).join(", ")}`,
    `Name candidates: ${bundle.capabilityHints.nameCandidates.join(", ")}`,
  ].join("\n");
}

export async function runCapabilityKnowledgePipeline(
  input: RunCapabilityKnowledgePipelineInput,
): Promise<RunCapabilityKnowledgePipelineResult> {
  const {
    repoRoot,
    targetTerms = [],
    targetPaths = [],
    domainKey,
    domainName,
    modulePaths = [],
    claimsProvider,
    llmSetupError,
  } = input;
  const llmMode = input.llmMode ?? { requested: true, required: true };

  if (!claimsProvider) {
    throw new Error(
      "LLM claimsProvider is required for capability knowledge generation",
    );
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
      capabilityId: "",
      confidence: 0,
      objectCount: 0,
      llm: emptyLlmMetadata,
      warnings,
    },
    report: {
      mode: "llm",
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

  let candidates: CapabilityCandidate[] = [];
  if (input.evidenceBundle) {
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: using provided evidence bundle ${input.evidenceBundle.bundleId}`,
    );
  } else {
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: calling discoverCapabilities, terms=${targetTerms.join(",")}, paths=${targetPaths.join(",")}`,
    );
    candidates = await discoverCapabilities(discoveryInput);
  }
  console.log(
    `[DEBUG] runCapabilityKnowledgePipeline: discoverCapabilities returned ${candidates.length} candidates`,
  );

  // Step 2: 选择置信度最高的候选（无候选时创建合成候选以支持 provider claims）
  console.log(
    `[DEBUG] runCapabilityKnowledgePipeline: selecting top candidate`,
  );
  const repoName = repoRoot.split("/").pop() || "unknown";
  let topCandidate: CapabilityCandidate;
  let bundle: EvidenceBundle;

  if (input.evidenceBundle) {
    bundle = input.evidenceBundle;
    topCandidate = buildCandidateFromBundle(bundle);
  } else if (candidates.length === 0) {
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
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: building evidence bundle`,
    );
    bundle = buildEvidenceBundle(topCandidate, repoName);
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: evidence bundle built`,
    );
  }

  // Step 4: 获取 claims (必须使用 provider)
  console.log(`[DEBUG] runCapabilityKnowledgePipeline: calling claimsProvider`);
  let providerClaims: CandidateClaim[] = [];
  let providerDebug: CapabilityClaimsProviderResult["debug"] | undefined;
  let providerGraphTrace:
    | CapabilityClaimsProviderResult["graphTrace"]
    | undefined;
  let llmCalled = false;
  let llmSucceeded = false;
  let llmError: string | undefined;

  llmCalled = true;
  try {
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: claimsProvider starting LLM call...`,
    );
    const startTime = Date.now();
    let providerResult = await claimsProvider(bundle);
    let qualityIssues = collectClaimQualityIssues(providerResult.claims);
    if (qualityIssues.length > 0) {
      console.log(
        `[DEBUG] runCapabilityKnowledgePipeline: quality repair requested, issues=${qualityIssues.join(",")}`,
      );
      const repairPrompt = buildCapabilityQualityRepairPrompt(
        qualityIssues,
        bundle,
      );
      providerResult = await claimsProvider(bundle, repairPrompt);
      qualityIssues = collectClaimQualityIssues(providerResult.claims);
      if (qualityIssues.length > 0) {
        warnings.push(
          `Capability quality warnings after repair: ${qualityIssues.join(", ")}`,
        );
      }
    }
    const elapsed = Date.now() - startTime;
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: claimsProvider returned after ${elapsed}ms, claims=${providerResult.claims?.length ?? 0}`,
    );
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
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: claimsProvider error: ${message}`,
    );
    if (message.startsWith("LLM generation failed:")) {
      throw error;
    }
    throw new Error(`LLM generation failed: ${message}`);
  }

  console.log(`[DEBUG] runCapabilityKnowledgePipeline: filtering claims`);
  let filteredProviderClaims = filterCandidateClaims(providerClaims, bundle);
  let filteredQualityIssues = collectClaimQualityIssues(filteredProviderClaims);
  if (filteredQualityIssues.length > 0) {
    console.log(
      `[DEBUG] runCapabilityKnowledgePipeline: filtered quality repair requested, issues=${filteredQualityIssues.join(",")}`,
    );
    const repairPrompt = buildCapabilityQualityRepairPrompt(
      filteredQualityIssues,
      bundle,
    );
    const providerResult = await claimsProvider(bundle, repairPrompt);
    providerClaims = providerResult.claims;
    providerDebug = providerResult.debug;
    providerGraphTrace = providerResult.graphTrace;
    if (providerResult.parseError) {
      llmError = providerResult.parseError;
      throw new Error(`LLM generation failed: ${llmError}`);
    }
    filteredProviderClaims = filterCandidateClaims(providerClaims, bundle);
    filteredQualityIssues = collectClaimQualityIssues(filteredProviderClaims);
    if (filteredQualityIssues.length > 0) {
      warnings.push(
        `Capability quality warnings after filtered repair: ${filteredQualityIssues.join(", ")}`,
      );
    }
  }
  const skeletonClaims = filterCandidateClaims(
    buildSkeletonClaims(bundle),
    bundle,
  );

  const hasAcceptedNonOpenProviderClaim = filteredProviderClaims.some(
    (claim) => claim.suggestedType !== "OPEN",
  );

  if (!hasAcceptedNonOpenProviderClaim) {
    llmSucceeded = false;
    llmError =
      llmError ??
      "LLM generation produced no accepted non-OPEN claims after evidence filtering";
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  // 质量门禁：LLM 必须生成 CAP claim
  const llmClaims = filteredProviderClaims.filter((claim) => claimIsLlm(claim));
  const hasLlmCap = llmClaims.some(
    (claim) =>
      claim.suggestedType === "CAP" && !hasBadDefaultPhrase(claim.claimText),
  );
  if (!hasLlmCap) {
    llmSucceeded = false;
    llmError = "LLM CAP claim is required for business capability knowledge";
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  // 质量门禁：LLM 必须生成 FLOW 或 CON claim
  const hasLlmFlowOrCon = llmClaims.some(
    (claim) =>
      (claim.suggestedType === "FLOW" || claim.suggestedType === "CON") &&
      !hasBadDefaultPhrase(claim.claimText),
  );
  if (!hasLlmFlowOrCon) {
    llmSucceeded = false;
    llmError =
      "LLM FLOW or CON claim is required for business capability knowledge";
    throw new Error(`LLM generation failed: ${llmError}`);
  }

  llmSucceeded = true;
  const claims = mergeClaimsByTypeAndText(
    filteredProviderClaims,
    skeletonClaims,
  );

  // 统计 claim counts
  const rawClaimCount = providerClaims.length;
  const acceptedClaimCount = filteredProviderClaims.length;
  const skeletonClaimCount = skeletonClaims.length;
  const finalClaimCount = claims.length;
  const fallbackUsed = false;

  // Step 6: 组装知识对象
  const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
  warnings.push(...normalizeCapabilityObjectsFromEvidence({ objects, bundle }));
  const objectQualityIssues = collectObjectQualityIssues(objects);
  if (objectQualityIssues.length > 0) {
    throw new CapabilityKnowledgeGenerationError(
      `LLM generation failed: capability object quality issues: ${objectQualityIssues.join(", ")}`,
      buildCapabilityKnowledgeFiles({
        objects,
        capabilityId:
          objects.find((object) => object.type === "CAP")?.id ??
          topCandidate.candidateId,
        evidenceIndex: buildEvidenceIndexFromBundle(bundle),
        report: {
          mode: "llm",
          capabilityGenerationMode: "single",
          selectedCandidateId: topCandidate.candidateId,
          candidateCount: candidates.length,
          llmRequested: true,
          llmRequired: true,
          llmCalled,
          llmSucceeded: false,
          llmRuntime: "langgraph",
          model: llmMode.model,
          claimCounts: {
            llmRaw: rawClaimCount,
            llmAccepted: acceptedClaimCount,
            skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
            final: finalClaimCount,
          },
          qualityWarnings: objectQualityIssues,
          warnings,
        },
        debug: providerDebug,
      }),
    );
  }
  const normalizedDomainKey = domainKey?.trim();
  const normalizedDomainName = domainName?.trim();
  if (normalizedDomainKey || normalizedDomainName) {
    for (const object of objects) {
      object.metadata = {
        ...object.metadata,
        ...(normalizedDomainKey ? { domainKey: normalizedDomainKey } : {}),
        ...(normalizedDomainName ? { domainName: normalizedDomainName } : {}),
      };
    }
  }
  if (modulePaths.length > 0) {
    for (const object of objects) {
      object.metadata = {
        ...object.metadata,
        evidenceModules: modulePaths,
      };
    }
  }

  if (objects.length === 0) {
    return emptyResult;
  }

  // 最终对象质量门禁
  const capFromLlm = objects.some(
    (o) => o.type === "CAP" && o.metadata.source === "llm",
  );
  const flowOrConFromLlm = objects.some(
    (o) =>
      (o.type === "FLOW" || o.type === "CON") && o.metadata.source === "llm",
  );
  const modPresent = objects.some((o) => o.type === "MOD");
  const modHasTouchGuidance = objects.some(
    (o) =>
      o.type === "MOD" &&
      o.metadata.source === "llm" &&
      hasNonEmptyArrayMetadata(o, "touchWhen") &&
      hasNonEmptyArrayMetadata(o, "doNotTouchWhen"),
  );
  const verHasOracle = objects.some(
    (o) =>
      o.type === "VER" &&
      hasNonEmptyArrayMetadata(o, "acceptanceOracle") &&
      typeof o.metadata.verificationGoal === "string" &&
      o.metadata.verificationGoal.length > 0,
  );
  const openHasMinimalNextEvidence = objects.some(
    (o) =>
      o.type === "OPEN" &&
      o.blockedDecisions.length > 0 &&
      hasNonEmptyArrayMetadata(o, "minimalNextEvidence"),
  );
  const verOrValidationOpenPresent = verHasOracle || openHasMinimalNextEvidence;
  const technicalTermLeakage = collectTechnicalTermLeakage(objects);
  const noTechnicalTermLeakage = technicalTermLeakage.length === 0;

  if (!capFromLlm)
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: LLM CAP object is required",
      [],
    );
  if (!flowOrConFromLlm)
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: LLM FLOW or CON object is required",
      [],
    );
  if (!modPresent)
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: MOD object is required",
      [],
    );
  if (!modHasTouchGuidance)
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: LLM MOD touch guidance is required for business capability knowledge",
      [],
    );
  if (!verOrValidationOpenPresent)
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: validation oracle or validation OPEN is required",
      [],
    );
  if (!noTechnicalTermLeakage) {
    const debugFiles = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: topCandidate.candidateId,
      evidenceIndex: buildEvidenceIndexFromBundle(bundle),
      report: {
        mode: "llm",
        llmRequested: true,
        llmRequired: true,
        llmCalled,
        llmSucceeded: false,
        model: llmMode.model,
        claimCounts: { llmRaw: 0, llmAccepted: 0, skeletonAdded: 0, final: 0 },
        warnings: [
          `Technical TERM leakage: ${technicalTermLeakage.join(", ")}`,
        ],
      },
      debug: providerDebug,
    });
    throw new CapabilityKnowledgeGenerationError(
      `LLM generation failed: technical TERM leakage: ${technicalTermLeakage.join(", ")}`,
      debugFiles,
    );
  }

  // Step 7: 找到 CAP 对象的 ID 作为 capabilityId
  const capObject = objects.find((o) => o.type === "CAP");
  const capabilityId = capObject?.id || "UNKNOWN-CAPABILITY";

  // Guard against repository fallback capability only when no explicit target
  const noExplicitTarget = targetTerms.length === 0 && targetPaths.length === 0;
  if (
    isRepositoryFallbackCapability(capabilityId, topCandidate.candidateId) &&
    noExplicitTarget
  ) {
    throw new CapabilityKnowledgeGenerationError(
      "Capability generation failed: repository-level fallback capability is not a valid business capability",
      buildCapabilityKnowledgeFiles({
        objects,
        capabilityId,
        evidenceIndex: buildEvidenceIndexFromBundle(bundle),
        report: {
          mode: "llm",
          capabilityGenerationMode: "single",
          selectedCandidateId: topCandidate.candidateId,
          candidateCount: candidates.length,
          llmRequested: true,
          llmRequired: true,
          llmCalled,
          llmSucceeded: false,
          llmRuntime: "langgraph",
          model: llmMode.model,
          claimCounts: {
            llmRaw: rawClaimCount,
            llmAccepted: acceptedClaimCount,
            skeletonAdded: Math.max(0, finalClaimCount - acceptedClaimCount),
            final: finalClaimCount,
          },
          warnings: [
            "Repository fallback capability is not a valid business capability",
          ],
        },
        debug: providerDebug,
      }),
    );
  }

  // Step 8: 构建证据索引
  const evidenceIndex = buildEvidenceIndexFromBundle(bundle);

  // 文档模型可用性检查
  const docModel = buildCapabilityDocModel({
    objects,
    capabilityId,
    evidenceIndex,
  });
  const docHasSummary = docModel.summaryZh.trim().length > 0;
  const docHasCodeAnchors = docModel.codeAnchors.length > 0;
  const docHasValidation = docModel.validation.length > 0;

  if (!docHasSummary) {
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: capability Markdown summary is empty",
      [],
    );
  }
  if (!docHasCodeAnchors) {
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: capability Markdown has no code anchors",
      [],
    );
  }
  if (!docHasValidation) {
    throw new CapabilityKnowledgeGenerationError(
      "LLM generation failed: capability Markdown has no validation section",
      [],
    );
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
    mode: "llm",
    capabilityGenerationMode: "single",
    selectedCandidateId: topCandidate.candidateId,
    candidateCount: candidates.length,
    llmRequested: true,
    llmRequired: true,
    llmCalled,
    llmSucceeded,
    llmRuntime: "langgraph",
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
  const debug: CapabilityLlmDebug | undefined = providerDebug
    ? {
        request: providerDebug.request,
        response: providerDebug.response,
        graphTrace: providerGraphTrace,
      }
    : undefined;

  // Step 9: 生成文件
  const files = buildCapabilityKnowledgeFiles({
    objects,
    capabilityId,
    evidenceIndex,
    report,
    debug,
    options: {
      shouldWriteFlowFunctionFiles:
        input.shouldWriteLlmFlowFunctionFiles ?? true,
    },
  });

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

function isRepositoryFallbackCapability(
  capabilityId: string,
  candidateId?: string,
): boolean {
  return (
    capabilityId === "CAP-REPOSITORY-CAPABILITY" || candidateId === "CAND-"
  );
}

function countObjectSources(objects: KnowledgeObject[]): {
  llm: number;
  skeleton: number;
  evidence_seed: number;
} {
  const counts = { llm: 0, skeleton: 0, evidence_seed: 0 };
  for (const obj of objects) {
    const source = obj.metadata.source;
    if (source === "skeleton") counts.skeleton += 1;
    else if (source === "evidence_seed") counts.evidence_seed += 1;
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
    providerClaims.map((c) => `${c.suggestedType}:${c.claimText}`),
  );

  // Track which types the LLM already provides (ignoring bad default phrases)
  const llmProvidedTypes = new Set(
    providerClaims
      .filter((c) => claimIsLlm(c) && !hasBadDefaultPhrase(c.claimText))
      .map((c) => c.suggestedType),
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

import { TYPE_TO_DIR } from "./type-directory-map.js";

export function capabilityResultToContribution(
  result: RunCapabilityKnowledgePipelineResult,
): KnowledgePackageContribution {
  return {
    stage: "capability",
    files: result.files.filter((f) => f.path !== "catalog.yaml"),
    objects: result.objects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      path: `objects/${TYPE_TO_DIR[obj.type] || "unknown"}/${obj.id}.yaml`,
    })),
    report: {
      stage: "capability",
      ran: true,
      succeeded: result.objects.length,
      failed: 0,
      details: {
        capabilityGenerationMode: "single",
        selectedCandidateId: result.report.selectedCandidateId,
        candidateCount: result.report.candidateCount,
        llmRuntime: "langgraph",
        llmCalled: result.metadata.llm.called,
        llmSucceeded: result.metadata.llm.succeeded,
        objectSourceCounts: result.report.objectSourceCounts,
        requiredBusinessObjects: result.report.requiredBusinessObjects,
      },
    },
    warnings: result.metadata.warnings,
  };
}
