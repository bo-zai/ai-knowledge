import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';
import {
  createCapabilityLlmClaimsProvider,
  parseCapabilityClaimJson,
} from '../../../src/generation/capability-llm-claims-provider.js';

function makeBundle(): EvidenceBundle {
  return {
    bundleId: 'BUNDLE-GOODS-ORDER',
    candidateId: 'CAND-GOODS-ORDER',
    repoProfile: { name: 'music-education-app' },
    confidence: 0.85,
    risks: [],
    capabilityHints: {
      nameCandidates: ['Goods Order capability'],
      relatedTerms: ['goods', 'order'],
    },
    entryPoints: [
      {
        ref: 'evidence://entry/EP-001',
        kind: 'service',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
        description: 'Spring service entry',
        matchedTerms: ['goods', 'order'],
        targetRelevance: 0.75,
      },
    ],
    flowTraces: [
      {
        ref: 'evidence://flow/FLOW-EVID-001',
        steps: [{ action: 'create order goods', location: 'src/main/java/demo/OrderGoodsService.java' }],
        matchedTerms: ['goods', 'order'],
        targetRelevance: 0.75,
      },
    ],
    behaviorSlices: [],
    dataContracts: [],
    moduleSurfaces: [],
    validationAnchors: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

function makeModel(outputs: string[]) {
  let index = 0;
  return {
    async invoke() {
      const content = outputs[index] ?? outputs[outputs.length - 1] ?? '[]';
      index += 1;
      return new AIMessage(content);
    },
  };
}

describe('capability llm claims provider', () => {
  it('parses a strict JSON claim array', () => {
    const claims = parseCapabilityClaimJson(JSON.stringify([
      {
        suggestedType: 'CAP',
        claimText: 'Goods Order capability coordinates order goods behavior.',
        confidence: 'medium',
        evidenceRefs: ['evidence://entry/EP-001'],
        decisionPoints: ['matched_capability'],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: { canonicalTerm: 'Goods Order capability' },
      },
    ]));

    expect(claims).toHaveLength(1);
    expect(claims[0]!.suggestedType).toBe('CAP');
  });

  it('parses JSON inside markdown fences when providers wrap output', () => {
    const claims = parseCapabilityClaimJson('```json\n[]\n```');
    expect(claims).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCapabilityClaimJson('not-json')).toThrow(/Invalid capability claim JSON/);
  });

  it('uses LangGraph runtime and returns claims with graphTrace', async () => {
    const provider = createCapabilityLlmClaimsProvider({
      model: 'test-model',
      modelInstance: makeModel([
        JSON.stringify([
          {
            suggestedType: 'CAP',
            claimText: 'Goods Order capability coordinates order goods behavior.',
            confidence: 'medium',
            evidenceRefs: ['evidence://entry/EP-001'],
            decisionPoints: ['matched_capability'],
            sddStageUses: ['requirement_clarification'],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: 'Goods Order capability' },
          },
        ]),
      ]),
    });

    const result = await provider(makeBundle());

    expect(result.claims).toHaveLength(1);
    expect(result.model).toBe('test-model');
    expect(result.systemPrompt).toContain('You generate evidence-grounded capability knowledge claims');
    expect(result.userPrompt).toContain('AVAILABLE EVIDENCE REFS');
    expect(result.graphTrace).toBeDefined();
    expect(result.graphTrace.attempts).toBe(1);
    expect(result.graphTrace.repaired).toBe(false);
  });
});
