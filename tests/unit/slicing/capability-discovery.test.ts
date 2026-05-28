import { describe, expect, it } from 'vitest';
import { CapabilityCandidateSchema } from '../../../src/slicing/capability-candidate-schema.js';

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