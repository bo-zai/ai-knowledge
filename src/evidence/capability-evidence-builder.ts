import type { CapabilityCandidate, EntrySignal, BehaviorSignal, DataSignal, TestSignal, DocSignal, ModuleCluster } from '../slicing/capability-candidate-schema.js';
import type {
  EvidenceBundle,
  EvidenceEntryPoint,
  EvidenceBehaviorSlice,
  EvidenceDataContract,
  EvidenceFlowTrace,
  EvidenceModuleSurface,
  EvidenceValidationAnchor,
  NegativeEvidence,
  OpenQuestionSeed,
} from './evidence-bundle-schema.js';

function byEvidenceRelevance<T extends { targetRelevance?: number }>(left: T, right: T): number {
  return (right.targetRelevance ?? 0) - (left.targetRelevance ?? 0);
}

const MIN_RELEVANCE = 0.5;

function hasTargetRelevance(item: { targetRelevance?: number }): boolean {
  return (item.targetRelevance ?? 0) >= MIN_RELEVANCE;
}

function topRelevant<T extends { targetRelevance?: number }>(
  items: T[],
  limit: number,
  fallbackLimit: number,
): T[] {
  const sorted = [...items].sort(byEvidenceRelevance);
  const relevant = sorted.filter(hasTargetRelevance).slice(0, limit);
  if (relevant.length > 0) return relevant;
  return sorted.slice(0, fallbackLimit);
}

function mapHttpEntryPointsToApiContracts(entryPoints: EvidenceEntryPoint[]): EvidenceDataContract[] {
  const httpEntries = entryPoints.filter(ep => ep.kind === 'http' && ep.signature);
  const contracts: EvidenceDataContract[] = [];

  for (const ep of httpEntries) {
    const routeParts = parseRouteSignature(ep.signature ?? '');
    for (const route of routeParts) {
      contracts.push({
        ref: `evidence://contract/API-${String(contracts.length + 1).padStart(3, '0')}`,
        kind: 'api' as const,
        location: ep.location,
        name: `${route.method} ${route.path}`,
        fields: [],
        description: `${route.method} ${route.path} — ${ep.name}`,
        targetRelevance: ep.targetRelevance,
        matchedTerms: ep.matchedTerms,
        sourceLocation: ep.location,
      });
    }
  }

  return contracts;
}

interface ParsedRoute { method: string; path: string }

function parseRouteSignature(signature: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  // Match @GetMapping("/path"), @PostMapping(value = "/path"), @RequestMapping("/path"), etc.
  const routeRegex = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']*)["']\s*\)|\(([^)]*)\))?/g;
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(signature)) !== null) {
    const mappingType = match[1].toLowerCase();
    const pathArg = match[2] ?? match[3] ?? '';
    const method = mappingType === 'request' ? 'ANY' : mappingType.toUpperCase();
    const cleanedPath = pathArg.replace(/^\s*value\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
    if (cleanedPath) {
      routes.push({ method, path: cleanedPath });
    }
  }
  return routes;
}

function mapEntrySignals(signals: EntrySignal[]): EvidenceEntryPoint[] {
  return signals.map((signal, index) => ({
    ref: `evidence://entry/EP-${String(index + 1).padStart(3, '0')}`,
    kind: signal.kind,
    location: signal.location,
    name: signal.name,
    signature: signal.signature,
    description: signal.description,
    targetRelevance: signal.targetRelevance,
    matchedTerms: signal.matchedTerms,
    sourceLocation: signal.location,
    startLine: signal.startLine,
  }));
}

function mapBehaviorSignals(signals: BehaviorSignal[], limit = 12): EvidenceBehaviorSlice[] {
  // Sort by relevance before truncation
  const sorted = [...signals].sort(byEvidenceRelevance);
  return sorted.slice(0, limit).map((signal, index) => ({
    ref: `evidence://behavior/BEH-${String(index + 1).padStart(3, '0')}`,
    location: signal.location,
    verb: signal.verb,
    object: signal.object,
    summary: signal.context,
    targetRelevance: signal.targetRelevance,
    matchedTerms: signal.matchedTerms,
    sourceLocation: signal.location,
    startLine: signal.startLine,
  }));
}

function mapDataSignals(signals: DataSignal[]): EvidenceDataContract[] {
  // Sort by relevance
  const sorted = [...signals].sort(byEvidenceRelevance);
  return sorted.map((signal, index) => ({
    ref: `evidence://contract/CON-EVID-${String(index + 1).padStart(3, '0')}`,
    kind: signal.kind,
    location: signal.location,
    name: signal.name,
    fields: signal.fields,
    targetRelevance: signal.targetRelevance,
    matchedTerms: signal.matchedTerms,
    sourceLocation: signal.location,
    startLine: signal.startLine,
  }));
}

function mapTestSignals(signals: TestSignal[]): EvidenceValidationAnchor[] {
  // Sort by relevance
  const sorted = [...signals].sort(byEvidenceRelevance);
  return sorted.map((signal, index) => ({
    ref: `evidence://validation/VAL-${String(index + 1).padStart(3, '0')}`,
    kind: 'test' as const,
    location: signal.location,
    name: signal.testName,
    targetRelevance: signal.targetRelevance,
    matchedTerms: signal.matchedTerms,
    sourceLocation: signal.location,
    startLine: signal.startLine,
  }));
}

