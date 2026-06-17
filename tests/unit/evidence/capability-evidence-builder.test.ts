import { describe, expect, it } from "vitest";
import {
  EvidenceBundleSchema,
  EvidenceEntryPointSchema,
  EvidenceBehaviorSliceSchema,
  EvidenceDataContractSchema,
  EvidenceFlowTraceSchema,
  EvidenceModuleSurfaceSchema,
  EvidenceValidationAnchorSchema,
  NegativeEvidenceSchema,
  OpenQuestionSeedSchema,
} from "../../../src/evidence/evidence-bundle-schema.js";
import { buildEvidenceBundle } from "../../../src/evidence/capability-evidence-builder.js";
import type { CapabilityCandidate } from "../../../src/slicing/capability-candidate-schema.js";

describe("EvidenceEntryPointSchema", () => {
  it("accepts valid entry point", () => {
    const entry = EvidenceEntryPointSchema.parse({
      ref: "evidence://entry/EP-001",
      kind: "cli",
      location: "src/cli/generate.ts",
      name: "generate command",
      signature: "generate(options: GenerateOptions): Promise<void>",
    });
    expect(entry.ref).toBe("evidence://entry/EP-001");
  });

  it("rejects missing ref", () => {
    expect(() =>
      EvidenceEntryPointSchema.parse({
        kind: "cli",
        location: "src/cli/generate.ts",
        name: "generate command",
      }),
    ).toThrow();
  });
});

describe("EvidenceBehaviorSliceSchema", () => {
  it("accepts valid behavior slice", () => {
    const slice = EvidenceBehaviorSliceSchema.parse({
      ref: "evidence://behavior/BEH-001",
      location: "src/generation/db-generator.ts",
      verb: "generate",
      object: "db object",
      summary: "Generates DB knowledge object from MyBatis evidence",
    });
    expect(slice.ref).toBe("evidence://behavior/BEH-001");
  });
});

describe("EvidenceDataContractSchema", () => {
  it("accepts valid data contract", () => {
    const contract = EvidenceDataContractSchema.parse({
      ref: "evidence://contract/CON-001",
      kind: "schema",
      location: "src/schemas/object-schemas.ts",
      name: "DBObjectSchema",
      fields: ["id", "name", "description_zh", "description_source"],
    });
    expect(contract.ref).toBe("evidence://contract/CON-001");
  });
});

describe("EvidenceFlowTraceSchema", () => {
  it("accepts valid flow trace", () => {
    const flow = EvidenceFlowTraceSchema.parse({
      ref: "evidence://flow/FLOW-001",
      steps: [
        {
          action: "collect mybatis mapper files",
          location: "src/mybatis/mapper-reader.ts",
        },
        {
          action: "extract sql evidence",
          location: "src/mybatis/sql-evidence.ts",
        },
        {
          action: "generate db object",
          location: "src/generation/db-generator.ts",
        },
      ],
    });
    expect(flow.steps.length).toBe(3);
  });
});

describe("EvidenceModuleSurfaceSchema", () => {
  it("accepts valid module surface", () => {
    const surface = EvidenceModuleSurfaceSchema.parse({
      ref: "evidence://module/MOD-001",
      rootPath: "src/mybatis",
      exports: ["extractMyBatisEvidence", "parseMapperFile"],
      responsibilities: ["MyBatis mapper parsing", "SQL evidence extraction"],
    });
    expect(surface.rootPath).toBe("src/mybatis");
  });
});

describe("EvidenceValidationAnchorSchema", () => {
  it("accepts valid validation anchor", () => {
    const anchor = EvidenceValidationAnchorSchema.parse({
      ref: "evidence://validation/VAL-001",
      kind: "test",
      location: "tests/unit/generation/db-generator.test.ts",
      name: "generates valid db object",
      assertion: "expect(result.id).toBeDefined()",
    });
    expect(anchor.kind).toBe("test");
  });
});

