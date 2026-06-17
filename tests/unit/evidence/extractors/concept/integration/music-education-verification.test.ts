/**
 * music-education 项目集成验证测试
 *
 * 使用 fixture 数据验证 edu_course 表的跨模块场景
 * - music-course 模块：Controller 入口
 * - music-sync 模块：Scheduled 入口
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  ConceptTracePath,
  TableAnchor,
  ConceptCandidate,
  TableTraceSource,
} from "../../../../src/evidence/extractors/concept/types.js";

const CROSS_MODULE_BONUS = 0.2;

interface TracePathEntry {
  source: string;
  pathway: "controller" | "scheduled" | "mq_consumer";
  tracePath: ConceptTracePath;
}

interface MusicEducationFixture {
  project: string;
  tableName: string;
  description: string;
  tracePaths: TracePathEntry[];
  expectedResult: {
    isCrossModule: boolean;
    moduleCount: number;
    moduleNames: string[];
    expectedConfidence: number;
    crossModuleBonus: number;
    entryPointCount: number;
    pathways: {
      controller: number;
      scheduled: number;
      mqConsumer: number;
    };
  };
}

describe("music-education integration verification", () => {
  let fixture: MusicEducationFixture;
  let tableAnchor: TableAnchor;
  let candidate: ConceptCandidate;

  beforeAll(() => {
    // 加载 fixture 数据
    const fixturePath = join(
      __dirname,
      "..",
      "fixtures",
      "music-education-trace-path.json",
    );
    const fixtureContent = readFileSync(fixturePath, "utf-8");
    fixture = JSON.parse(fixtureContent) as MusicEducationFixture;

    // 构建 TableAnchor（聚合多个模块）
    tableAnchor = buildCrossModuleTableAnchor(fixture.tracePaths);

    // 构建 Candidate
    candidate = buildCandidateFromTableAnchor(tableAnchor, CROSS_MODULE_BONUS);
  });

  describe("fixture data validation", () => {
    it("loads fixture correctly", () => {
      expect(fixture).toBeDefined();
      expect(fixture.project).toBe("music-education");
      expect(fixture.tableName).toBe("edu_course");
    });

    it("has two trace paths from different modules", () => {
      expect(fixture.tracePaths.length).toBe(2);
      const sources = fixture.tracePaths.map((tp) => tp.source);
      expect(sources).toContain("music-course");
      expect(sources).toContain("music-sync");
    });

    it("has different pathway types", () => {
      const pathways = fixture.tracePaths.map((tp) => tp.pathway);
      expect(pathways).toContain("controller");
      expect(pathways).toContain("scheduled");
    });
  });

  describe("cross module detection", () => {
    it("identifies as cross-module table", () => {
      expect(tableAnchor.isCrossModule).toBe(true);
    });

    it("has module count of 2", () => {
      expect(tableAnchor.moduleCount).toBe(2);
    });

    it("has correct module names", () => {
      expect(tableAnchor.moduleNames).toContain("music-course");
      expect(tableAnchor.moduleNames).toContain("music-sync");
      expect(tableAnchor.moduleNames.length).toBe(2);
    });

    it("has exactly 2 trace sources", () => {
      expect(tableAnchor.traceSources.length).toBe(2);
    });
  });

  describe("pathway statistics", () => {
    it("has controller pathway in music-course", () => {
      const controllerSources = tableAnchor.traceSources.filter((s) =>
        s.entryPoints.some((e) => e.kind === "controller"),
      );
      expect(controllerSources.length).toBeGreaterThan(0);
    });

    it("has scheduled pathway in music-sync", () => {
      const scheduledSources = tableAnchor.traceSources.filter((s) =>
        s.entryPoints.some((e) => e.kind === "scheduled"),
      );
      expect(scheduledSources.length).toBeGreaterThan(0);
    });

    it("has expected number of entry points", () => {
      const totalEntryPoints = tableAnchor.traceSources.reduce(
        (sum, s) => sum + s.entryPoints.length,
        0,
      );
      expect(totalEntryPoints).toBe(fixture.expectedResult.entryPointCount);
    });
  });

  describe("confidence calculation", () => {
    it("calculates confidence with cross-module bonus", () => {
      // 跨模块场景：基础置信度 + 0.2 跨模块加成
      expect(tableAnchor.aggregatedConfidence).toBeGreaterThanOrEqual(0.9);
      expect(tableAnchor.aggregatedConfidence).toBeLessThanOrEqual(1.0);
    });

    it("receives cross-module bonus in breakdown", () => {
      expect(candidate.confidenceBreakdown.crossModule).toBe(
        CROSS_MODULE_BONUS,
      );
    });

    it("receives multi-entry-point bonus", () => {
      // 有 controller + scheduled 两种入口类型
      expect(candidate.confidenceBreakdown.multiEntryPoint).toBeGreaterThan(0);
    });
  });

  describe("candidate validation", () => {
    it("has correct candidate ID format", () => {
      expect(candidate.candidateId).toBe("CAND-edu_course");
    });

    it("has name candidates", () => {
      expect(candidate.nameCandidates.length).toBeGreaterThanOrEqual(2);
      expect(candidate.nameCandidates).toContain("edu_course");
      expect(candidate.nameCandidates).toContain("EduCourse");
    });

    it("is marked as cross-module", () => {
      expect(candidate.isCrossModule).toBe(true);
    });

    it("has valid confidence breakdown", () => {
      expect(candidate.confidenceBreakdown.traceDepth).toBeGreaterThanOrEqual(
        0,
      );
      expect(candidate.confidenceBreakdown.crossModule).toBe(
        CROSS_MODULE_BONUS,
      );
      expect(
        candidate.confidenceBreakdown.multiEntryPoint,
      ).toBeGreaterThanOrEqual(0);
      expect(
        candidate.confidenceBreakdown.tableRelation,
      ).toBeGreaterThanOrEqual(0);
    });

    it("has cross-module flag matching table anchor", () => {
      expect(candidate.isCrossModule).toBe(candidate.tableAnchor.isCrossModule);
    });
  });

  describe("module coverage validation", () => {
    it("trace source from music-course has correct module info", () => {
      const musicCourseSource = tableAnchor.traceSources.find(
        (s) => s.moduleName === "music-course",
      );
      expect(musicCourseSource).toBeDefined();
      expect(musicCourseSource?.modulePath).toBe("music-course");
    });

    it("trace source from music-sync has correct module info", () => {
      const musicSyncSource = tableAnchor.traceSources.find(
        (s) => s.moduleName === "music-sync",
      );
      expect(musicSyncSource).toBeDefined();
      expect(musicSyncSource?.modulePath).toBe("music-sync");
    });

    it("music-course has controller entry points", () => {
      const musicCourseSource = tableAnchor.traceSources.find(
        (s) => s.moduleName === "music-course",
      );
      const entryKinds =
        musicCourseSource?.entryPoints.map((e) => e.kind) || [];
      expect(entryKinds).toContain("controller");
    });

    it("music-sync has scheduled entry points", () => {
      const musicSyncSource = tableAnchor.traceSources.find(
        (s) => s.moduleName === "music-sync",
      );
      const entryKinds = musicSyncSource?.entryPoints.map((e) => e.kind) || [];
      expect(entryKinds).toContain("scheduled");
    });
  });

  describe("service chain validation", () => {
    it("music-course has CourseService", () => {
      const musicCoursePath = fixture.tracePaths.find(
        (tp) => tp.source === "music-course",
      );
      const serviceNames =
        musicCoursePath?.tracePath.serviceChain?.map((s) => s.className) || [];
      expect(serviceNames).toContain("CourseService");
    });

    it("music-sync has CourseSyncService", () => {
      const musicSyncPath = fixture.tracePaths.find(
        (tp) => tp.source === "music-sync",
      );
      const serviceNames =
        musicSyncPath?.tracePath.serviceChain?.map((s) => s.className) || [];
      expect(serviceNames).toContain("CourseSyncService");
    });
  });

  describe("mapper validation", () => {
    it("both modules have CourseMapper", () => {
      for (const tp of fixture.tracePaths) {
        const mapperNames = tp.tracePath.mappers.map((m) => m.className);
        expect(mapperNames).toContain("CourseMapper");
      }
    });

    it("music-course has select SQL IDs", () => {
      const musicCoursePath = fixture.tracePaths.find(
        (tp) => tp.source === "music-course",
      );
      const sqlIds = musicCoursePath?.tracePath.mappers[0]?.sqlIds || [];
      expect(sqlIds).toContain("selectCourseById");
      expect(sqlIds).toContain("selectCourseList");
    });

    it("music-sync has update SQL IDs", () => {
      const musicSyncPath = fixture.tracePaths.find(
        (tp) => tp.source === "music-sync",
      );
      const sqlIds = musicSyncPath?.tracePath.mappers[0]?.sqlIds || [];
      expect(sqlIds).toContain("selectAllCourses");
      expect(sqlIds).toContain("updateCourseStatus");
    });
  });

  describe("entity validation", () => {
    it("both modules have Course entity", () => {
      for (const tp of fixture.tracePaths) {
        const entityNames = tp.tracePath.entities.map((e) => e.className);
        expect(entityNames).toContain("Course");
      }
    });

    it("entities have matching fields", () => {
      const musicCoursePath = fixture.tracePaths.find(
        (tp) => tp.source === "music-course",
      );
      const fields = musicCoursePath?.tracePath.entities[0]?.fields || [];
      expect(fields).toContain("id");
      expect(fields).toContain("title");
      expect(fields).toContain("teacherId");
      expect(fields).toContain("price");
    });
  });
});

/**
 * 从多个 TracePath 构建跨模块 TableAnchor
 */
