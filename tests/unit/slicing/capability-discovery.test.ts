import { describe, expect, it } from 'vitest';
import { CapabilityCandidateSchema } from '../../../src/slicing/capability-candidate-schema.js';
import { normalizeCapabilityTerms, discoverCapabilities } from '../../../src/slicing/capability-discovery.js';

describe('CapabilityCandidateSchema', () => {
  it('accepts a valid targeted capability candidate', () => {
    const candidate = CapabilityCandidateSchema.parse({
      candidateId: 'CAND-DB-KNOWLEDGE-GENERATION',
      nameCandidates: ['DB knowledge generation'],
      confidence: 0.78,
      confidenceBreakdown: {
        entrySignal: 0.75,
        behaviorSignal: 0.85,
        dataSignal: 0.9,
        testSignal: 0.65,
        docSignal: 0.4,
        graphCohesion: 0.75,
      },
      primaryEntryPoints: [],
      behaviorAnchors: [],
      dataAnchors: [],
      testAnchors: [],
      docAnchors: [],
      moduleClusters: [],
      relatedTerms: ['db object', 'description source'],
      risks: ['no_external_boundary_found'],
      missingSignals: ['No explicit external DB ownership contract found'],
    });

    expect(candidate.candidateId).toBe('CAND-DB-KNOWLEDGE-GENERATION');
  });

  it('rejects confidence greater than one', () => {
    expect(() =>
      CapabilityCandidateSchema.parse({
        candidateId: 'CAND-BAD',
        nameCandidates: ['Bad'],
        confidence: 1.2,
        confidenceBreakdown: {
          entrySignal: 0,
          behaviorSignal: 0,
          dataSignal: 0,
          testSignal: 0,
          docSignal: 0,
          graphCohesion: 0,
        },
        primaryEntryPoints: [],
        behaviorAnchors: [],
        dataAnchors: [],
        testAnchors: [],
        docAnchors: [],
        moduleClusters: [],
        relatedTerms: [],
        risks: [],
        missingSignals: [],
      }),
    ).toThrow();
  });

  it('rejects confidence less than zero', () => {
    expect(() =>
      CapabilityCandidateSchema.parse({
        candidateId: 'CAND-BAD',
        nameCandidates: ['Bad'],
        confidence: -0.1,
        confidenceBreakdown: {
          entrySignal: 0,
          behaviorSignal: 0,
          dataSignal: 0,
          testSignal: 0,
          docSignal: 0,
          graphCohesion: 0,
        },
        primaryEntryPoints: [],
        behaviorAnchors: [],
        dataAnchors: [],
        testAnchors: [],
        docAnchors: [],
        moduleClusters: [],
        relatedTerms: [],
        risks: [],
        missingSignals: [],
      }),
    ).toThrow();
  });

  it('rejects empty name candidates', () => {
    expect(() =>
      CapabilityCandidateSchema.parse({
        candidateId: 'CAND-EMPTY',
        nameCandidates: [],
        confidence: 0.6,
        confidenceBreakdown: {
          entrySignal: 0.5,
          behaviorSignal: 0.5,
          dataSignal: 0.5,
          testSignal: 0.5,
          docSignal: 0.5,
          graphCohesion: 0.5,
        },
        primaryEntryPoints: [],
        behaviorAnchors: [],
        dataAnchors: [],
        testAnchors: [],
        docAnchors: [],
        moduleClusters: [],
        relatedTerms: [],
        risks: [],
        missingSignals: [],
      }),
    ).toThrow();
  });
});

describe('normalizeCapabilityTerms', () => {
  it('splits camelCase into words', () => {
    const terms = normalizeCapabilityTerms('generateDbObject');
    expect(terms).toContain('generate');
    expect(terms).toContain('db');
    expect(terms).toContain('object');
  });

  it('splits PascalCase into words', () => {
    const terms = normalizeCapabilityTerms('DbKnowledgeGenerator');
    expect(terms).toContain('db');
    expect(terms).toContain('knowledge');
    expect(terms).toContain('generator');
  });

  it('splits kebab-case into words', () => {
    const terms = normalizeCapabilityTerms('db-knowledge-generation');
    expect(terms).toContain('db');
    expect(terms).toContain('knowledge');
    expect(terms).toContain('generation');
  });

  it('splits snake_case into words', () => {
    const terms = normalizeCapabilityTerms('db_knowledge_generation');
    expect(terms).toContain('db');
    expect(terms).toContain('knowledge');
    expect(terms).toContain('generation');
  });

  it('merges domain phrases', () => {
    const terms = normalizeCapabilityTerms('generate db object for mybatis mapper');
    expect(terms).toContain('db object');
    expect(terms).toContain('mybatis mapper');
  });

  it('normalizes to lowercase', () => {
    const terms = normalizeCapabilityTerms('DBKnowledgeGeneration');
    expect(terms.some(t => t === 'db')).toBe(true);
    expect(terms.some(t => t === 'knowledge')).toBe(true);
    expect(terms.some(t => t === 'generation')).toBe(true);
  });
});

describe('discoverCapabilities', () => {
  it('discovers candidate from target terms', async () => {
    const candidates = await discoverCapabilities({
      repoRoot: '.',
      targetTerms: ['db', 'mybatis', 'knowledge'],
      targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge'],
    });

    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const topCandidate = candidates[0];
    expect(topCandidate).toBeDefined();
    expect(topCandidate?.confidence).toBeGreaterThanOrEqual(0.55);
    expect(topCandidate?.relatedTerms.some(t => t.includes('db') || t.includes('object'))).toBe(true);
  });

  it('includes no_external_boundary_found risk when no API/event signal', async () => {
    const candidates = await discoverCapabilities({
      repoRoot: '.',
      targetTerms: ['db', 'mybatis', 'knowledge'],
      targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge'],
    });

    const topCandidate = candidates[0];
    expect(topCandidate).toBeDefined();
    expect(topCandidate?.risks).toContain('no_external_boundary_found');
  });
});