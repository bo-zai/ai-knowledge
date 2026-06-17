import { describe, expect, it } from "vitest";
import { runCapabilityKnowledgePipeline } from "../../../src/knowledge/capability-knowledge-pipeline.js";
import type { CandidateClaim } from "../../../src/generation/capability-claim-generator.js";

const validCapClaim: CandidateClaim = {
  suggestedType: "CAP",
  claimText: "DB knowledge capability from provider",
  confidence: "medium",
  evidenceRefs: ["evidence://module/MOD-001"],
  decisionPoints: ["custom_capability"],
  sddStageUses: ["requirement_clarification"],
  unsupportedParts: [],
  blockedDecisions: [],
  source: "llm",
};

const validFlowClaim: CandidateClaim = {
  suggestedType: "FLOW",
  claimText:
    "DB knowledge generation flow processes mybatis evidence into knowledge objects",
  confidence: "high",
  evidenceRefs: ["evidence://module/MOD-001"],
  decisionPoints: ["current_behavior"],
  sddStageUses: ["design_planning"],
  unsupportedParts: [],
  blockedDecisions: [],
  source: "llm",
};

const validModClaim: CandidateClaim = {
  suggestedType: "MOD",
  claimText:
    "MyBatis evidence module is the change surface for DB knowledge generation",
  confidence: "high",
  evidenceRefs: ["evidence://module/MOD-001"],
  decisionPoints: ["change_surface"],
  sddStageUses: ["implementation_planning", "coding"],
  unsupportedParts: [],
  blockedDecisions: [],
  source: "llm",
  objectHints: {
    modulePath: "src/mybatis",
    ownedResponsibility: "MyBatis evidence extraction",
    touchWhen: [
      "Changing evidence collection logic",
      "Changing mapper parsing",
    ],
    doNotTouchWhen: ["Changing unrelated schema definitions"],
  },
};

const validVerClaim: CandidateClaim = {
  suggestedType: "VER",
  claimText: "DB object generation passes DBObjectSchema validation",
  confidence: "high",
  evidenceRefs: ["evidence://module/MOD-001"],
  decisionPoints: ["validation_plan"],
  sddStageUses: ["validation"],
  unsupportedParts: [],
  blockedDecisions: [],
  source: "llm",
  objectHints: {
    verificationGoal: "Generated DB object matches schema contract",
    acceptanceOracle: [
      "DBObjectSchema validation passes",
      "All required fields present",
    ],
  },
};

const validOpenClaim: CandidateClaim = {
  suggestedType: "OPEN",
  claimText: "Open question from provider",
  confidence: "low",
  evidenceRefs: [],
  decisionPoints: [],
  sddStageUses: [],
  unsupportedParts: [],
  blockedDecisions: ["custom-blocked"],
  objectHints: { minimalNextEvidence: ["Review validation tests"] },
};

function makeBusinessQualityClaims(): CandidateClaim[] {
  return [validCapClaim, validFlowClaim, validModClaim, validVerClaim];
}

