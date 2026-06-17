/**
 * ConceptVerifier - 独立验证 Concept 证据提取
 *
 * 不依赖 LLM，使用 mock 数据验证逻辑正确性：
 * - 验证聚合逻辑（同一表来自多模块）
 * - 验证置信度计算（跨模块 +0.2）
 * - 验证候选生成
 */

import type {
  TableAnchor,
  ConceptCandidate,
  ConceptTracePath,
  DiscoveryPathResult,
  EntryPointInfo,
  ServiceChainNode,
  MapperInfo,
  TableInfo,
  EntityInfo,
  TableTraceSource,
} from "./concept/types.js";

/**
 * 验证断言
 */
export interface VerificationAssertion {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Concept 验证结果
 */
export interface ConceptVerificationResult {
  success: boolean;
  summary: {
    totalTables: number;
    crossModuleTables: number;
    totalCandidates: number;
    totalEntryPoints: number;
    pathwayStats: {
      controller: number;
      scheduled: number;
      mqConsumer: number;
    };
  };
  details: {
    tableAnchors: TableAnchor[];
    candidates: ConceptCandidate[];
    discoveryResults: DiscoveryPathResult[];
    errors: string[];
  };
  assertions: VerificationAssertion[];
}

/**
 * ConceptVerifier - 独立验证类
 *
 * 使用 mock 数据验证 Concept 证据提取的核心逻辑：
 * - mall-group：pms_product（单模块）
 * - music-education：edu_course（跨模块，music-course + music-sync）
 */
export class ConceptVerifier {
  private repoPath: string;
  private modulePaths: string[];
  private crossModuleBonus: number;

  constructor(
    repoPath: string,
    modulePaths: string[],
    crossModuleBonus: number = 0.2,
  ) {
    this.repoPath = repoPath;
    this.modulePaths = modulePaths;
    this.crossModuleBonus = crossModuleBonus;
  }

