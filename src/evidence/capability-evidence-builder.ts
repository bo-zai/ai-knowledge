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

function mapEntrySignals(signals: EntrySignal[]): EvidenceEntryPoint[] {
  return signals.map((signal, index) => ({
    ref: `evidence://entry/EP-${String(index + 1).padStart(3, '0')}`,
    kind: signal.kind,
    location: signal.location,
    name: signal.name,
    signature: signal.signature,
    description: signal.description,
  }));
}

function mapBehaviorSignals(signals: BehaviorSignal[], limit = 12): EvidenceBehaviorSlice[] {
  return signals.slice(0, limit).map((signal, index) => ({
    ref: `evidence://behavior/BEH-${String(index + 1).padStart(3, '0')}`,
    location: signal.location,
    verb: signal.verb,
    object: signal.object,
    summary: signal.context,
  }));
}

function mapDataSignals(signals: DataSignal[]): EvidenceDataContract[] {
  return signals.map((signal, index) => ({
    ref: `evidence://contract/CON-EVID-${String(index + 1).padStart(3, '0')}`,
    kind: signal.kind,
    location: signal.location,
    name: signal.name,
    fields: signal.fields,
  }));
}

function mapTestSignals(signals: TestSignal[]): EvidenceValidationAnchor[] {
  return signals.map((signal, index) => ({
    ref: `evidence://validation/VAL-${String(index + 1).padStart(3, '0')}`,
    kind: 'test' as const,
    location: signal.location,
    name: signal.testName,
  }));
}

function mapDocSignals(signals: DocSignal[]): Array<{
  ref: string;
  location: string;
  kind: 'readme' | 'agents' | 'notes' | 'docs' | 'comment';
  excerpt: string;
  terms?: string[];
}> {
  return signals.map((signal, index) => ({
    ref: `evidence://doc/DOC-${String(index + 1).padStart(3, '0')}`,
    location: signal.location,
    kind: signal.kind,
    excerpt: signal.constraints?.join('; ') || '',
    terms: signal.terms,
  }));
}

function mapModuleClusters(clusters: ModuleCluster[]): EvidenceModuleSurface[] {
  return clusters.map((cluster, index) => ({
    ref: `evidence://module/MOD-${String(index + 1).padStart(3, '0')}`,
    rootPath: cluster.rootPath,
    exports: cluster.moduleNames,
    responsibilities: [],
  }));
}

function buildFlowTraces(candidate: CapabilityCandidate): EvidenceFlowTrace[] {
  // MVP: 根据行为锚点构建简单流程
  if (candidate.behaviorAnchors.length === 0) {
    return [];
  }

  const steps = candidate.behaviorAnchors.slice(0, 3).map(anchor => ({
    action: `${anchor.verb} ${anchor.object}`,
    location: anchor.location,
  }));

  return [{
    ref: 'evidence://flow/FLOW-EVID-001',
    steps,
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
  const entryPoints = mapEntrySignals(candidate.primaryEntryPoints);
  const behaviorSlices = mapBehaviorSignals(candidate.behaviorAnchors);
  const dataContracts = mapDataSignals(candidate.dataAnchors);
  const validationAnchors = mapTestSignals(candidate.testAnchors);
  const moduleSurfaces = mapModuleClusters(candidate.moduleClusters);
  const docs = mapDocSignals(candidate.docAnchors);
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
    dataContracts,
    moduleSurfaces,
    validationAnchors,
    docs,
    negativeEvidence,
    openQuestions,
  };
}