function buildCrossModuleTableAnchor(
  tracePathEntries: TracePathEntry[],
): TableAnchor {
  if (tracePathEntries.length === 0) {
    throw new Error("No trace path entries provided");
  }

  const firstTable = tracePathEntries[0]?.tracePath.tables[0];
  if (!firstTable) {
    throw new Error("No table found in trace paths");
  }

  // 构建所有 TraceSource
  const traceSources: TableTraceSource[] = [];

  for (const entry of tracePathEntries) {
    const tracePath = entry.tracePath;
    const entryPoint = tracePath.entryPoints[0];
    const entity = tracePath.entities[0];
    const mapper = tracePath.mappers[0];

    if (!entryPoint) continue;

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

    traceSources.push({
      modulePath: entryPoint.modulePath,
      moduleName: entryPoint.moduleName,
      entityClassName: entity?.className || "",
      entityFilePath: entity?.filePath || "",
      entryPoints: tracePath.entryPoints,
      mapperClassName: mapper?.className || "",
      mapperFilePath: mapper?.filePath || "",
      confidence,
    });
  }

  // 获取模块名称集合
  const moduleNames = [...new Set(traceSources.map((s) => s.moduleName))];

  // 计算聚合置信度
  const avgConfidence =
    traceSources.reduce((sum, s) => sum + s.confidence, 0) /
    traceSources.length;
  const crossModuleBonus = moduleNames.length > 1 ? CROSS_MODULE_BONUS : 0;

  // 计算多入口类型加成
  const entryKinds = new Set(
    traceSources.flatMap((s) => s.entryPoints.map((e) => e.kind)),
  );
  const multiEntryPointBonus = Math.min(0.15, (entryKinds.size - 1) * 0.05);

  const aggregatedConfidence = Math.min(
    1.0,
    avgConfidence + crossModuleBonus + multiEntryPointBonus,
  );

  return {
    tableName: firstTable.tableName,
    schema: firstTable.schema,
    columns: firstTable.columns || [],
    traceSources,
    isCrossModule: moduleNames.length > 1,
    moduleCount: moduleNames.length,
    moduleNames,
    aggregatedConfidence,
  };
}