describe("runCapabilityKnowledgePipeline", () => {
  it("generates files for targeted DB knowledge capability", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
    });

    expect(result.files.length).toBeGreaterThan(0);

    const catalog = result.files.find((f) => f.path === "catalog.yaml");
    expect(catalog).toBeDefined();

    const view = result.files.find(
      (f) => f.path.startsWith("views/capabilities/") && f.path.endsWith(".md"),
    );
    expect(view).toBeDefined();
  });

  it("returns no files when no candidate found", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: [],
      targetPaths: [],
      claimsProvider: async () => ({ claims: [validCapClaim, validFlowClaim] }),
    });

    expect(result.files.length).toBe(0);
    expect(result.objects.length).toBe(0);
  });

  it("includes pipeline metadata", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
    });

    expect(result.metadata.capabilityId).toBeDefined();
    expect(result.metadata.confidence).toBeGreaterThanOrEqual(0);
  });

  it("throws when no claimsProvider is supplied", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["goods", "order"],
        targetPaths: ["src"],
      }),
    ).rejects.toThrow(/LLM claimsProvider is required/);
  });

  it("throws when provider claims are all filtered out", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => ({
          claims: [
            {
              suggestedType: "CAP",
              claimText: "Unsupported LLM claim.",
              confidence: "medium",
              evidenceRefs: ["evidence://missing/REF-001"],
              decisionPoints: [],
              sddStageUses: ["requirement_clarification"],
              unsupportedParts: [],
              blockedDecisions: [],
            },
          ],
        }),
      }),
    ).rejects.toThrow(/accepted non-OPEN/);
  });

  it("throws when provider has only OPEN claims", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => ({
          claims: [validOpenClaim],
        }),
      }),
    ).rejects.toThrow(/accepted non-OPEN/);
  });

  it("merges provider claims with skeleton claims when provider has non-OPEN", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
    });

    expect(result.objects.some((o) => o.type === "CAP")).toBe(true);
    expect(result.objects.some((o) => o.type === "FLOW")).toBe(true);
    expect(result.objects.some((o) => o.type === "MOD")).toBe(true);
  });

  it("uses provider claims and records LLM metadata", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
      llmMode: { requested: true, required: true, model: "test-model" },
    });

    expect(result.metadata.llm.requested).toBe(true);
    expect(result.metadata.llm.called).toBe(true);
    expect(result.metadata.llm.succeeded).toBe(true);
  });

  it("throws when LLM provider throws", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => {
          throw new Error("model failed");
        },
      }),
    ).rejects.toThrow(/LLM generation failed/);
  });

  it("throws when accepted LLM claims do not include CAP", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => ({
          claims: [
            {
              suggestedType: "CON",
              claimText: "Order goods input includes goods id and quantity.",
              confidence: "high",
              evidenceRefs: ["evidence://module/MOD-001"],
              decisionPoints: ["affected_contracts"],
              sddStageUses: ["requirement_specification"],
              unsupportedParts: [],
              blockedDecisions: [],
              source: "llm",
            },
          ],
        }),
      }),
    ).rejects.toThrow(/LLM CAP claim is required/);
  });

  it("throws when accepted LLM claims do not include FLOW or CON", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => ({
          claims: [
            {
              suggestedType: "CAP",
              claimText:
                "Order goods fulfillment lets a customer submit goods as part of an order.",
              confidence: "high",
              evidenceRefs: ["evidence://module/MOD-001"],
              decisionPoints: ["requirement_intent"],
              sddStageUses: ["requirement_clarification"],
              unsupportedParts: [],
              blockedDecisions: [],
              source: "llm",
            },
          ],
        }),
      }),
    ).rejects.toThrow(/LLM FLOW or CON claim is required/);
  });

  it("throws when MOD exists only from skeleton without touch guidance", async () => {
    await expect(
      runCapabilityKnowledgePipeline({
        repoRoot: ".",
        targetTerms: ["db", "mybatis", "knowledge"],
        targetPaths: [
          "src/mybatis",
          "src/evidence",
          "src/knowledge",
          "src/schemas",
        ],
        claimsProvider: async () => ({
          claims: [validCapClaim, validFlowClaim, validVerClaim],
        }),
      }),
    ).rejects.toThrow(/MOD touch guidance/);
  });

  it("reports single capability generation mode and selected candidate", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
    });

    expect(result.report.capabilityGenerationMode).toBe("single");
    expect(result.report.selectedCandidateId).toBeTruthy();
    expect(result.report.candidateCount).toBeGreaterThanOrEqual(0);
  });

  it("reports stronger business quality gates", async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: ".",
      targetTerms: ["db", "mybatis", "knowledge"],
      targetPaths: [
        "src/mybatis",
        "src/evidence",
        "src/knowledge",
        "src/schemas",
      ],
      claimsProvider: async () => ({ claims: makeBusinessQualityClaims() }),
    });

    expect(result.report.requiredBusinessObjects).toBeDefined();
    expect(result.report.requiredBusinessObjects!.modHasTouchGuidance).toBe(
      true,
    );
    expect(result.report.requiredBusinessObjects!.verHasOracle).toBe(true);
    expect(result.report.requiredBusinessObjects!.noTechnicalTermLeakage).toBe(
      true,
    );
  });
});