describe("NegativeEvidenceSchema", () => {
  it("accepts valid negative evidence", () => {
    const neg = NegativeEvidenceSchema.parse({
      id: "NEG-001",
      kind: "missing_boundary",
      description: "No explicit external DB ownership contract found",
      impact: "Cannot determine if DB schema changes require coordination",
    });
    expect(neg.kind).toBe("missing_boundary");
  });
});

describe("OpenQuestionSeedSchema", () => {
  it("accepts valid open question seed", () => {
    const seed = OpenQuestionSeedSchema.parse({
      id: "OPEN-SEED-001",
      question: "What is the source of field descriptions?",
      blockedDecisions: [
        "Cannot determine if description inference is acceptable",
      ],
      minimalNextEvidence:
        "Find documentation or comments explaining description_source values",
    });
    expect(seed.question).toContain("source");
  });
});

describe("EvidenceBundleSchema", () => {
  it("accepts minimal valid bundle", () => {
    const bundle = EvidenceBundleSchema.parse({
      bundleId: "BUNDLE-DB-KNOWLEDGE-001",
      candidateId: "CAND-DB-KNOWLEDGE-GENERATION",
      repoProfile: {
        name: "ai-wiki",
        language: "typescript",
        framework: "node",
      },
      confidence: 0.78,
      risks: ["no_external_boundary_found"],
      capabilityHints: {
        nameCandidates: ["DB knowledge generation"],
        relatedTerms: ["db object", "description source"],
      },
      entryPoints: [
        {
          ref: "evidence://entry/EP-001",
          kind: "cli",
          location: "src/cli/generate.ts",
          name: "generate command",
        },
      ],
      flowTraces: [
        {
          ref: "evidence://flow/FLOW-001",
          steps: [],
        },
      ],
      behaviorSlices: [
        {
          ref: "evidence://behavior/BEH-001",
          location: "src/generation/db-generator.ts",
          verb: "generate",
          object: "db object",
        },
      ],
      dataContracts: [
        {
          ref: "evidence://contract/CON-001",
          kind: "schema",
          location: "src/schemas/object-schemas.ts",
          name: "DBObjectSchema",
        },
      ],
      moduleSurfaces: [
        {
          ref: "evidence://module/MOD-001",
          rootPath: "src/mybatis",
          exports: [],
          responsibilities: [],
        },
      ],
      validationAnchors: [
        {
          ref: "evidence://validation/VAL-001",
          kind: "test",
          location: "tests/unit/generation/db-generator.test.ts",
          name: "generates valid db object",
        },
      ],
      docs: [],
      negativeEvidence: [
        {
          id: "NEG-001",
          kind: "missing_boundary",
          description: "No external DB contract",
          impact: "Cannot determine DB ownership",
        },
      ],
      openQuestions: [
        {
          id: "OPEN-SEED-001",
          question: "What is the source of field descriptions?",
          blockedDecisions: ["Cannot determine inference acceptability"],
          minimalNextEvidence: "Find documentation about description_source",
        },
      ],
    });

    expect(bundle.bundleId).toBe("BUNDLE-DB-KNOWLEDGE-001");
    expect(bundle.candidateId).toBe("CAND-DB-KNOWLEDGE-GENERATION");
  });

  it("rejects missing bundleId", () => {
    expect(() =>
      EvidenceBundleSchema.parse({
        candidateId: "CAND-001",
        repoProfile: { name: "test" },
        confidence: 0.5,
        risks: [],
        capabilityHints: { nameCandidates: ["Test"] },
        entryPoints: [],
        flowTraces: [],
        behaviorSlices: [],
        dataContracts: [],
        moduleSurfaces: [],
        validationAnchors: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      }),
    ).toThrow();
  });

  it("rejects missing candidateId", () => {
    expect(() =>
      EvidenceBundleSchema.parse({
        bundleId: "BUNDLE-001",
        repoProfile: { name: "test" },
        confidence: 0.5,
        risks: [],
        capabilityHints: { nameCandidates: ["Test"] },
        entryPoints: [],
        flowTraces: [],
        behaviorSlices: [],
        dataContracts: [],
        moduleSurfaces: [],
        validationAnchors: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      }),
    ).toThrow();
  });
});