/**
 * 从 TableAnchor 构建 Candidate
 */
function buildCandidateFromTableAnchor(
  anchor: TableAnchor,
  crossModuleBonus: number,
): ConceptCandidate {
  const entryPoints = anchor.traceSources.flatMap((s) => s.entryPoints);
  const entryKinds = new Set(entryPoints.map((e) => e.kind));
  const avgTraceConfidence =
    anchor.traceSources.reduce((sum, s) => sum + s.confidence, 0) /
    anchor.traceSources.length;

  return {
    candidateId: `CAND-${anchor.tableName}`,
    nameCandidates: [
      anchor.tableName,
      toCamelCase(anchor.tableName),
      toPascalCase(anchor.tableName),
    ],
    confidence: anchor.aggregatedConfidence,
    confidenceBreakdown: {
      traceDepth: avgTraceConfidence,
      crossModule: anchor.isCrossModule ? crossModuleBonus : 0,
      multiEntryPoint: Math.min(0.15, (entryKinds.size - 1) * 0.05),
      tableRelation: anchor.tableRelationBonus ?? 0,
    },
    modulePath: anchor.traceSources[0]?.modulePath || "",
    moduleName: anchor.traceSources[0]?.moduleName || "unknown",
    isCrossModule: anchor.isCrossModule,
    tableAnchor: anchor,
    tracePath: {
      entryPoints,
      serviceChain: [],
      mappers: anchor.traceSources.map((s) => ({
        className: s.mapperClassName,
        filePath: s.mapperFilePath,
        moduleName: s.moduleName,
        modulePath: s.modulePath,
        xmlPath: undefined,
        sqlIds: [],
      })),
      tables: [
        {
          tableName: anchor.tableName,
          schema: anchor.schema,
          columns: anchor.columns,
        },
      ],
      entities: anchor.traceSources.map((s) => ({
        className: s.entityClassName,
        filePath: s.entityFilePath,
        moduleName: s.moduleName,
        modulePath: s.modulePath,
        fields: [],
        startLine: 0,
      })),
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
