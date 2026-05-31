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

  it('parses fieldSemantics object values from real LLM output', () => {
    const claims = parseCapabilityClaimJson(JSON.stringify([
      {
        suggestedType: 'CON',
        claimText: 'Order detail exposes ordered goods and price fields.',
        confidence: 'high',
        evidenceRefs: ['evidence://contract/CON-EVID-001'],
        decisionPoints: ['affected_contracts'],
        sddStageUses: ['requirement_specification'],
        unsupportedParts: [],
        blockedDecisions: [],
        objectHints: {
          contractSubject: 'Order detail goods contract',
          contractKind: 'schema',
          fieldSemantics: {
            goodsList: {
              meaning: 'Ordered goods line items',
              validation: ['Must match the order goods records'],
              evidenceRef: 'evidence://contract/CON-EVID-001',
            },
            goodsPrice: {
              meaning: 'Displayed price for ordered goods',
            },
          },
        },
      },
    ]));

    expect(claims).toHaveLength(1);
    expect(claims[0]!.objectHints?.fieldSemantics).toBeDefined();
  });

  it('normalizes common string fields into arrays before schema validation', () => {
    const claims = parseCapabilityClaimJson(JSON.stringify([
      {
        suggestedType: 'OPEN',
        claimText: 'Validation oracle is not proven.',
        confidence: 'low',
        evidenceRefs: [],
        decisionPoints: [],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: [],
        blockedDecisions: 'Cannot prove order submission behavior',
        objectHints: {
          minimalNextEvidence: 'Find an integration test for order submission',
        },
      },
    ]));

    expect(claims[0]!.blockedDecisions).toEqual(['Cannot prove order submission behavior']);
    expect(claims[0]!.objectHints?.minimalNextEvidence).toEqual(['Find an integration test for order submission']);
  });

  it('removes root-level fields mistakenly placed in objectHints', () => {
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
        objectHints: {
          canonicalTerm: 'Goods Order capability',
          blockedDecisions: 'should not be here',
          evidenceRefs: ['wrong place'],
        },
      },
    ]));

    expect(claims).toHaveLength(1);
    // blockedDecisions should not appear in objectHints
    const hints = claims[0]!.objectHints;
    expect(hints && (hints as Record<string, unknown>).blockedDecisions).toBeUndefined();
    expect(hints && (hints as Record<string, unknown>).evidenceRefs).toBeUndefined();
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