describe("buildEvidenceBundle", () => {
  it("copies candidate name candidates and related terms", () => {
    const candidate: CapabilityCandidate = {
      candidateId: "CAND-DB-KNOWLEDGE",
      nameCandidates: ["DB knowledge generation"],
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
      relatedTerms: ["db object", "description source"],
      risks: ["no_external_boundary_found"],
      missingSignals: ["No explicit external DB ownership contract found"],
    };

    const bundle = buildEvidenceBundle(candidate, "test-repo");

    expect(bundle.capabilityHints.nameCandidates).toContain(
      "DB knowledge generation",
    );
    expect(bundle.capabilityHints.relatedTerms).toContain("db object");
    expect(bundle.capabilityHints.relatedTerms).toContain("description source");
  });

  it("limits behavior slices to 12", () => {
    const candidate: CapabilityCandidate = {
      candidateId: "CAND-TEST",
      nameCandidates: ["Test capability"],
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
      behaviorAnchors: Array.from({ length: 20 }, (_, i) => ({
        location: `src/test-${i}.ts`,
        verb: "test",
        object: "data",
      })),
      dataAnchors: [],
      testAnchors: [],
      docAnchors: [],
      moduleClusters: [],
      relatedTerms: [],
      risks: [],
      missingSignals: [],
    };

    const bundle = buildEvidenceBundle(candidate, "test-repo");

    expect(bundle.behaviorSlices.length).toBeLessThanOrEqual(12);
  });

  it("creates no_external_boundary_found negative evidence when no API/event signal", () => {
    const candidate: CapabilityCandidate = {
      candidateId: "CAND-NO-EXTERNAL",
      nameCandidates: ["Internal capability"],
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
      risks: ["no_external_boundary_found"],
      missingSignals: [],
    };

    const bundle = buildEvidenceBundle(candidate, "test-repo");

    expect(
      bundle.negativeEvidence.some((n) => n.kind === "missing_boundary"),
    ).toBe(true);
  });

  it("creates OPEN seed from missing signals", () => {
    const candidate: CapabilityCandidate = {
      candidateId: "CAND-MISSING",
      nameCandidates: ["Missing signals capability"],
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
      missingSignals: ["Cannot determine field description source"],
    };

    const bundle = buildEvidenceBundle(candidate, "test-repo");

    expect(bundle.openQuestions.length).toBeGreaterThan(0);
    expect(bundle.openQuestions[0]?.question).toContain("field description");
  });

  it("produces valid EvidenceBundle", () => {
    const candidate: CapabilityCandidate = {
      candidateId: "CAND-VALID",
      nameCandidates: ["Valid capability"],
      confidence: 0.7,
      confidenceBreakdown: {
        entrySignal: 0.6,
        behaviorSignal: 0.7,
        dataSignal: 0.8,
        testSignal: 0.6,
        docSignal: 0.5,
        graphCohesion: 0.6,
      },
      primaryEntryPoints: [
        {
          kind: "cli",
          location: "src/cli/generate.ts",
          name: "generate",
        },
      ],
      behaviorAnchors: [
        {
          location: "src/gen.ts",
          verb: "generate",
          object: "object",
        },
      ],
      dataAnchors: [
        {
          kind: "schema",
          location: "src/schema.ts",
          name: "Schema",
        },
      ],
      testAnchors: [
        {
          location: "tests/test.ts",
          testName: "test",
        },
      ],
      docAnchors: [],
      moduleClusters: [
        {
          rootPath: "src",
          moduleNames: ["module"],
          cohesionScore: 0.7,
        },
      ],
      relatedTerms: ["term"],
      risks: [],
      missingSignals: [],
    };

    const bundle = buildEvidenceBundle(candidate, "test-repo");

    // 验证生成的 bundle 符合 schema
    const parsed = EvidenceBundleSchema.parse(bundle);
    expect(parsed.bundleId).toBeDefined();
    expect(parsed.candidateId).toBe("CAND-VALID");
  });
});
