import type { EvidenceBundle, EvidenceBehaviorSlice, EvidenceDataContract, EvidenceFlowTrace, EvidenceModuleSurface, EvidenceValidationAnchor, OpenQuestionSeed } from '../evidence/evidence-bundle-schema.js';
import type { CandidateClaim } from '../generation/capability-claim-generator.js';

export type KnowledgeObjectType = 'CAP' | 'TERM' | 'FLOW' | 'MOD' | 'CON' | 'VER' | 'OPEN';

export interface KnowledgeObject {
  id: string;
  type: KnowledgeObjectType;
  description: string;
  evidencePrimary: string[];
  evidenceSupporting: string[];
  decisionPoints: string[];
  sddStageUses: string[];
  unsupportedParts: string[];
  blockedDecisions: string[];
  metadata: Record<string, unknown>;
}

export function makeObjectId(type: KnowledgeObjectType, name: string): string {
  const normalized = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${type}-${normalized}`;
}

function extractBehaviorRef(claim: CandidateClaim, bundle: EvidenceBundle): EvidenceBehaviorSlice | undefined {
  for (const ref of claim.evidenceRefs) {
    const behavior = bundle.behaviorSlices.find(b => b.ref === ref);
    if (behavior) return behavior;
  }
  return undefined;
}

function extractFlowRef(claim: CandidateClaim, bundle: EvidenceBundle): EvidenceFlowTrace | undefined {
  for (const ref of claim.evidenceRefs) {
    const flow = bundle.flowTraces.find(f => f.ref === ref);
    if (flow) return flow;
  }
  return undefined;
}

function extractModuleRef(claim: CandidateClaim, bundle: EvidenceBundle): EvidenceModuleSurface | undefined {
  for (const ref of claim.evidenceRefs) {
    const module = bundle.moduleSurfaces.find(m => m.ref === ref);
    if (module) return module;
  }
  return undefined;
}

function extractContractRef(claim: CandidateClaim, bundle: EvidenceBundle): EvidenceDataContract | undefined {
  for (const ref of claim.evidenceRefs) {
    const contract = bundle.dataContracts.find(c => c.ref === ref);
    if (contract) return contract;
  }
  return undefined;
}

function extractValidationRef(claim: CandidateClaim, bundle: EvidenceBundle): EvidenceValidationAnchor | undefined {
  for (const ref of claim.evidenceRefs) {
    const validation = bundle.validationAnchors.find(v => v.ref === ref);
    if (validation) return validation;
  }
  return undefined;
}

function buildCapObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const term = claim.objectHints?.canonicalTerm || bundle.capabilityHints.nameCandidates[0] || 'Unknown capability';
  return {
    id: makeObjectId('CAP', term),
    type: 'CAP',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      canonicalTerm: term,
    },
  };
}

function buildFlowObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const flow = extractFlowRef(claim, bundle);
  const subject = claim.objectHints?.subject || bundle.capabilityHints.nameCandidates[0] || 'unknown';
  const steps = flow?.steps.map(s => s.action).join(' -> ') || claim.claimText;
  return {
    id: makeObjectId('FLOW', subject),
    type: 'FLOW',
    description: `Flow: ${steps}`,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      steps: flow?.steps || [],
    },
  };
}

function buildModObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const module = extractModuleRef(claim, bundle);
  const path = claim.objectHints?.modulePath || module?.rootPath || 'unknown-module';
  return {
    id: makeObjectId('MOD', path.replace(/\//g, '-')),
    type: 'MOD',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      rootPath: path,
      exports: module?.exports || [],
    },
  };
}

function buildConObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const contract = extractContractRef(claim, bundle);
  const name = contract?.name || 'unknown-contract';
  return {
    id: makeObjectId('CON', name),
    type: 'CON',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      kind: contract?.kind || claim.objectHints?.contractKind || 'schema',
      fields: contract?.fields || [],
    },
  };
}

function buildVerObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const validation = extractValidationRef(claim, bundle);
  const capability = bundle.capabilityHints.nameCandidates[0] || 'unknown';
  return {
    id: makeObjectId('VER', capability),
    type: 'VER',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      kind: validation?.kind || 'test',
      location: validation?.location,
    },
  };
}

function buildOpenObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const question = claim.claimText.slice(0, 50).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: makeObjectId('OPEN', question || 'unknown'),
    type: 'OPEN',
    description: claim.claimText,
    evidencePrimary: [],
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {},
  };
}

function buildOpenFromSeed(seed: OpenQuestionSeed): KnowledgeObject {
  const question = seed.question.slice(0, 50).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: makeObjectId('OPEN', question || 'unknown'),
    type: 'OPEN',
    description: seed.question,
    evidencePrimary: [],
    evidenceSupporting: [],
    decisionPoints: [],
    sddStageUses: ['requirement_clarification'],
    unsupportedParts: [],
    blockedDecisions: seed.blockedDecisions,
    metadata: {
      minimalNextEvidence: seed.minimalNextEvidence,
    },
  };
}

export function assembleCapabilityKnowledgeObjects(input: {
  bundle: EvidenceBundle;
  claims: CandidateClaim[];
}): KnowledgeObject[] {
  const { bundle, claims } = input;
  const objects: KnowledgeObject[] = [];
  const seenIds = new Set<string>();

  for (const claim of claims) {
    let obj: KnowledgeObject | undefined;

    switch (claim.suggestedType) {
      case 'CAP':
        obj = buildCapObject(claim, bundle);
        break;
      case 'FLOW':
        obj = buildFlowObject(claim, bundle);
        break;
      case 'MOD':
        obj = buildModObject(claim, bundle);
        break;
      case 'CON':
        obj = buildConObject(claim, bundle);
        break;
      case 'VER':
        obj = buildVerObject(claim, bundle);
        break;
      case 'OPEN':
        obj = buildOpenObject(claim, bundle);
        break;
      case 'TERM':
        // MVP: TERM objects follow similar pattern
        obj = {
          id: makeObjectId('TERM', claim.claimText.slice(0, 30)),
          type: 'TERM',
          description: claim.claimText,
          evidencePrimary: claim.evidenceRefs,
          evidenceSupporting: [],
          decisionPoints: claim.decisionPoints,
          sddStageUses: claim.sddStageUses,
          unsupportedParts: claim.unsupportedParts,
          blockedDecisions: claim.blockedDecisions,
          metadata: {},
        };
        break;
    }

    if (obj && !seenIds.has(obj.id)) {
      objects.push(obj);
      seenIds.add(obj.id);
    }
  }

  // 从 bundle 的 openQuestions 创建额外的 OPEN 对象
  for (const seed of bundle.openQuestions) {
    const obj = buildOpenFromSeed(seed);
    if (!seenIds.has(obj.id)) {
      objects.push(obj);
      seenIds.add(obj.id);
    }
  }

  return objects;
}