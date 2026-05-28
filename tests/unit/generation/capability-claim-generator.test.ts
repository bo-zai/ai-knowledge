import { describe, expect, it } from 'vitest';
import {
  CandidateClaimSchema,
  filterCandidateClaims,
  buildCapabilityClaimPrompt,
} from '../../../src/generation/capability-claim-generator.js';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';

describe('CandidateClaimSchema', () => {
  it('accepts valid CAP claim', () => {
    const claim = CandidateClaimSchema.parse({
      suggestedType: 'CAP',
      claimText: 'DB knowledge generation capability transforms MyBatis evidence into DB objects',
      confidence: 'high',
      evidenceRefs: ['evidence://behavior/BEH-001', 'evidence://contract/CON-EVID-001'],
      decisionPoints: ['Which fields to include in DB object'],
      sddStageUses: ['requirement_clarification', 'design_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: {
        canonicalTerm: 'DB knowledge generation',
      },
    });

    expect(claim.suggestedType).toBe('CAP');
  });

  it('accepts valid OPEN claim without evidence refs', () => {
    const claim = CandidateClaimSchema.parse({
      suggestedType: 'OPEN',
      claimText: 'Cannot determine source of field descriptions',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: ['Field description inference logic'],
      blockedDecisions: ['Cannot decide if inferred descriptions are acceptable'],
    });

    expect(claim.suggestedType).toBe('OPEN');
  });
});

describe('filterCandidateClaims', () => {
  const validBundle: EvidenceBundle = {
    bundleId: 'BUNDLE-001',
    candidateId: 'CAND-001',
    repoProfile: { name: 'test' },
    confidence: 0.7,
    risks: [],
    capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
    entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'test' }],
    flowTraces: [{ ref: 'evidence://flow/FLOW-001', steps: [] }],
    behaviorSlices: [{ ref: 'evidence://behavior/BEH-001', location: 'src/gen.ts', verb: 'generate', object: 'object' }],
    dataContracts: [{ ref: 'evidence://contract/CON-001', kind: 'schema', location: 'src/schema.ts', name: 'Schema' }],
    moduleSurfaces: [{ ref: 'evidence://module/MOD-001', rootPath: 'src', exports: [], responsibilities: [] }],
    validationAnchors: [{ ref: 'evidence://validation/VAL-001', kind: 'test', location: 'tests/test.ts', name: 'test' }],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };

  it('rejects non-OPEN claim without evidence refs', () => {
    const claims = [{
      suggestedType: 'CAP',
      claimText: 'Some capability',
      confidence: 'high',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });

  it('rejects low-confidence non-OPEN claim', () => {
    const claims = [{
      suggestedType: 'CAP',
      claimText: 'Low confidence claim',
      confidence: 'low',
      evidenceRefs: ['evidence://behavior/BEH-001'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });

  it('accepts high-confidence CAP claim with valid evidence refs', () => {
    const claims = [{
      suggestedType: 'CAP',
      claimText: 'DB knowledge generation',
      confidence: 'high',
      evidenceRefs: ['evidence://behavior/BEH-001'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(1);
  });

  it('rejects OPEN claim without blocked decisions', () => {
    const claims = [{
      suggestedType: 'OPEN',
      claimText: 'Unknown question',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });

  it('accepts OPEN claim with blocked decisions', () => {
    const claims = [{
      suggestedType: 'OPEN',
      claimText: 'Cannot determine field description source',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: ['Field description inference'],
      blockedDecisions: ['Cannot decide inference acceptability'],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(1);
  });

  it('rejects claim with evidence ref not in bundle', () => {
    const claims = [{
      suggestedType: 'CAP',
      claimText: 'Invalid evidence ref',
      confidence: 'high',
      evidenceRefs: ['evidence://behavior/BEH-999'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });
});

describe('buildCapabilityClaimPrompt', () => {
  it('includes hard rules about evidence refs', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-001',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test' },
      confidence: 0.7,
      risks: [],
      capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
      entryPoints: [],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const prompt = buildCapabilityClaimPrompt(bundle);
    expect(prompt).toContain('use only bundle evidence');
    expect(prompt).toContain('every non-OPEN claim cites evidence refs');
    expect(prompt).toContain('missing evidence becomes OPEN');
  });

  it('includes bundle evidence refs', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-001',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test' },
      confidence: 0.7,
      risks: [],
      capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'test' }],
      flowTraces: [],
      behaviorSlices: [{ ref: 'evidence://behavior/BEH-001', location: 'src/gen.ts', verb: 'generate', object: 'object' }],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const prompt = buildCapabilityClaimPrompt(bundle);
    expect(prompt).toContain('evidence://entry/EP-001');
    expect(prompt).toContain('evidence://behavior/BEH-001');
  });

  it('includes capability hints', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-001',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test' },
      confidence: 0.7,
      risks: [],
      capabilityHints: { nameCandidates: ['DB knowledge generation'], relatedTerms: ['db object'] },
      entryPoints: [],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const prompt = buildCapabilityClaimPrompt(bundle);
    expect(prompt).toContain('DB knowledge generation');
    expect(prompt).toContain('db object');
  });
});