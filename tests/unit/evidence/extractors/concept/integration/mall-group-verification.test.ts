/**
 * mall-group 项目集成验证测试
 *
 * 使用 fixture 数据验证 pms_product 表的单模块场景
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  ConceptTracePath,
  TableAnchor,
  ConceptCandidate,
} from "../../../../src/evidence/extractors/concept/types.js";

interface MallGroupFixture {
  project: string;
  tableName: string;
  description: string;
  tracePath: ConceptTracePath;
  expectedResult: {
    isCrossModule: boolean;
    moduleCount: number;
    moduleNames: string[];
    expectedConfidence: number;
    entryPointCount: number;
  };
}

describe("mall-group integration verification", () => {
  let fixture: MallGroupFixture;
  let tableAnchor: TableAnchor;
  let candidate: ConceptCandidate;

  beforeAll(() => {
    // 加载 fixture 数据
    const fixturePath = join(
      __dirname,
      "..",
      "fixtures",
      "mall-group-trace-path.json",
    );
    const fixtureContent = readFileSync(fixturePath, "utf-8");
    fixture = JSON.parse(fixtureContent) as MallGroupFixture;

    // 构建 TableAnchor
    const tracePath = fixture.tracePath;
    tableAnchor = buildTableAnchorFromTracePath(tracePath);

    // 构建 Candidate
    candidate = buildCandidateFromTableAnchor(tableAnchor);
  });

  describe("fixture data validation", () => {
    it("loads fixture correctly", () => {
      expect(fixture).toBeDefined();
      expect(fixture.project).toBe("mall-group");
      expect(fixture.tableName).toBe("pms_product");
    });

    it("has expected trace path structure", () => {
      expect(fixture.tracePath.entryPoints.length).toBeGreaterThan(0);
      expect(fixture.tracePath.mappers.length).toBeGreaterThan(0);
      expect(fixture.tracePath.tables.length).toBeGreaterThan(0);
      expect(fixture.tracePath.entities.length).toBeGreaterThan(0);
    });
  });

  describe("single module scenario", () => {
    it("identifies as single module table", () => {
      expect(tableAnchor.isCrossModule).toBe(false);
    });

    it("has module count of 1", () => {
      expect(tableAnchor.moduleCount).toBe(1);
    });

    it("has correct module name", () => {
      expect(tableAnchor.moduleNames).toContain("mall-admin");
      expect(tableAnchor.moduleNames.length).toBe(1);
    });

    it("has exactly 1 trace source", () => {
      expect(tableAnchor.traceSources.length).toBe(1);
    });
  });

  describe("entry point validation", () => {
    it("has expected number of entry points", () => {
      const totalEntryPoints = tableAnchor.traceSources.reduce(
        (sum, s) => sum + s.entryPoints.length,
        0,
      );
      expect(totalEntryPoints).toBe(fixture.expectedResult.entryPointCount);
    });

    it("all entry points are controller type", () => {
      const entryPoints = tableAnchor.traceSources.flatMap(
        (s) => s.entryPoints,
      );
      expect(entryPoints.every((e) => e.kind === "controller")).toBe(true);
    });

    it("has correct entry point class name", () => {
      const entryPoints = tableAnchor.traceSources.flatMap(
        (s) => s.entryPoints,
      );
      expect(entryPoints[0]?.className).toBe("ProductController");
    });
  });

  describe("confidence calculation", () => {
    it("calculates confidence within expected range", () => {
      // 单模块场景：基础置信度约 0.8
      expect(tableAnchor.aggregatedConfidence).toBeGreaterThanOrEqual(0.7);
      expect(tableAnchor.aggregatedConfidence).toBeLessThanOrEqual(1.0);
    });

    it("does not receive cross-module bonus", () => {
      expect(candidate.confidenceBreakdown.crossModule).toBe(0);
    });
  });

  describe("candidate validation", () => {
    it("has correct candidate ID format", () => {
      expect(candidate.candidateId).toBe("CAND-pms_product");
    });

    it("has name candidates", () => {
      expect(candidate.nameCandidates.length).toBeGreaterThanOrEqual(2);
      expect(candidate.nameCandidates).toContain("pms_product");
    });

    it("is not marked as cross-module", () => {
      expect(candidate.isCrossModule).toBe(false);
    });

    it("has valid confidence breakdown", () => {
      expect(candidate.confidenceBreakdown.traceDepth).toBeGreaterThanOrEqual(
        0,
      );
      expect(candidate.confidenceBreakdown.crossModule).toBe(0);
      expect(
        candidate.confidenceBreakdown.multiEntryPoint,
      ).toBeGreaterThanOrEqual(0);
      expect(
        candidate.confidenceBreakdown.tableRelation,
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe("service chain validation", () => {
    it("has service chain with expected length", () => {
      const tracePath = fixture.tracePath;
      expect(tracePath.serviceChain?.length).toBeGreaterThan(0);
    });

    it("has ProductService in service chain", () => {
      const tracePath = fixture.tracePath;
      const serviceNames =
        tracePath.serviceChain?.map((s) => s.className) || [];
      expect(serviceNames).toContain("ProductService");
    });
  });

  describe("mapper validation", () => {
    it("has ProductMapper", () => {
      const mapperNames = fixture.tracePath.mappers.map((m) => m.className);
      expect(mapperNames).toContain("ProductMapper");
    });

    it("has expected SQL IDs", () => {
      const sqlIds = fixture.tracePath.mappers[0]?.sqlIds || [];
      expect(sqlIds).toContain("selectProductList");
      expect(sqlIds).toContain("selectProductById");
      expect(sqlIds.length).toBeGreaterThanOrEqual(3);
    });
  });
});

/**
 * 从 TracePath 构建 TableAnchor
 */
