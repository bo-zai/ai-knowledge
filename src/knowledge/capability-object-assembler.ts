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

function claimSource(claim: CandidateClaim): 'llm' | 'skeleton' | 'evidence_seed' {
  return claim.source ?? 'llm';
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
  const hints = claim.objectHints;
  const term = hints?.canonicalTerm || bundle.capabilityHints.nameCandidates[0] || 'Unknown capability';
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
      source: claimSource(claim),
      canonicalTerm: term,
      ...(hints?.goal ? { goal: hints.goal } : {}),
      ...(hints?.successCriteria ? { successCriteria: hints.successCriteria } : {}),
      ...(hints?.nonGoals ? { nonGoals: hints.nonGoals } : {}),
    },
  };
}

function buildTermObject(claim: CandidateClaim): KnowledgeObject {
  const hints = claim.objectHints;
  const canonicalTerm = hints?.canonicalTerm || claim.claimText.slice(0, 30);
  return {
    id: makeObjectId('TERM', canonicalTerm),
    type: 'TERM',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      source: claimSource(claim),
      canonicalTerm,
      ...(hints?.businessDefinition ? { businessDefinition: hints.businessDefinition } : {}),
      ...(hints?.aliases ? { aliases: hints.aliases } : {}),
      ...(hints?.notEqualTo ? { notEqualTo: hints.notEqualTo } : {}),
    },
  };
}

function buildFlowObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const hints = claim.objectHints;
  const flow = extractFlowRef(claim, bundle);
  const subject = hints?.subject || 'unknown';
  return {
    id: makeObjectId('FLOW', subject),
    type: 'FLOW',
    description: claim.claimText,
    evidencePrimary: claim.evidenceRefs,
    evidenceSupporting: [],
    decisionPoints: claim.decisionPoints,
    sddStageUses: claim.sddStageUses,
    unsupportedParts: claim.unsupportedParts,
    blockedDecisions: claim.blockedDecisions,
    metadata: {
      source: claimSource(claim),
      ...(hints?.orderedSteps ? { orderedSteps: hints.orderedSteps } : {}),
      ...(hints?.failureBranches ? { failureBranches: hints.failureBranches } : {}),
      ...(hints?.compensation ? { compensation: hints.compensation } : {}),
      ...(flow?.steps ? { evidenceSteps: flow.steps } : {}),
    },
  };
}

function buildModObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const hints = claim.objectHints;
  const module = extractModuleRef(claim, bundle);
  const path = hints?.modulePath || module?.rootPath || 'unknown-module';
  const entryPoints = extractModEntrySymbols(claim, bundle, path);
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
      source: claimSource(claim),
      rootPath: path,
      ...(hints?.ownedResponsibility ? { ownedResponsibility: hints.ownedResponsibility } : {}),
      ...(entryPoints.length > 0 ? { entryPoints } : {}),
      ...(hints?.touchWhen ? { touchWhen: hints.touchWhen } : {}),
      ...(hints?.doNotTouchWhen ? { doNotTouchWhen: hints.doNotTouchWhen } : {}),
      ...(hints?.testAnchors ? { testAnchors: hints.testAnchors } : {}),
    },
  };
}

function extractModEntrySymbols(claim: CandidateClaim, bundle: EvidenceBundle, modulePath: string): string[] {
  const entries: string[] = [];
  const pathLower = modulePath.toLowerCase();

  // Extract from entry points that match this module
  for (const ep of bundle.entryPoints) {
    const locLower = ep.location.toLowerCase();
    if (matchesModulePath(locLower, pathLower)) {
      const name = ep.name || '';
      if (ep.kind === 'http' && ep.signature) {
        // Controller with routes: extract route as entry
        const routeParts = ep.signature.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(([^)]*)\)/g) || [];
        for (const route of routeParts.slice(0, 3)) {
          entries.push(`${name}.${route}`);
        }
      } else if (ep.signature && !ep.signature.includes('@')) {
        // Method signature from caller tracing
        entries.push(`${name}.${ep.signature}`);
      } else {
        entries.push(name);
      }
    }
  }

  // Extract from behavior slices that match this module
  for (const beh of bundle.behaviorSlices) {
    const locLower = beh.location.toLowerCase();
    if (matchesModulePath(locLower, pathLower)) {
      const className = beh.location.split('/').pop()?.replace('.java', '') || '';
      const methodRef = `${beh.verb} ${beh.object}`;
      const entry = className ? `${className}.${methodRef}` : methodRef;
      if (!entries.includes(entry)) {
        entries.push(entry);
      }
    }
  }

  return entries.slice(0, 10);
}