function mapDocSignals(signals: DocSignal[]): Array<{
  ref: string;
  location: string;
  kind: 'readme' | 'agents' | 'notes' | 'docs' | 'comment';
  excerpt: string;
  terms?: string[];
  targetRelevance?: number;
  matchedTerms?: string[];
  sourceLocation?: string;
}> {
  return signals.map((signal, index) => ({
    ref: `evidence://doc/DOC-${String(index + 1).padStart(3, '0')}`,
    location: signal.location,
    kind: signal.kind,
    excerpt: signal.constraints?.join('; ') || '',
    terms: signal.terms,
    targetRelevance: signal.targetRelevance,
    matchedTerms: signal.matchedTerms,
    sourceLocation: signal.location,
  }));
}

function mapModuleClusters(clusters: ModuleCluster[]): EvidenceModuleSurface[] {
  // Sort by relevance
  const sorted = [...clusters].sort(byEvidenceRelevance);
  return sorted.map((cluster, index) => ({
    ref: `evidence://module/MOD-${String(index + 1).padStart(3, '0')}`,
    rootPath: cluster.rootPath,
    exports: cluster.moduleNames,
    responsibilities: [],
    targetRelevance: cluster.targetRelevance,
    matchedTerms: cluster.matchedTerms,
    sourceLocation: cluster.rootPath,
  }));
}

function buildFlowTraces(candidate: CapabilityCandidate): EvidenceFlowTrace[] {
  // MVP: 根据行为锚点构建简单流程
  if (candidate.behaviorAnchors.length === 0) {
    return [];
  }

  // Use top-ranked behavior anchors (already sorted in discovery)
  const topBehaviors = candidate.behaviorAnchors.slice(0, 3);
  const steps = topBehaviors.map(anchor => ({
    action: `${anchor.verb} ${anchor.object}`,
    location: anchor.location,
  }));

  // Compute relevance from top behaviors
  const avgRelevance = topBehaviors.reduce((sum, b) => sum + (b.targetRelevance ?? 0), 0) / topBehaviors.length;

  return [{
    ref: 'evidence://flow/FLOW-EVID-001',
    steps,
    targetRelevance: avgRelevance,
    matchedTerms: topBehaviors.flatMap(b => b.matchedTerms ?? []),
    sourceLocation: topBehaviors[0]?.location,
  }];
}

function buildNegativeEvidence(candidate: CapabilityCandidate): NegativeEvidence[] {
  const evidence: NegativeEvidence[] = [];

  for (const risk of candidate.risks) {
    if (risk === 'no_external_boundary_found') {
      evidence.push({
        id: `NEG-${String(evidence.length + 1).padStart(3, '0')}`,
        kind: 'missing_boundary',
        description: 'No external API, event, or system boundary found',
        impact: 'Cannot determine external coordination requirements',
      });
    }
  }

  return evidence;
}

function buildOpenQuestions(candidate: CapabilityCandidate): OpenQuestionSeed[] {
  const questions: OpenQuestionSeed[] = [];

  for (const missing of candidate.missingSignals) {
    questions.push({
      id: `OPEN-SEED-${String(questions.length + 1).padStart(3, '0')}`,
      question: missing,
      blockedDecisions: [`Cannot proceed without resolving: ${missing}`],
      minimalNextEvidence: `Investigate: ${missing}`,
    });
  }

  return questions;
}

export function buildEvidenceBundle(candidate: CapabilityCandidate, repoName: string): EvidenceBundle {
  // Scope evidence by relevance before mapping
  const scopedEntries = topRelevant(candidate.primaryEntryPoints, 30, 8);
  const scopedBehaviors = topRelevant(candidate.behaviorAnchors, 12, 6);
  const scopedData = topRelevant(candidate.dataAnchors, 80, 20);
  const scopedTests = topRelevant(candidate.testAnchors, 40, 10);
  const scopedModules = topRelevant(candidate.moduleClusters, 10, 4);
  const scopedDocs = topRelevant(candidate.docAnchors, 20, 5);

  const entryPoints = mapEntrySignals(scopedEntries);
  const behaviorSlices = mapBehaviorSignals(scopedBehaviors);
  const dataContracts = mapDataSignals(scopedData);
  const apiContracts = mapHttpEntryPointsToApiContracts(entryPoints);
  const allContracts = [...dataContracts, ...apiContracts];
  const validationAnchors = mapTestSignals(scopedTests);
  const moduleSurfaces = mapModuleClusters(scopedModules);
  const docs = mapDocSignals(scopedDocs);
  const flowTraces = buildFlowTraces(candidate);
  const negativeEvidence = buildNegativeEvidence(candidate);
  const openQuestions = buildOpenQuestions(candidate);

  return {
    bundleId: `BUNDLE-${candidate.candidateId.replace('CAND-', '')}`,
    candidateId: candidate.candidateId,
    repoProfile: {
      name: repoName,
    },
    confidence: candidate.confidence,
    risks: candidate.risks,
    capabilityHints: {
      nameCandidates: candidate.nameCandidates,
      relatedTerms: candidate.relatedTerms,
      summaryHint: candidate.summaryHint,
    },
    entryPoints,
    flowTraces,
    behaviorSlices,
    dataContracts: allContracts,
    moduleSurfaces,
    validationAnchors,
    docs,
    negativeEvidence,
    openQuestions,
  };
}