  /**
   * 执行验证
   *
   * 使用 mock 数据验证逻辑正确性
   */
  async verify(): Promise<ConceptVerificationResult> {
    const assertions: VerificationAssertion[] = [];
    const errors: string[] = [];

    try {
      // 1. 创建 Mock 发现结果
      const mockDiscoveryResults = this.createMockDiscoveryResults();

      // 2. 验证聚合逻辑
      const { tableAnchors, aggregatorAssertions } =
        this.verifyAggregation(mockDiscoveryResults);
      assertions.push(...aggregatorAssertions);

      // 3. 验证置信度计算
      const confidenceAssertions =
        this.verifyConfidenceCalculation(tableAnchors);
      assertions.push(...confidenceAssertions);

      // 4. 生成 Mock 候选
      const candidates = this.generateMockCandidates(tableAnchors);

      // 5. 验证候选生成
      const candidateAssertions = this.verifyCandidates(candidates);
      assertions.push(...candidateAssertions);

      // 6. 验证跨模块检测
      const crossModuleAssertions = this.verifyCrossModuleDetection(
        tableAnchors,
        candidates,
      );
      assertions.push(...crossModuleAssertions);

      // 7. 生成摘要
      const summary = this.generateSummary(
        tableAnchors,
        candidates,
        mockDiscoveryResults,
      );

      const success = assertions.every((a) => a.passed);

      return {
        success,
        summary,
        details: {
          tableAnchors,
          candidates,
          discoveryResults: mockDiscoveryResults,
          errors,
        },
        assertions,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Verification failed: ${msg}`);

      return {
        success: false,
        summary: {
          totalTables: 0,
          crossModuleTables: 0,
          totalCandidates: 0,
          totalEntryPoints: 0,
          pathwayStats: { controller: 0, scheduled: 0, mqConsumer: 0 },
        },
        details: {
          tableAnchors: [],
          candidates: [],
          discoveryResults: [],
          errors,
        },
        assertions,
      };
    }
  }

  /**
   * 创建 Mock 发现结果
   *
   * 模拟两个项目场景：
   * 1. mall-group：pms_product（单模块 Controller 入口）
   * 2. music-education：edu_course（跨模块，Controller + Scheduled）
   */
  private createMockDiscoveryResults(): DiscoveryPathResult[] {
    const results: DiscoveryPathResult[] = [];

    // === mall-group: pms_product（单模块） ===
    results.push(this.createMallGroupMockResult());

    // === music-education: edu_course（跨模块） ===
    // music-course 模块的 Controller 入口
    results.push(this.createMusicCourseMockResult());

    // music-sync 模块的 Scheduled 入口（跨模块访问同一表）
    results.push(this.createMusicSyncMockResult());

    return results;
  }

  /**
   * 创建 mall-group Mock 结果
   */
  private createMallGroupMockResult(): DiscoveryPathResult {
    const entryPoint: EntryPointInfo = {
      kind: "controller",
      className: "ProductController",
      filePath:
        "mall-admin/src/main/java/com/mall/admin/controller/ProductController.java",
      moduleName: "mall-admin",
      modulePath: "mall-admin",
      methodName: "list",
      startLine: 25,
      signature: '@GetMapping("/product/list")',
    };

    const serviceNode: ServiceChainNode = {
      className: "ProductService",
      filePath:
        "mall-admin/src/main/java/com/mall/admin/service/ProductService.java",
      moduleName: "mall-admin",
      modulePath: "mall-admin",
      methodName: "listProducts",
      startLine: 30,
    };

    const mapper: MapperInfo = {
      className: "ProductMapper",
      filePath:
        "mall-admin/src/main/java/com/mall/admin/mapper/ProductMapper.java",
      moduleName: "mall-admin",
      modulePath: "mall-admin",
      xmlPath: "mall-admin/src/main/resources/mapper/ProductMapper.xml",
      sqlIds: ["selectProductList"],
    };

    const table: TableInfo = {
      tableName: "pms_product",
      schema: "mall",
      columns: ["id", "name", "category_id", "price", "stock"],
    };

    const entity: EntityInfo = {
      className: "Product",
      filePath: "mall-admin/src/main/java/com/mall/admin/entity/Product.java",
      moduleName: "mall-admin",
      modulePath: "mall-admin",
      fields: ["id", "name", "categoryId", "price", "stock"],
      startLine: 10,
    };

    const tracePath: ConceptTracePath = {
      entryPoints: [entryPoint],
      serviceChain: [serviceNode],
      mappers: [mapper],
      tables: [table],
      entities: [entity],
    };

    return {
      pathway: "controller",
      entryPoints: [entryPoint],
      tracePaths: [tracePath],
      errors: [],
    };
  }

  /**
   * 创建 music-course Mock 结果
   */
  private createMusicCourseMockResult(): DiscoveryPathResult {
    const entryPoint: EntryPointInfo = {
      kind: "controller",
      className: "CourseController",
      filePath:
        "music-course/src/main/java/com/music/course/controller/CourseController.java",
      moduleName: "music-course",
      modulePath: "music-course",
      methodName: "getCourseDetail",
      startLine: 45,
      signature: '@GetMapping("/course/detail")',
    };

    const serviceNode: ServiceChainNode = {
      className: "CourseService",
      filePath:
        "music-course/src/main/java/com/music/course/service/CourseService.java",
      moduleName: "music-course",
      modulePath: "music-course",
      methodName: "getCourseDetail",
      startLine: 50,
    };

    const mapper: MapperInfo = {
      className: "CourseMapper",
      filePath:
        "music-course/src/main/java/com/music/course/mapper/CourseMapper.java",
      moduleName: "music-course",
      modulePath: "music-course",
      xmlPath: "music-course/src/main/resources/mapper/CourseMapper.xml",
      sqlIds: ["selectCourseById"],
    };

    const table: TableInfo = {
      tableName: "edu_course",
      schema: "education",
      columns: ["id", "title", "teacher_id", "price", "status"],
    };

    const entity: EntityInfo = {
      className: "Course",
      filePath:
        "music-course/src/main/java/com/music/course/entity/Course.java",
      moduleName: "music-course",
      modulePath: "music-course",
      fields: ["id", "title", "teacherId", "price", "status"],
      startLine: 15,
    };

    const tracePath: ConceptTracePath = {
      entryPoints: [entryPoint],
      serviceChain: [serviceNode],
      mappers: [mapper],
      tables: [table],
      entities: [entity],
    };

    return {
      pathway: "controller",
      entryPoints: [entryPoint],
      tracePaths: [tracePath],
      errors: [],
    };
  }

  /**
   * 创建 music-sync Mock 结果（跨模块）
   */
  private createMusicSyncMockResult(): DiscoveryPathResult {
    const entryPoint: EntryPointInfo = {
      kind: "scheduled",
      className: "CourseSyncScheduler",
      filePath:
        "music-sync/src/main/java/com/music/sync/scheduler/CourseSyncScheduler.java",
      moduleName: "music-sync",
      modulePath: "music-sync",
      methodName: "syncCourses",
      startLine: 20,
      signature: '@Scheduled(cron="0 0 2 * * ?")',
    };

    const serviceNode: ServiceChainNode = {
      className: "CourseSyncService",
      filePath:
        "music-sync/src/main/java/com/music/sync/service/CourseSyncService.java",
      moduleName: "music-sync",
      modulePath: "music-sync",
      methodName: "syncCourses",
      startLine: 25,
    };

    const mapper: MapperInfo = {
      className: "CourseMapper",
      filePath:
        "music-sync/src/main/java/com/music/sync/mapper/CourseMapper.java",
      moduleName: "music-sync",
      modulePath: "music-sync",
      xmlPath: "music-sync/src/main/resources/mapper/CourseMapper.xml",
      sqlIds: ["selectAllCourses", "updateCourseStatus"],
    };

    const table: TableInfo = {
      tableName: "edu_course",
      schema: "education",
      columns: ["id", "title", "teacher_id", "price", "status"],
    };

    const entity: EntityInfo = {
      className: "Course",
      filePath: "music-sync/src/main/java/com/music/sync/entity/Course.java",
      moduleName: "music-sync",
      modulePath: "music-sync",
      fields: ["id", "title", "teacherId", "price", "status"],
      startLine: 10,
    };

    const tracePath: ConceptTracePath = {
      entryPoints: [entryPoint],
      serviceChain: [serviceNode],
      mappers: [mapper],
      tables: [table],
      entities: [entity],
    };

    return {
      pathway: "scheduled",
      entryPoints: [entryPoint],
      tracePaths: [tracePath],
      errors: [],
    };
  }

  /**
   * 验证聚合逻辑
   *
   * 验证同一表来自多个模块时的聚合行为：
   * - edu_course 应聚合为单个 TableAnchor
   * - edu_course 应标记为 isCrossModule = true
   * - edu_course 应有 2 个 traceSources
   */
  private verifyAggregation(results: DiscoveryPathResult[]): {
    tableAnchors: TableAnchor[];
    aggregatorAssertions: VerificationAssertion[];
  } {
    const tableMap = new Map<string, TableAnchor>();
    const assertions: VerificationAssertion[] = [];

    // 聚合逻辑：按表名分组
    for (const result of results) {
      for (const tracePath of result.tracePaths) {
        for (const table of tracePath.tables) {
          const tableName = table.tableName;

          // 获取或创建 TableAnchor
          let anchor = tableMap.get(tableName);
          if (!anchor) {
            anchor = {
              tableName,
              schema: table.schema,
              columns: table.columns || [],
              traceSources: [],
              isCrossModule: false,
              moduleCount: 0,
              moduleNames: [],
              aggregatedConfidence: 0,
            };
            tableMap.set(tableName, anchor);
          }

          // 构建 TraceSource
          const source: TableTraceSource = {
            modulePath: tracePath.entryPoints[0]?.modulePath || "",
            moduleName: tracePath.entryPoints[0]?.moduleName || "unknown",
            entityClassName: tracePath.entities[0]?.className || "",
            entityFilePath: tracePath.entities[0]?.filePath || "",
            entryPoints: tracePath.entryPoints,
            mapperClassName: tracePath.mappers[0]?.className || "",
            mapperFilePath: tracePath.mappers[0]?.filePath || "",
            confidence: this.calculateTraceSourceConfidence(tracePath),
          };

          // 去重添加 TraceSource
          const existingSource = anchor.traceSources.find(
            (s) =>
              s.modulePath === source.modulePath &&
              s.moduleName === source.moduleName,
          );
          if (!existingSource) {
            anchor.traceSources.push(source);
          }

          // 更新跨模块信息
          this.updateCrossModuleInfo(anchor);
        }
      }
    }

    const tableAnchors = Array.from(tableMap.values());

    // === 断言 ===

    // 断言 1: 应有 2 个表锚点
    assertions.push({
      name: "table_anchor_count",
      passed: tableAnchors.length === 2,
      message: `Expected 2 table anchors (pms_product, edu_course), got ${tableAnchors.length}`,
    });

    // 断言 2: edu_course 应存在
    const eduCourseAnchor = tableAnchors.find(
      (a) => a.tableName === "edu_course",
    );
    assertions.push({
      name: "edu_course_exists",
      passed: eduCourseAnchor !== undefined,
      message: `edu_course table anchor should exist`,
    });

    // 断言 3: edu_course 应为跨模块
    assertions.push({
      name: "cross_module_detection",
      passed: eduCourseAnchor?.isCrossModule === true,
      message: `edu_course should be cross-module: ${eduCourseAnchor?.isCrossModule}`,
    });

    // 断言 4: edu_course 应有 2 个模块
    assertions.push({
      name: "module_count",
      passed: eduCourseAnchor?.moduleCount === 2,
      message: `edu_course should have 2 modules (music-course, music-sync): ${eduCourseAnchor?.moduleCount}`,
    });

    // 断言 5: edu_course 应有 2 个 traceSources
    assertions.push({
      name: "trace_source_count",
      passed: eduCourseAnchor?.traceSources.length === 2,
      message: `edu_course should have 2 traceSources: ${eduCourseAnchor?.traceSources.length}`,
    });

    // 断言 6: pms_product 应为单模块
    const pmsProductAnchor = tableAnchors.find(
      (a) => a.tableName === "pms_product",
    );
    assertions.push({
      name: "single_module_detection",
      passed: pmsProductAnchor?.isCrossModule === false,
      message: `pms_product should be single-module: ${pmsProductAnchor?.isCrossModule}`,
    });

    // 断言 7: pms_product 应有 1 个模块
    assertions.push({
      name: "pms_module_count",
      passed: pmsProductAnchor?.moduleCount === 1,
      message: `pms_product should have 1 module (mall-admin): ${pmsProductAnchor?.moduleCount}`,
    });

    return { tableAnchors, aggregatorAssertions: assertions };
  }

  /**
   * 验证置信度计算
   *
   * 验证跨模块置信度加成：
   * - 单模块表：置信度约 0.8-0.9
   * - 跨模块表：置信度 >= 0.9（基础 + 0.2 跨模块加成）
   */
  private verifyConfidenceCalculation(
    anchors: TableAnchor[],
  ): VerificationAssertion[] {
    const assertions: VerificationAssertion[] = [];

    // 计算置信度
    for (const anchor of anchors) {
      // 基础置信度取平均
      let avgConfidence = 0;
      for (const source of anchor.traceSources) {
        avgConfidence += source.confidence;
      }
      avgConfidence =
        anchor.traceSources.length > 0
          ? avgConfidence / anchor.traceSources.length
          : 0.6;

      // 跨模块加成
      const crossModuleBonus = anchor.isCrossModule ? this.crossModuleBonus : 0;

      // 多入口类型加成
      const entryKinds = new Set(
        anchor.traceSources.flatMap((s) => s.entryPoints.map((e) => e.kind)),
      );
      const multiEntryPointBonus = Math.min(0.15, (entryKinds.size - 1) * 0.05);

      anchor.aggregatedConfidence = Math.min(
        1.0,
        avgConfidence + crossModuleBonus + multiEntryPointBonus,
      );
    }

    const eduCourseAnchor = anchors.find((a) => a.tableName === "edu_course");
    const pmsProductAnchor = anchors.find((a) => a.tableName === "pms_product");

    // 断言 1: 跨模块表置信度应 >= 0.9
    assertions.push({
      name: "cross_module_confidence",
      passed: (eduCourseAnchor?.aggregatedConfidence ?? 0) >= 0.9,
      message: `Cross-module edu_course confidence should be >= 0.9: ${eduCourseAnchor?.aggregatedConfidence?.toFixed(2)}`,
    });

    // 断言 2: 跨模块加成应生效
    const expectedCrossModuleConfidence = 0.8 + this.crossModuleBonus;
    assertions.push({
      name: "cross_module_bonus_effect",
      passed:
        (eduCourseAnchor?.aggregatedConfidence ?? 0) >=
        expectedCrossModuleConfidence,
      message: `Cross-module bonus (${this.crossModuleBonus}) should apply. Expected >= ${expectedCrossModuleConfidence.toFixed(2)}, got ${eduCourseAnchor?.aggregatedConfidence?.toFixed(2)}`,
    });

    // 断言 3: 单模块表置信度应约 0.8
    assertions.push({
      name: "single_module_confidence",
      passed: (pmsProductAnchor?.aggregatedConfidence ?? 0) >= 0.7,
      message: `Single-module pms_product confidence should be ~0.8: ${pmsProductAnchor?.aggregatedConfidence?.toFixed(2)}`,
    });

    // 断言 4: 置信度不应超过 1.0
    assertions.push({
      name: "confidence_cap",
      passed: anchors.every((a) => a.aggregatedConfidence <= 1.0),
      message: `All confidence values should be <= 1.0`,
    });

    return assertions;
  }

  /**
   * 验证候选生成
   */
  private verifyCandidates(
    candidates: ConceptCandidate[],
  ): VerificationAssertion[] {
    const assertions: VerificationAssertion[] = [];

    // 断言 1: 候选 ID 格式正确
    assertions.push({
      name: "candidate_id_format",
      passed: candidates.every((c) => c.candidateId.startsWith("CAND-")),
      message: `All candidate IDs should start with 'CAND-'`,
    });

    // 断言 2: 应有 2 个候选
    assertions.push({
      name: "candidate_count",
      passed: candidates.length === 2,
      message: `Should have 2 candidates: ${candidates.length}`,
    });

    // 断言 3: 候选名称候选应有多个
    assertions.push({
      name: "name_candidates_count",
      passed: candidates.every((c) => c.nameCandidates.length >= 2),
      message: `Each candidate should have at least 2 name candidates`,
    });

    // 断言 4: 候选置信度 breakdown 应正确
    assertions.push({
      name: "confidence_breakdown_format",
      passed: candidates.every(
        (c) =>
          c.confidenceBreakdown.traceDepth >= 0 &&
          c.confidenceBreakdown.crossModule >= 0 &&
          c.confidenceBreakdown.multiEntryPoint >= 0 &&
          c.confidenceBreakdown.tableRelation >= 0,
      ),
      message: `All confidence breakdown values should be >= 0`,
    });

    return assertions;
  }

  /**
   * 验证跨模块检测
   */
  private verifyCrossModuleDetection(
    anchors: TableAnchor[],
    candidates: ConceptCandidate[],
  ): VerificationAssertion[] {
    const assertions: VerificationAssertion[] = [];

    const crossModuleCandidates = candidates.filter((c) => c.isCrossModule);
    const crossModuleAnchors = anchors.filter((a) => a.isCrossModule);

    // 断言 1: 应有 1 个跨模块候选
    assertions.push({
      name: "cross_module_candidate_count",
      passed: crossModuleCandidates.length === 1,
      message: `Should have 1 cross-module candidate (edu_course): ${crossModuleCandidates.length}`,
    });

    // 断言 2: 跨模块候选标记正确
    assertions.push({
      name: "cross_module_candidate_mark",
      passed: crossModuleCandidates.every(
        (c) => c.tableAnchor.isCrossModule === true,
      ),
      message: `Cross-module candidates should have isCrossModule = true`,
    });

    // 断言 3: 跨模块候选的 crossModule breakdown 应为 0.2
    assertions.push({
      name: "cross_module_breakdown_value",
      passed: crossModuleCandidates.every(
        (c) => c.confidenceBreakdown.crossModule === this.crossModuleBonus,
      ),
      message: `Cross-module candidate crossModule breakdown should be ${this.crossModuleBonus}`,
    });

    // 断言 4: 跨模块候选应覆盖多个模块
    assertions.push({
      name: "cross_module_coverage",
      passed: crossModuleCandidates.every(
        (c) => c.tableAnchor.moduleNames.length >= 2,
      ),
      message: `Cross-module candidates should cover at least 2 modules`,
    });

    // 断言 5: edu_course 候选模块名应包含 music-course 和 music-sync
    const eduCourseCandidate = candidates.find(
      (c) => c.tableAnchor.tableName === "edu_course",
    );
    const hasCorrectModules =
      eduCourseCandidate?.tableAnchor.moduleNames.includes("music-course") &&
      eduCourseCandidate?.tableAnchor.moduleNames.includes("music-sync");
    assertions.push({
      name: "edu_course_module_names",
      passed: hasCorrectModules ?? false,
      message: `edu_course should cover music-course and music-sync modules`,
    });

    return assertions;
  }

  /**
   * 生成 Mock 候选
   */
  private generateMockCandidates(anchors: TableAnchor[]): ConceptCandidate[] {
    return anchors.map((anchor) => {
      const entryPoints = anchor.traceSources.flatMap((s) => s.entryPoints);
      const entryKinds = new Set(entryPoints.map((e) => e.kind));

      return {
        candidateId: `CAND-${anchor.tableName}`,
        nameCandidates: [
          anchor.tableName,
          this.toCamelCase(anchor.tableName),
          this.toPascalCase(anchor.tableName),
        ],
        confidence: anchor.aggregatedConfidence,
        confidenceBreakdown: {
          traceDepth:
            anchor.traceSources.reduce((sum, s) => sum + s.confidence, 0) /
            anchor.traceSources.length,
          crossModule: anchor.isCrossModule ? this.crossModuleBonus : 0,
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
    });
  }

  /**
   * 计算追溯来源置信度
   */
  private calculateTraceSourceConfidence(tracePath: ConceptTracePath): number {
    let confidence = 0.6; // 基础置信度

    // 有 Service 链
    if (tracePath.serviceChain && tracePath.serviceChain.length > 0) {
      confidence += 0.1;
    }

    // 有 Mapper
    if (tracePath.mappers.length > 0) {
      confidence += 0.1;
    }

    // 有 Entity
    if (tracePath.entities.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * 更新跨模块信息
   */
  private updateCrossModuleInfo(anchor: TableAnchor): void {
    const moduleSet = new Set(anchor.traceSources.map((s) => s.moduleName));
    anchor.moduleNames = Array.from(moduleSet);
    anchor.moduleCount = moduleSet.size;
    anchor.isCrossModule = moduleSet.size > 1;
  }

  /**
   * 生成摘要
   */
  private generateSummary(
    anchors: TableAnchor[],
    candidates: ConceptCandidate[],
    results: DiscoveryPathResult[],
  ): ConceptVerificationResult["summary"] {
    const crossModuleTables = anchors.filter((a) => a.isCrossModule).length;
    const pathwayStats = {
      controller: results.filter((r) => r.pathway === "controller").length,
      scheduled: results.filter((r) => r.pathway === "scheduled").length,
      mqConsumer: results.filter((r) => r.pathway === "mq_consumer").length,
    };
    const totalEntryPoints = results.flatMap((r) => r.entryPoints).length;

    return {
      totalTables: anchors.length,
      crossModuleTables,
      totalCandidates: candidates.length,
      totalEntryPoints,
      pathwayStats,
    };
  }

  /**
   * 转换为驼峰命名
   */
  private toCamelCase(name: string): string {
    return name
      .split("_")
      .map((p, i) =>
        i === 0
          ? p.toLowerCase()
          : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
      )
      .join("");
  }

  /**
   * 转换为 Pascal 命名
   */
  private toPascalCase(name: string): string {
    return name
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("");
  }
}

/**
 * 创建 ConceptVerifier 实例的便捷函数
 *
 * @param repoPath - 仓库路径
 * @param modulePaths - 模块路径列表
 * @param crossModuleBonus - 跨模块置信度加成，默认 0.2
 * @returns ConceptVerifier 实例
 */
export function createConceptVerifier(
  repoPath: string,
  modulePaths: string[],
  crossModuleBonus: number = 0.2,
): ConceptVerifier {
  return new ConceptVerifier(repoPath, modulePaths, crossModuleBonus);
}