function matchesModulePath(fileLocation: string, modulePath: string): boolean {
  // Check if the file location contains the module path
  const normalizedPath = modulePath.replace(/\//g, '.');
  const parts = normalizedPath.split('.').filter(Boolean);
  for (const part of parts) {
    if (part.length > 2 && fileLocation.includes(part.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function buildConObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const hints = claim.objectHints;
  const contract = extractContractRef(claim, bundle);
  const name = hints?.contractSubject || contract?.name || 'unknown-contract';
  const kind = hints?.contractKind || contract?.kind || 'schema';

  const baseMetadata: Record<string, unknown> = {
    source: claimSource(claim),
    kind,
    subject: hints?.contractSubject || contract?.name,
  };

  if (kind === 'api' && contract) {
    const routeInfo = extractApiRouteInfo(contract);
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
        ...baseMetadata,
        httpMethod: routeInfo.method,
        routePath: routeInfo.path,
        controllerClass: routeInfo.controllerClass,
        ...(hints?.fieldSemantics ? { fieldSemantics: hints.fieldSemantics } : {}),
        ...(hints?.validationRules ? { validationRules: hints.validationRules } : {}),
      },
    };
  }

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
      ...baseMetadata,
      ...(hints?.fieldSemantics ? { fieldSemantics: hints.fieldSemantics } : {}),
      ...(hints?.validationRules ? { validationRules: hints.validationRules } : {}),
      ...(hints?.schemaRef ? { schemaRef: hints.schemaRef } : {}),
    },
  };
}

function extractApiRouteInfo(contract: EvidenceDataContract): { method: string; path: string; controllerClass: string } {
  // contract.name is like "GET /goods/add" or "POST /courseTemplate/page"
  const parts = (contract.name || '').split(' ');
  const method = parts[0] || 'ANY';
  const path = parts[1] || '';
  // Extract controller class from location
  const controllerClass = contract.location
    ? contract.location.split('/').pop()?.replace('.java', '') || ''
    : '';
  return { method, path, controllerClass };
}

function buildVerObject(claim: CandidateClaim, bundle: EvidenceBundle): KnowledgeObject {
  const hints = claim.objectHints;
  const validation = extractValidationRef(claim, bundle);
  const capability = bundle.capabilityHints.nameCandidates[0] || 'validation';
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
      source: claimSource(claim),
      kind: validation?.kind || 'test',
      location: validation?.location,
      ...(hints?.verificationGoal ? { verificationGoal: hints.verificationGoal } : {}),
      ...(hints?.acceptanceOracle ? { acceptanceOracle: hints.acceptanceOracle } : {}),
      ...(hints?.testAnchors ? { testAnchors: hints.testAnchors } : {}),
    },
  };
}

function buildOpenObject(claim: CandidateClaim): KnowledgeObject {
  const hints = claim.objectHints;
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
    metadata: {
      source: claimSource(claim),
      ...(hints?.minimalNextEvidence ? { minimalNextEvidence: hints.minimalNextEvidence } : {}),
      ...(hints?.ownerToAsk ? { ownerToAsk: hints.ownerToAsk } : {}),
      ...(hints?.escalationGate ? { escalationGate: hints.escalationGate } : {}),
    },
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
      source: 'evidence_seed',
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
      case 'TERM':
        obj = buildTermObject(claim);
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
        obj = buildOpenObject(claim);
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
