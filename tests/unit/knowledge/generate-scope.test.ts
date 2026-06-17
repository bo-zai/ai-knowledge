import { describe, expect, it } from "vitest";
import {
  resolveGenerateScope,
  getGenerationOrder,
} from "../../../src/knowledge/generate-scope.js";
import { ALL_KNOWLEDGE_TYPES } from "../../../src/schemas/knowledge-type.js";

describe("resolveGenerateScope", () => {
  it("defaults to all knowledge when no selector is provided", () => {
    const result = resolveGenerateScope({});
    expect(result.knowledge).toBe("all");
    expect(result.inferred).toBe(true);
    expect(result.inferredFrom).toBe("default");
    expect(result.types).toEqual(ALL_KNOWLEDGE_TYPES);
    expect(result.target).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("accepts phase1 knowledge", () => {
    const result = resolveGenerateScope({ knowledge: "phase1" });
    expect(result.knowledge).toBe("phase1");
    expect(result.types).toContain("CONCEPT");
    expect(result.types).toContain("DATA_MODEL");
    expect(result.types).toContain("CAPABILITY");
  });

  it("accepts phase2 knowledge", () => {
    const result = resolveGenerateScope({ knowledge: "phase2" });
    expect(result.knowledge).toBe("phase2");
    expect(result.types).toContain("BOUNDARY");
    expect(result.types).toContain("EXTERNAL");
    expect(result.types).toContain("CONSTRAINT");
    expect(result.types).toContain("RELATION");
    expect(result.types).toContain("WORKFLOW");
  });

  // Test all 8 knowledge types
  for (const type of ALL_KNOWLEDGE_TYPES) {
    it(`accepts ${type.toLowerCase()} knowledge`, () => {
      const result = resolveGenerateScope({ knowledge: type.toLowerCase() });
      expect(result.knowledge).toBe(type);
      expect(result.types).toEqual([type]);
    });
  }

  it("parses typed target", () => {
    const result = resolveGenerateScope({
      knowledge: "concept",
      target: "concept:order-status",
    });
    expect(result.target).toEqual({
      kind: "CONCEPT",
      value: "order-status",
    });
  });

  it("requires typed target for all knowledge", () => {
    expect(() =>
      resolveGenerateScope({ knowledge: "all", target: "users" }),
    ).toThrow("--target must use <type>:<name> format");
  });

  it("allows typed target for all knowledge", () => {
    const result = resolveGenerateScope({
      knowledge: "all",
      target: "concept:order-status",
    });
    expect(result.target).toEqual({
      kind: "CONCEPT",
      value: "order-status",
    });
  });

  it("rejects mismatched target for specific knowledge", () => {
    expect(() =>
      resolveGenerateScope({
        knowledge: "concept",
        target: "capability:order",
      }),
    ).toThrow("is not valid for --knowledge CONCEPT");
  });

  it("rejects invalid knowledge type", () => {
    expect(() => resolveGenerateScope({ knowledge: "invalid" })).toThrow(
      "Invalid --knowledge value: invalid",
    );
  });
});

describe("getGenerationOrder", () => {
  it("returns phases in correct order for all types", () => {
    const phases = getGenerationOrder(ALL_KNOWLEDGE_TYPES);
    expect(phases.length).toBe(4); // concept, data_model, capability, parallel
  });

  it("returns single phase for single type", () => {
    const phases = getGenerationOrder(["CONCEPT"]);
    expect(phases.length).toBe(1);
    expect(phases[0]).toEqual(["CONCEPT"]);
  });

  it("groups parallel types together", () => {
    const phases = getGenerationOrder(["BOUNDARY", "EXTERNAL", "CONSTRAINT"]);
    expect(phases.length).toBe(1);
    expect(phases[0]).toEqual(["BOUNDARY", "EXTERNAL", "CONSTRAINT"]);
  });

  it("maintains phase1 order", () => {
    const phases = getGenerationOrder(["CAPABILITY", "CONCEPT", "DATA_MODEL"]);
    expect(phases.length).toBe(3);
    expect(phases[0]).toEqual(["CONCEPT"]);
    expect(phases[1]).toEqual(["DATA_MODEL"]);
    expect(phases[2]).toEqual(["CAPABILITY"]);
  });
});
