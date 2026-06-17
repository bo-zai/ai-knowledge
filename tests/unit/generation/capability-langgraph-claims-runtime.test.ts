import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { EvidenceBundle } from "../../../src/evidence/evidence-bundle-schema.js";
import { runCapabilityClaimsLangGraph } from "../../../src/generation/capability-langgraph-claims-runtime.js";

function makeBundle(): EvidenceBundle {
  return {
    bundleId: "BUNDLE-GOODS-ORDER",
    candidateId: "CAND-GOODS-ORDER",
    repoProfile: { name: "music-education-app" },
    confidence: 0.85,
    risks: [],
    capabilityHints: {
      nameCandidates: ["Goods Order capability"],
      relatedTerms: ["goods", "order"],
    },
    entryPoints: [
      {
        ref: "evidence://entry/EP-001",
        kind: "service",
        location: "src/main/java/demo/OrderGoodsService.java",
        name: "OrderGoodsService",
        description: "Spring service entry",
        matchedTerms: ["goods", "order"],
        targetRelevance: 0.75,
      },
    ],
    flowTraces: [],
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
      const content = outputs[index] ?? outputs[outputs.length - 1] ?? "[]";
      index += 1;
      return new AIMessage(content);
    },
  };
}

describe("runCapabilityClaimsLangGraph", () => {
  it("accepts valid model JSON with evidence-backed non-OPEN claim", async () => {
    const result = await runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: "test-model",
      model: makeModel([
        JSON.stringify([
          {
            suggestedType: "CAP",
            claimText:
              "Goods Order capability is supported by OrderGoodsService.",
            confidence: "medium",
            evidenceRefs: ["evidence://entry/EP-001"],
            decisionPoints: ["matched_capability"],
            sddStageUses: ["requirement_clarification"],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: "Goods Order capability" },
          },
        ]),
      ]),
    });

    expect(result.claims).toHaveLength(1);
    expect(result.graphTrace.attempts).toBe(1);
    expect(result.graphTrace.repaired).toBe(false);
  });

  it("repairs invalid JSON once and accepts repaired claims", async () => {
    const result = await runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: "test-model",
      model: makeModel([
        "not-json",
        JSON.stringify([
          {
            suggestedType: "CAP",
            claimText:
              "Goods Order capability is supported by OrderGoodsService.",
            confidence: "medium",
            evidenceRefs: ["evidence://entry/EP-001"],
            decisionPoints: ["matched_capability"],
            sddStageUses: ["requirement_clarification"],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: "Goods Order capability" },
          },
        ]),
      ]),
    });

    expect(result.claims).toHaveLength(1);
    expect(result.graphTrace.attempts).toBe(2);
    expect(result.graphTrace.repaired).toBe(true);
    expect(result.graphTrace.validationErrors.length).toBeGreaterThan(0);
  });

  it("records parser normalization notes in graphTrace", async () => {
    const result = await runCapabilityClaimsLangGraph({
      bundle: makeBundle(),
      modelName: "test-model",
      model: makeModel([
        JSON.stringify([
          {
            suggestedType: "OPEN",
            claimText: "Validation oracle is missing.",
            confidence: "low",
            evidenceRefs: [],
            decisionPoints: [],
            sddStageUses: ["requirement_clarification"],
            unsupportedParts: [],
            blockedDecisions: "Cannot plan validation",
            objectHints: { minimalNextEvidence: "Find validation test" },
          },
          {
            suggestedType: "CAP",
            claimText:
              "Goods Order capability lets customers submit goods orders.",
            confidence: "high",
            evidenceRefs: ["evidence://entry/EP-001"],
            decisionPoints: ["requirement_intent"],
            sddStageUses: ["requirement_clarification"],
            unsupportedParts: [],
            blockedDecisions: [],
            objectHints: { canonicalTerm: "Goods Order capability" },
          },
        ]),
      ]),
    });

    expect(result.graphTrace.normalizationNotes.length).toBeGreaterThan(0);
  });

  it("fails when no accepted non-OPEN claim remains after evidence filtering", async () => {
    await expect(
      runCapabilityClaimsLangGraph({
        bundle: makeBundle(),
        modelName: "test-model",
        model: makeModel([
          JSON.stringify([
            {
              suggestedType: "CAP",
              claimText: "Unsupported claim.",
              confidence: "medium",
              evidenceRefs: ["evidence://entry/MISSING"],
              decisionPoints: [],
              sddStageUses: ["requirement_clarification"],
              unsupportedParts: [],
              blockedDecisions: [],
            },
          ]),
        ]),
      }),
    ).rejects.toThrow(/accepted non-OPEN/);
  });
});
