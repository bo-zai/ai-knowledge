import { logger } from "../../shared/logger.js";
import { extractClassCodes } from "../../code-extractor/index.js";
import { executeLayer1And2, type ConceptCandidate } from "../concept-filter.js";
import type { EvidenceBundle } from "../evidence-bundle-schema.js";
import type { EvidenceGroup } from "../type-evidence-builder.js";
import type { GenerateTarget } from "../../knowledge/generate-scope.js";
import type { ReadOnlyQueryExecutor } from "../../engine/lbug/read-only-session.js";
import { groupByPackagePathWithMarks } from "./shared.js";
import { discoverUniversalExternalRefs } from "./universal-external-ref-discovery.js";
import {
  getLanguageAdapter,
  detectProjectLanguage,
} from "./language-adapters/index.js";

/**
 * CONCEPT: 查询候选类并执行分层过滤
 *
 * 第一层硬过滤在 Cypher 查询中执行：
 * - 排除测试类、工具类、框架层代码、启动类
 * - 不主动匹配 VO/DTO/Config（交给第二层软标记处理）
 *
 * 第二层软标记在查询结果中执行：
 * - 对可疑候选打标记（transmission_class、config_class、simple_enum）
 *
 * 设计原则：
 * - Service 类属于 Capability Directory，不属于 Concept Knowledge，因此不作为候选
 * - 使用通用外部引用发现机制，扫描所有代码文件（不限于特定架构层）
 * - 所有命名模式通过语言适配器配置，确保语言通用性
 */
