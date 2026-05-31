import { describe, expect, it } from 'vitest';
import {
  CandidateClaimSchema,
  filterCandidateClaims,
  buildCapabilityClaimPrompt,
  buildSkeletonClaims,
  isTechnicalTerm,
} from '../../../src/generation/capability-claim-generator.js';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';
import type { CandidateClaim } from '../../../src/generation/capability-claim-generator.js';

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

  it('accepts structured fieldSemantics values from real LLM output', () => {
    const result = CandidateClaimSchema.safeParse({
      suggestedType: 'CON',
      claimText: 'Order detail contract exposes goods line items and goods price semantics.',
      confidence: 'high',
      evidenceRefs: ['evidence://contract/CON-EVID-001'],
      decisionPoints: ['affected_contracts'],
      sddStageUses: ['requirement_specification'],
      unsupportedParts: [],
      blockedDecisions: [],
      source: 'llm',
      objectHints: {
        contractSubject: 'Order detail goods contract',
        contractKind: 'schema',
        fieldSemantics: {
          goodsList: {
            meaning: 'Ordered goods line items returned with the order detail',
            validation: ['Must match submitted goods'],
            evidenceRef: 'evidence://contract/CON-EVID-001',
          },
          goodsPrice: {
            meaning: 'Price used for the ordered goods line',
            notes: ['Currency source is not proven by current evidence'],
          },
        },
      },
    });

    expect(result.success).toBe(true);
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

describe('isTechnicalTerm', () => {
  it('returns true for exact technical terms', () => {
    expect(isTechnicalTerm('mybatis')).toBe(true);
    expect(isTechnicalTerm('mapper')).toBe(true);
    expect(isTechnicalTerm('sql')).toBe(true);
    expect(isTechnicalTerm('database')).toBe(true);
    expect(isTechnicalTerm('controller')).toBe(true);
    expect(isTechnicalTerm('service')).toBe(true);
  });

  it('returns true for compound terms containing technical words', () => {
    expect(isTechnicalTerm('mybatis mapper')).toBe(true);
    expect(isTechnicalTerm('SQL query')).toBe(true);
    expect(isTechnicalTerm('database table')).toBe(true);
    expect(isTechnicalTerm('REST controller')).toBe(true);
    expect(isTechnicalTerm('HTTP request')).toBe(true);
  });

  it('returns false for business terms', () => {
    expect(isTechnicalTerm('goods')).toBe(false);
    expect(isTechnicalTerm('order')).toBe(false);
    expect(isTechnicalTerm('course')).toBe(false);
    expect(isTechnicalTerm('student')).toBe(false);
    expect(isTechnicalTerm('payment')).toBe(false);
  });

  it('handles case insensitivity', () => {
    expect(isTechnicalTerm('MyBatis')).toBe(true);
    expect(isTechnicalTerm('MYBATIS')).toBe(true);
    expect(isTechnicalTerm('SQL')).toBe(true);
  });

  it('returns true for empty or whitespace-only terms', () => {
    expect(isTechnicalTerm('')).toBe(true);
    expect(isTechnicalTerm('  ')).toBe(true);
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
    const claims: CandidateClaim[] = [{
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
    const claims: CandidateClaim[] = [{
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
    const claims: CandidateClaim[] = [{
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
    const claims: CandidateClaim[] = [{
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

  it('rejects OPEN claim without minimalNextEvidence', () => {
    const bundle: EvidenceBundle = {
      ...validBundle,
    };
    const claims: CandidateClaim[] = [{
      suggestedType: 'OPEN',
      claimText: 'Ownership boundary is unknown.',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: ['Cannot decide source of truth'],
      source: 'llm',
    }];

    const filtered = filterCandidateClaims(claims, bundle);
    expect(filtered).toEqual([]);
  });

  it('accepts OPEN claim with blocked decisions and minimalNextEvidence', () => {
    const claims: CandidateClaim[] = [{
      suggestedType: 'OPEN',
      claimText: 'Cannot determine field description source',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: ['Field description inference'],
      blockedDecisions: ['Cannot decide inference acceptability'],
      objectHints: { minimalNextEvidence: ['Find field description documentation'] },
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(1);
  });

  it('rejects claim with evidence ref not in bundle', () => {
    const claims: CandidateClaim[] = [{
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

  it('rejects TERM claim with technical canonicalTerm', () => {
    const claims: CandidateClaim[] = [{
      suggestedType: 'TERM',
      claimText: 'mybatis mapper is a technical component',
      confidence: 'medium',
      evidenceRefs: ['evidence://behavior/BEH-001'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: 'mybatis mapper' },
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });

  it('rejects TERM claim with single technical word as canonicalTerm', () => {
    const claims: CandidateClaim[] = [{
      suggestedType: 'TERM',
      claimText: 'mapper is used for database access',
      confidence: 'medium',
      evidenceRefs: ['evidence://behavior/BEH-001'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: 'mapper' },
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(0);
  });

  it('accepts TERM claim with business canonicalTerm', () => {
    const claims: CandidateClaim[] = [{
      suggestedType: 'TERM',
      claimText: 'goods is a business term',
      confidence: 'medium',
      evidenceRefs: ['evidence://behavior/BEH-001'],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: 'goods' },
    }];

    const filtered = filterCandidateClaims(claims, validBundle);
    expect(filtered.length).toBe(1);
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

describe('buildSkeletonClaims', () => {
  it('generates CAP, FLOW, MOD, CON, VER, OPEN claims from minimal bundle', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-001',
      candidateId: 'CAND-DB-KNOWLEDGE',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['DB Knowledge Generation'],
        relatedTerms: ['mybatis', 'generator'],
      },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'generate' }],
      flowTraces: [{ ref: 'evidence://flow/FLOW-001', steps: [{ action: 'parse', outcome: 'ast' }] }],
      behaviorSlices: [],
      dataContracts: [{ ref: 'evidence://contract/CON-001', kind: 'schema', location: 'src/schema.ts', name: 'DBObject' }],
      moduleSurfaces: [{ ref: 'evidence://module/MOD-001', rootPath: 'src/generation', exports: ['generate'], responsibilities: ['DB generation'] }],
      validationAnchors: [{ ref: 'evidence://validation/VAL-001', kind: 'test', location: 'tests/test.ts', name: 'test generation' }],
      docs: [],
      negativeEvidence: [],
      openQuestions: [{ id: 'Q-001', question: 'What is the source of field descriptions?', blockedDecisions: ['field-description-source'], minimalNextEvidence: 'doc' }],
    };

    const claims = buildSkeletonClaims(bundle);

    const capClaims = claims.filter(c => c.suggestedType === 'CAP');
    const flowClaims = claims.filter(c => c.suggestedType === 'FLOW');
    const modClaims = claims.filter(c => c.suggestedType === 'MOD');
    const conClaims = claims.filter(c => c.suggestedType === 'CON');
    const verClaims = claims.filter(c => c.suggestedType === 'VER');
    const openClaims = claims.filter(c => c.suggestedType === 'OPEN');

    expect(capClaims.length).toBeGreaterThanOrEqual(1);
    expect(flowClaims.length).toBeGreaterThanOrEqual(1);
    expect(modClaims.length).toBeGreaterThanOrEqual(1);
    expect(conClaims.length).toBeGreaterThanOrEqual(1);
    expect(verClaims.length).toBeGreaterThanOrEqual(1);
    expect(openClaims.length).toBeGreaterThanOrEqual(1);
  });

  it('every non-OPEN claim has evidenceRefs with at least one ref', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-002',
      candidateId: 'CAND-DB-KNOWLEDGE',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['DB Knowledge Generation'],
        relatedTerms: ['mybatis'],
      },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'generate' }],
      flowTraces: [{ ref: 'evidence://flow/FLOW-001', steps: [] }],
      behaviorSlices: [],
      dataContracts: [{ ref: 'evidence://contract/CON-001', kind: 'sql', location: 'mapper.xml', name: 'selectUser' }],
      moduleSurfaces: [{ ref: 'evidence://module/MOD-001', rootPath: 'src/mybatis', exports: [], responsibilities: [] }],
      validationAnchors: [{ ref: 'evidence://validation/VAL-001', kind: 'test', location: 'tests/test.ts', name: 'test' }],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const nonOpenClaims = claims.filter(c => c.suggestedType !== 'OPEN');

    for (const claim of nonOpenClaims) {
      expect(claim.evidenceRefs.length).toBeGreaterThan(0);
    }
  });

  it('uses capabilityHints.nameCandidates[0] as capability name', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-003',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['MyBatis Mapper Knowledge'],
        relatedTerms: [],
      },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'generate' }],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const capClaim = claims.find(c => c.suggestedType === 'CAP');

    expect(capClaim).toBeDefined();
    expect(capClaim?.claimText).toContain('MyBatis Mapper Knowledge');
    expect(capClaim?.objectHints?.canonicalTerm).toBe('MyBatis Mapper Knowledge');
  });

  it('falls back to candidateId when nameCandidates is empty', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-004',
      candidateId: 'CAND-FALLBACK',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: [],
        relatedTerms: [],
      },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'generate' }],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const capClaim = claims.find(c => c.suggestedType === 'CAP');

    expect(capClaim).toBeDefined();
    expect(capClaim?.claimText).toContain('CAND-FALLBACK');
  });

  it('generates OPEN claims from openQuestions', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-005',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
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
      openQuestions: [
        { id: 'Q-001', question: 'What is the source?', blockedDecisions: ['source-decision'], minimalNextEvidence: 'doc' },
        { id: 'Q-002', question: 'How to handle edge case?', blockedDecisions: ['edge-case-decision'], minimalNextEvidence: 'test' },
      ],
    };

    const claims = buildSkeletonClaims(bundle);
    const openClaims = claims.filter(c => c.suggestedType === 'OPEN');

    expect(openClaims.length).toBe(2);
    expect(openClaims.some(c => c.claimText === 'What is the source?')).toBe(true);
    expect(openClaims.some(c => c.claimText === 'How to handle edge case?')).toBe(true);
    expect(openClaims.every(c => c.blockedDecisions.length > 0)).toBe(true);
  });

  it('generates OPEN claims from negativeEvidence', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-006',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
      entryPoints: [],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [
        { id: 'NEG-001', kind: 'missing_boundary', description: 'Missing boundary check', impact: 'validation-incomplete' },
      ],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const openClaims = claims.filter(c => c.suggestedType === 'OPEN');

    expect(openClaims.length).toBe(1);
    expect(openClaims[0]?.claimText).toBe('Missing boundary check');
    expect(openClaims[0]?.blockedDecisions).toContain('validation-incomplete');
  });

  it('sets medium confidence for non-OPEN claims', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-007',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
      entryPoints: [{ ref: 'evidence://entry/EP-001', kind: 'cli', location: 'src/cli.ts', name: 'generate' }],
      flowTraces: [{ ref: 'evidence://flow/FLOW-001', steps: [] }],
      behaviorSlices: [],
      dataContracts: [{ ref: 'evidence://contract/CON-001', kind: 'schema', location: 'src/schema.ts', name: 'Schema' }],
      moduleSurfaces: [{ ref: 'evidence://module/MOD-001', rootPath: 'src', exports: [], responsibilities: [] }],
      validationAnchors: [{ ref: 'evidence://validation/VAL-001', kind: 'test', location: 'tests/test.ts', name: 'test' }],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const nonOpenClaims = claims.filter(c => c.suggestedType !== 'OPEN');

    for (const claim of nonOpenClaims) {
      expect(claim.confidence).toBe('medium');
    }
  });

  it('sets low confidence for OPEN claims', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-SKELETON-008',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: { nameCandidates: ['Test'], relatedTerms: [] },
      entryPoints: [],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [{ id: 'NEG-001', kind: 'missing_data', description: 'Missing data', impact: 'data-incomplete' }],
      openQuestions: [{ id: 'Q-001', question: 'What is this?', blockedDecisions: ['decision'], minimalNextEvidence: 'doc' }],
    };

    const claims = buildSkeletonClaims(bundle);
    const openClaims = claims.filter(c => c.suggestedType === 'OPEN');

    for (const claim of openClaims) {
      expect(claim.confidence).toBe('low');
    }
  });

  it('uses highest-relevance evidence from sorted bundle (business over AOP)', () => {
    // This test simulates the scenario where evidence bundle has been sorted
    // by relevance, with business evidence (higher relevance) before AOP (lower relevance)
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-RANKED-001',
      candidateId: 'CAND-COURSE',
      repoProfile: { name: 'test-repo' },
      confidence: 0.85,
      risks: [],
      capabilityHints: { nameCandidates: ['Course Management'], relatedTerms: ['course', 'mybatis'] },
      // Entry points sorted by relevance: course (0.9) > aop (0.3)
      entryPoints: [
        { ref: 'evidence://entry/EP-001', kind: 'http', location: 'src/main/java/com/demo/controller/CourseController.java', name: 'getCourse', targetRelevance: 0.9 },
        { ref: 'evidence://entry/EP-002', kind: 'service', location: 'src/main/java/com/demo/aop/LogAop.java', name: 'logBefore', targetRelevance: 0.3 },
      ],
      flowTraces: [],
      behaviorSlices: [],
      // Data contracts sorted by relevance: course mapper (0.85) > aop (0.2)
      dataContracts: [
        { ref: 'evidence://contract/CON-001', kind: 'sql', location: 'src/main/resources/mapper/CourseMapper.xml', name: 'selectCourse', targetRelevance: 0.85 },
        { ref: 'evidence://contract/CON-002', kind: 'interface', location: 'src/main/java/com/demo/aop/RateLimitAspect.java', name: 'RateLimit', targetRelevance: 0.2 },
      ],
      // Module surfaces sorted by relevance: controller/service (0.8) > aop (0.25)
      moduleSurfaces: [
        { ref: 'evidence://module/MOD-001', rootPath: 'src/main/java/com/demo/controller', exports: ['CourseController'], responsibilities: [], targetRelevance: 0.8 },
        { ref: 'evidence://module/MOD-002', rootPath: 'src/main/java/com/demo/aop', exports: ['LogAop'], responsibilities: [], targetRelevance: 0.25 },
      ],
      // Validation anchors sorted by relevance: course test (0.75) > aop test (0.2)
      validationAnchors: [
        { ref: 'evidence://validation/VAL-001', kind: 'test', location: 'src/test/java/com/demo/service/CourseServiceTest.java', name: 'shouldLoadCourse', targetRelevance: 0.75 },
        { ref: 'evidence://validation/VAL-002', kind: 'test', location: 'src/test/java/com/demo/aop/AopTest.java', name: 'aopTest', targetRelevance: 0.2 },
      ],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);

    // CAP claim should use course controller (EP-001), not aop (EP-002)
    const capClaim = claims.find(c => c.suggestedType === 'CAP');
    expect(capClaim).toBeDefined();
    expect(capClaim?.evidenceRefs).toContain('evidence://entry/EP-001');
    expect(capClaim?.evidenceRefs).not.toContain('evidence://entry/EP-002');

    // CON claim should use course mapper (CON-001), not aop interface (CON-002)
    const conClaim = claims.find(c => c.suggestedType === 'CON');
    expect(conClaim).toBeDefined();
    expect(conClaim?.evidenceRefs).toContain('evidence://contract/CON-001');
    expect(conClaim?.claimText).toContain('selectCourse');
    expect(conClaim?.claimText).not.toContain('RateLimit');

    // MOD claim should use controller module (MOD-001), not aop module (MOD-002)
    const modClaim = claims.find(c => c.suggestedType === 'MOD');
    expect(modClaim).toBeDefined();
    expect(modClaim?.objectHints?.modulePath).toBe('src/main/java/com/demo/controller');
    expect(modClaim?.objectHints?.modulePath).not.toContain('aop');

    // VER claim should use course test (VAL-001), not aop test (VAL-002)
    const verClaim = claims.find(c => c.suggestedType === 'VER');
    expect(verClaim).toBeDefined();
    expect(verClaim?.evidenceRefs).toContain('evidence://validation/VAL-001');
    expect(verClaim?.claimText).toContain('shouldLoadCourse');
    expect(verClaim?.claimText).not.toContain('aopTest');
  });

  it('generates TERM claims from matched business evidence', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-TERM-001',
      candidateId: 'CAND-GOODS-ORDER',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['Goods Order capability'],
        relatedTerms: ['goods', 'order', 'mybatis mapper'],
      },
      entryPoints: [
        {
          ref: 'evidence://entry/EP-001',
          kind: 'service',
          location: 'src/main/java/demo/OrderGoodsService.java',
          name: 'OrderGoodsService',
          targetRelevance: 0.75,
          matchedTerms: ['goods', 'order'],
        },
      ],
      behaviorSlices: [
        {
          ref: 'evidence://behavior/BEH-001',
          location: 'src/main/java/demo/OrderGoodsService.java',
          verb: 'create',
          object: 'order goods',
          targetRelevance: 0.75,
          matchedTerms: ['goods', 'order'],
        },
      ],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      flowTraces: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const termClaims = claims.filter(claim => claim.suggestedType === 'TERM');

    expect(termClaims.map(claim => claim.objectHints?.canonicalTerm)).toEqual(expect.arrayContaining(['goods', 'order']));
    expect(termClaims.every(claim => claim.evidenceRefs.length > 0)).toBe(true);
    expect(termClaims.every(claim => claim.confidence !== 'low')).toBe(true);
  });

  it('excludes technical context terms from TERM claims', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-TERM-002',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['Test capability'],
        relatedTerms: ['mybatis', 'mapper', 'sql', 'db', 'database'],
      },
      entryPoints: [],
      behaviorSlices: [
        {
          ref: 'evidence://behavior/BEH-001',
          location: 'src/main/java/demo/Mapper.java',
          verb: 'select',
          object: 'mybatis mapper',
          targetRelevance: 0.5,
          matchedTerms: ['mybatis', 'mapper', 'sql'],
        },
      ],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      flowTraces: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const claims = buildSkeletonClaims(bundle);
    const termClaims = claims.filter(claim => claim.suggestedType === 'TERM');

    expect(termClaims.length).toBe(0);
  });

  it('lists allowed sddStageUses values for LLM output', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-ENUM-001',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: { nameCandidates: ['Goods Order capability'], relatedTerms: ['goods', 'order'] },
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

    expect(prompt).toContain('sddStageUses allowed values');
    expect(prompt).toContain('requirement_clarification');
    expect(prompt).toContain('implementation_planning');
    expect(prompt).toContain('Do not invent other stage names');
  });

  it('instructs the model to return strict JSON only and never invent facts', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-STRICT-001',
      candidateId: 'CAND-001',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: { nameCandidates: ['Goods Order capability'], relatedTerms: ['goods', 'order'] },
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

    expect(prompt).toContain('Return strict JSON array only');
    expect(prompt).toContain('do not invent facts');
    expect(prompt).toContain('do not create object IDs or file paths');
    expect(prompt).toContain('missing evidence becomes OPEN');
  });
});