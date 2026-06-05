import { logger } from '../../shared/logger.js';
import { extractClassCodes } from '../../code-extractor/index.js';
import { executeLayer1And2, type ConceptCandidate, type SuspiciousMark } from '../concept-filter.js';
import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath, groupByPackagePathWithMarks } from './shared.js';

/**
 * CONCEPT: Query candidate classes with layered filtering.
 *
 * 第一层硬过滤在 Cypher 查询中执行：
 * - 排除测试类、工具类、框架层代码、启动类
 * - 不主动匹配 VO/DTO/Config（交给第二层软标记处理）
 *
 * 第二层软标记在查询结果中执行：
 * - 对可疑候选打标记（transmission_class、config_class、simple_enum）
 */
export async function queryConceptEvidenceByPackage(
  repoPath: string,
  lbugPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  // 第一批：Controller 类（业务入口）
  const controllerCypher = `
    MATCH (c:Class)
    WHERE c.name =~ '(?i).*Controller$' ${targetFilter}
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'controller' as priority
    LIMIT 20
  `;
  const controllerResults = await executeQuery(controllerCypher);

  // 第二批：Service 类（业务逻辑）
  const serviceCypher = `
    MATCH (c:Class)
    WHERE c.name =~ '(?i).*Service$' ${targetFilter}
    AND NOT c.name =~ '(?i).*(Util|Helper|Common|Base|Abstract)$'
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(framework|infrastructure|util|common).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'service' as priority
    LIMIT 15
  `;
  const serviceResults = await executeQuery(serviceCypher);

  // 第三批：Entity/DO/VO 类（数据模型）
  const entityCypher = `
    MATCH (c:Class)
    WHERE c.name =~ '(?i).*(Entity|DO|VO|DTO|Config|Property)$' ${targetFilter}
    AND NOT c.name =~ '(?i).*(Util|Helper|Common|Base|Abstract)$'
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(framework|infrastructure|util|common).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList, 'entity' as priority
    LIMIT 15
  `;
  const entityResults = await executeQuery(entityCypher);

  // 合并候选（去重）
  const candidateMap = new Map<string, { name: string; filePath: string; fieldList?: string[]; priority: string }>();
  for (const row of [...controllerResults, ...serviceResults, ...entityResults] as Array<{ name: string; filePath: string; fieldList?: string[]; priority: string }>) {
    const key = `${row.filePath}:${row.name}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, row);
    }
  }

  const candidateResults = Array.from(candidateMap.values());

  // 转换为候选列表（图谱可能没有字段信息）
  const candidates: ConceptCandidate[] = (candidateResults as Array<{ name: string; filePath: string; fieldList?: string[] }>).map(row => {
    const isEnum = row.name.includes('Enum') || row.name.endsWith('Type');

    return {
      className: row.name,
      filePath: row.filePath,
      codeSnippet: undefined,
      enumValues: isEnum && row.fieldList ? row.fieldList.filter(v => v.length > 0) : undefined,
    };
  });

  logger.info(`CONCEPT: ${candidates.length} candidates before filtering`);

  // 使用新的代码提取器提取代码片段
  const candidatesWithoutSnippet = candidates.filter(c => !c.codeSnippet);
  if (candidatesWithoutSnippet.length > 0) {
    logger.info(`CONCEPT: Reading files for ${candidatesWithoutSnippet.length} candidates without graph data`);

    const extractResult = await extractClassCodes(
      candidatesWithoutSnippet.map(c => ({ filePath: c.filePath, className: c.className })),
      { dbPath: lbugPath },
    );

    logger.info(`CONCEPT: extraction stats - success: ${extractResult.successCount}, fallback: ${extractResult.fallbackCount}, fail: ${extractResult.failCount}`);

    for (const c of candidates) {
      const key = `${c.filePath}:${c.className}`;
      const extracted = extractResult.results.get(key);
      if (extracted) {
        c.codeSnippet = extracted.compactSnippet;
      }
    }

    const filledCount = candidates.filter(c => c.codeSnippet).length;
    logger.info(`CONCEPT: ${filledCount} candidates now have code snippets`);
  }

  // 执行第一、二层过滤
  const filteredCandidates = executeLayer1And2(candidates, repoPath);

  // 统计软标记分布
  const markStats = {
    unmarked: 0,
    transmission_class: 0,
    config_class: 0,
    simple_enum: 0,
  };
  for (const c of filteredCandidates) {
    if (!c.suspiciousMark) {
      markStats.unmarked++;
    } else {
      markStats[c.suspiciousMark]++;
    }
  }
  logger.info(`CONCEPT: after filtering - ${filteredCandidates.length} candidates`);
  logger.info(`CONCEPT: soft marks - unmarked: ${markStats.unmarked}, transmission: ${markStats.transmission_class}, config: ${markStats.config_class}, simple_enum: ${markStats.simple_enum}`);

  // 按包路径分组（保留软标记信息）
  const packageGroups = groupByPackagePathWithMarks(filteredCandidates, 8);

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `CONCEPT-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-CONCEPT-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const dataContracts: EvidenceBundle['dataContracts'] = rows.map((row, idx) => ({
      ref: `evidence://contract/CON-${String(idx + 1).padStart(3, '0')}`,
      kind: 'type',
      location: row.filePath,
      name: row.className,
      fields: [],
      customData: {
        suspiciousMark: row.suspiciousMark,
        codeSnippet: row.codeSnippet,
        enumValues: row.enumValues,
      },
    }));

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
          nameCandidates: rows.map(r => r.className),
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