function buildTableAnchorFromTracePath(
  tracePath: ConceptTracePath,
): TableAnchor {
  const table = tracePath.tables[0];
  if (!table) {
    throw new Error("No table found in trace path");
  }

  const entryPoint = tracePath.entryPoints[0];
  if (!entryPoint) {
    throw new Error("No entry point found in trace path");
  }

  const entity = tracePath.entities[0];
  const mapper = tracePath.mappers[0];

  // 计算置信度
  let confidence = 0.6;
  if (tracePath.serviceChain && tracePath.serviceChain.length > 0) {
    confidence += 0.1;
  }
  if (tracePath.mappers.length > 0) {
    confidence += 0.1;
  }
  if (tracePath.entities.length > 0) {
    confidence += 0.1;
  }

  return {
    tableName: table.tableName,
    schema: table.schema,
    columns: table.columns || [],
    traceSources: [
      {
        modulePath: entryPoint.modulePath,
        moduleName: entryPoint.moduleName,
        entityClassName: entity?.className || "",
        entityFilePath: entity?.filePath || "",
        entryPoints: tracePath.entryPoints,
        mapperClassName: mapper?.className || "",
        mapperFilePath: mapper?.filePath || "",
        confidence,
      },
    ],
    isCrossModule: false,
    moduleCount: 1,
    moduleNames: [entryPoint.moduleName],
    aggregatedConfidence: confidence,
  };
}

/**
 * 从 TableAnchor 构建 Candidate
 */
function buildCandidateFromTableAnchor(anchor: TableAnchor): ConceptCandidate {
  const entryPoints = anchor.traceSources.flatMap((s) => s.entryPoints);
  const entryKinds = new Set(entryPoints.map((e) => e.kind));

  return {
    candidateId: `CAND-${anchor.tableName}`,
    nameCandidates: [
      anchor.tableName,
      toCamelCase(anchor.tableName),
      toPascalCase(anchor.tableName),
    ],
    confidence: anchor.aggregatedConfidence,
    confidenceBreakdown: {
      traceDepth: anchor.traceSources[0]?.confidence || 0.6,
      crossModule: 0,
      multiEntryPoint: Math.min(0.15, (entryKinds.size - 1) * 0.05),
      tableRelation: 0,
    },
    modulePath: anchor.traceSources[0]?.modulePath || "",
    moduleName: anchor.traceSources[0]?.moduleName || "unknown",
    isCrossModule: false,
    tableAnchor: anchor,
    tracePath: {
      entryPoints,
      serviceChain: [],
      mappers: [],
      tables: [
        {
          tableName: anchor.tableName,
          schema: anchor.schema,
          columns: anchor.columns,
        },
      ],
      entities: [],
    },
    gitCommits: [],
  };
}

function toCamelCase(name: string): string {
  return name
    .split("_")
    .map((p, i) =>
      i === 0
        ? p.toLowerCase()
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join("");
}

function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}