export async function queryConceptEvidenceByPackage(
  repoPath: string,
  lbugPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : "";
  const repoName = repoPath.split("/").pop() || "unknown";

  // 使用通用语言检测（基于项目配置文件或文件扩展名统计）
  const language = await detectProjectLanguage(repoPath);
  const adapter = getLanguageAdapter(language);
  if (!adapter) {
    logger.warn(`CONCEPT: no adapter for language '${language}'`);
    return [];
  }

  const patterns = adapter.namingPatterns;

  // 构建命名模式的 Cypher 正则
  const entryPointPattern = patterns.entryPointSuffixes
    .map((s) => `${s}$`)
    .join("|");
  const dataModelPattern = patterns.dataModelSuffixes
    .map((s) => `${s}$`)
    .join("|");
  const enumPattern = patterns.enumPatterns.join("|");
  const innerClassCondition = patterns.innerClassSeparator
    ? `c.name CONTAINS '${patterns.innerClassSeparator}'`
    : "";

  // 第一批：业务入口类（Controller/Handler 等）
  const entryPointCypher = `
    MATCH (c:Class)
    WHERE c.name =~ '(?i).*(${entryPointPattern})' ${targetFilter}
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'entry_point' as priority
    LIMIT 20
  `;
  const entryPointResults = await executeQuery(entryPointCypher);

  // 第二批：枚举类（业务状态枚举、类型枚举）
  // 匹配：名称包含枚举模式 或 内部类分隔符（内部枚举）
  const enumConditions = [
    `c.name =~ '(?i).*(${enumPattern}).*'`,
    innerClassCondition,
  ]
    .filter(Boolean)
    .join(" OR ");
  const enumCypher = `
    MATCH (c:Class)
    WHERE (${enumConditions}) ${targetFilter}
    AND NOT c.name =~ '(?i).*(Util|Helper|Common|Base|Abstract)$'
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'enum' as priority
    LIMIT 30
  `;
  const enumResults = await executeQuery(enumCypher);

  // 第三批：数据模型类（Entity/DO/Model 等）
  const dataModelCypher = `
    MATCH (c:Class)
    WHERE c.name =~ '(?i).*(${dataModelPattern})' ${targetFilter}
    AND NOT c.name =~ '(?i).*(Util|Helper|Common|Base|Abstract)$'
    AND NOT c.name =~ '(?i).*(${enumPattern}).*'  // 排除已查询的枚举类
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(framework|infrastructure|util|common).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'data_model' as priority
    LIMIT 15
  `;
  const dataModelResults = await executeQuery(dataModelCypher);

  // 合并候选（去重）
  const candidateMap = new Map<
    string,
    { name: string; filePath: string; fieldList?: string[]; priority: string }
  >();
  for (const row of [
    ...entryPointResults,
    ...enumResults,
    ...dataModelResults,
  ] as Array<{
    name: string;
    filePath: string;
    fieldList?: string[];
    priority: string;
  }>) {
    const key = `${row.filePath}:${row.name}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, row);
    }
  }

  const candidateResults = Array.from(candidateMap.values());

  // 转换为候选列表（图谱可能没有字段信息）
  const candidates: ConceptCandidate[] = (
    candidateResults as Array<{
      name: string;
      filePath: string;
      fieldList?: string[];
    }>
  ).map((row) => {
    // 判断是否是枚举（使用命名模式）
    const isEnum = patterns.enumPatterns.some((p) => row.name.includes(p));

    return {
      className: row.name,
      filePath: row.filePath,
      codeSnippet: undefined,
      enumValues:
        isEnum && row.fieldList
          ? row.fieldList.filter((v) => v.length > 0)
          : undefined,
    };
  });

  logger.info(
    `CONCEPT: ${candidates.length} class candidates before external discovery`,
  );

  // 使用新的代码提取器提取代码片段
  const candidatesWithoutSnippet = candidates.filter((c) => !c.codeSnippet);
  if (candidatesWithoutSnippet.length > 0) {
    logger.info(
      `CONCEPT: Reading files for ${candidatesWithoutSnippet.length} candidates without graph data`,
    );

    const extractResult = await extractClassCodes(
      candidatesWithoutSnippet.map((c) => ({
        filePath: c.filePath,
        className: c.className,
      })),
      { dbPath: lbugPath },
    );

    logger.info(
      `CONCEPT: extraction stats - success: ${extractResult.successCount}, fallback: ${extractResult.fallbackCount}, fail: ${extractResult.failCount}`,
    );

    for (const c of candidates) {
      const key = `${c.filePath}:${c.className}`;
      const extracted = extractResult.results.get(key);
      if (extracted) {
        c.codeSnippet = extracted.compactSnippet;
      }
    }

    const filledCount = candidates.filter((c) => c.codeSnippet).length;
    logger.info(`CONCEPT: ${filledCount} candidates now have code snippets`);
  }

  // 通用外部引用发现：扫描所有代码文件（不限于候选类）
  // 解决核心问题：外部库定义的业务状态枚举无法被图谱发现
  // 通用性：适配任何架构（三层、四层、Clean Architecture 等）
  const externalRefCandidates = await discoverUniversalExternalRefs(
    lbugPath,
    repoPath,
    executeQuery,
    language,
    { maxFiles: 150 }, // 扫描更多文件，确保覆盖外部引用
  );

  if (externalRefCandidates.length > 0) {
    logger.info(
      `CONCEPT: discovered ${externalRefCandidates.length} external enum/constant references`,
    );
    for (const c of externalRefCandidates) {
      logger.debug(
        `ExternalRef: ${c.className} at ${c.filePath}, mark=${c.suspiciousMark}`,
      );
    }
    // 将外部引用候选合并到主候选列表
    candidates.push(...externalRefCandidates);
  }

  logger.info(
    `CONCEPT: total candidates before filtering: ${candidates.length}`,
  );

  // 执行第一、二层过滤
  const filteredCandidates = executeLayer1And2(candidates, repoPath);

  // 统计软标记分布
  const markStats = {
    unmarked: 0,
    transmission_class: 0,
    config_class: 0,
    simple_enum: 0,
    external_enum_usage: 0,
  };
  for (const c of filteredCandidates) {
    if (!c.suspiciousMark) {
      markStats.unmarked++;
    } else {
      markStats[c.suspiciousMark] = (markStats[c.suspiciousMark] || 0) + 1;
    }
  }
  logger.info(
    `CONCEPT: after filtering - ${filteredCandidates.length} candidates`,
  );
  logger.info(
    `CONCEPT: soft marks - unmarked: ${markStats.unmarked}, transmission: ${markStats.transmission_class}, config: ${markStats.config_class}, simple_enum: ${markStats.simple_enum}, external_enum: ${markStats.external_enum_usage}`,
  );

  // 按包路径分组（保留软标记信息）
  const packageGroups = groupByPackagePathWithMarks(filteredCandidates, 8);

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `CONCEPT-${packagePath.replace(/[\/]/g, "-")}`;
    const bundleId =
      `BUNDLE-CONCEPT-${packagePath.replace(/[\/]/g, "-")}`.toUpperCase();

    const dataContracts: EvidenceBundle["dataContracts"] = rows.map(
      (row, idx) => ({
        ref: `evidence://contract/CON-${String(idx + 1).padStart(3, "0")}`,
        kind: "type",
        location: row.filePath,
        name: row.className,
        fields: [],
        customData: {
          suspiciousMark: row.suspiciousMark,
          codeSnippet: row.codeSnippet,
          enumValues: row.enumValues,
        },
      }),
    );

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CONCEPT-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.7,
        risks: [],
        capabilityHints: {
          nameCandidates: rows.map((r) => r.className),
          relatedTerms: [],
        },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts,
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}
