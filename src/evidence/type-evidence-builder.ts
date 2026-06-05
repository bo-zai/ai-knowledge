import type { KnowledgeType } from '../schemas/knowledge-type.js';
import type { EvidenceBundle } from './evidence-bundle-schema.js';
import type { GraphStatus } from '../query/prepare-generation.js';
import type { GenerateTarget } from '../knowledge/generate-scope.js';
import type { ConceptCandidate, FilteredCandidate, SuspiciousMark } from './concept-filter.js';
import { executeLayer1And2, hardFilterBatch, softMarkBatch } from './concept-filter.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';
import {
  withReadOnlyLbug,
  type ReadOnlyQueryExecutor,
} from '../engine/lbug/read-only-session.js';
import { logger } from '../shared/logger.js';
import { batchExtractClassSnippets } from '../shared/fs.js';

export interface BuildEvidenceInput {
  repoPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  graphStatus: GraphStatus;
}

/**
 * Evidence group for batched LLM generation.
 * Each group contains evidence from the same package/directory.
 */
export interface EvidenceGroup {
  groupId: string;
  packagePath: string;
  bundle: EvidenceBundle;
}

/** Number of times to retry on a BUSY / lock-held error before giving up. */
const LOCK_RETRY_ATTEMPTS = 10;
/** Base back-off in ms between BUSY retries. */
const LOCK_RETRY_DELAY_MS = 1000;

/**
 * Return true when the error message indicates that another process holds
 * an exclusive lock on the LadybugDB file.
 */
function isDbBusyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('busy') ||
    msg.includes('lock') ||
    msg.includes('already in use') ||
    msg.includes('cannot read from file') ||
    msg.includes('access is denied') ||
    msg.includes('another process has locked')
  );
}

/**
 * Build evidence bundles grouped by package path for a knowledge type.
 * Returns multiple groups for parallel LLM generation.
 * Includes retry logic for database lock conflicts on Windows.
 */
export async function buildEvidenceBundlesByPackage(
  input: BuildEvidenceInput,
): Promise<EvidenceGroup[]> {
  const { type, target, repoPath } = input;
  const { lbugPath } = getStoragePaths(repoPath);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      logger.info(`Opening graph for ${type} evidence: ${lbugPath} (attempt ${attempt})`);
      const groups = await withReadOnlyLbug(lbugPath, async query => {
        switch (type) {
          case 'CONCEPT':
            return queryConceptEvidenceByPackage(repoPath, target, query);
          case 'DATA_MODEL':
            return queryDataModelEvidenceByPackage(repoPath, target, query);
          case 'CAPABILITY':
            return queryCapabilityEvidenceByPackage(repoPath, target, query);
          case 'BOUNDARY':
            return queryBoundaryEvidenceByPackage(repoPath, target, query);
          case 'EXTERNAL':
            return queryExternalEvidenceByPackage(repoPath, target, query);
          case 'CONSTRAINT':
            return queryConstraintEvidenceByPackage(repoPath, target, query);
          case 'RELATION':
            return queryRelationEvidenceByPackage(repoPath, target, query);
          case 'WORKFLOW':
            return queryWorkflowEvidenceByPackage(repoPath, target, query);
          default:
            return [];
        }
      });

      logger.info(`Built ${groups.length} evidence groups for ${type}`);
      return groups;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isDbBusyError(error) || attempt === LOCK_RETRY_ATTEMPTS) {
        const msg = lastError.message;
        logger.warn(`Graph query failed for ${type}: ${msg}`);
        return [];
      }

      logger.warn(`Database lock detected for ${type}, retrying (${attempt}/${LOCK_RETRY_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt));
    }
  }

  logger.warn(`Graph query failed for ${type} after ${LOCK_RETRY_ATTEMPTS} retries`);
  return [];
}

/**
 * Legacy single-bundle function for backward compatibility.
 * @deprecated Use buildEvidenceBundlesByPackage instead.
 */
export async function buildMinimalEvidenceBundle(
  input: BuildEvidenceInput,
): Promise<EvidenceBundle> {
  const groups = await buildEvidenceBundlesByPackage(input);

  if (groups.length === 0) {
    return createEmptyBundle(input.type, input.target);
  }

  // Merge all groups into single bundle
  return mergeGroupsToBundle(groups, input.type, input.target);
}

function createEmptyBundle(type: KnowledgeType, target?: GenerateTarget): EvidenceBundle {
  const targetId = target ? `-${target.value.toLowerCase().replace(/\s+/g, '-')}` : '';
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  return {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: 'unknown' },
    confidence: 0.3,
    risks: ['no_evidence_found'],
    capabilityHints: { nameCandidates: target ? [target.value] : [], relatedTerms: [] },
    entryPoints: [],
    behaviorSlices: [],
    dataContracts: [],
    validationAnchors: [],
    moduleSurfaces: [],
    flowTraces: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

function mergeGroupsToBundle(groups: EvidenceGroup[], type: KnowledgeType, target?: GenerateTarget): EvidenceBundle {
  const targetId = target ? `-${target.value.toLowerCase().replace(/\s+/g, '-')}` : '';
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  const merged: EvidenceBundle = {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: groups[0]?.bundle.repoProfile?.name || 'unknown' },
    confidence: Math.max(...groups.map(g => g.bundle.confidence)),
    risks: groups.flatMap(g => g.bundle.risks),
    capabilityHints: {
      nameCandidates: groups.flatMap(g => g.bundle.capabilityHints?.nameCandidates || []),
      relatedTerms: groups.flatMap(g => g.bundle.capabilityHints?.relatedTerms || []),
    },
    entryPoints: groups.flatMap(g => g.bundle.entryPoints || []),
    behaviorSlices: groups.flatMap(g => g.bundle.behaviorSlices || []),
    dataContracts: groups.flatMap(g => g.bundle.dataContracts || []),
    validationAnchors: groups.flatMap(g => g.bundle.validationAnchors || []),
    moduleSurfaces: groups.flatMap(g => g.bundle.moduleSurfaces || []),
    flowTraces: groups.flatMap(g => g.bundle.flowTraces || []),
    docs: groups.flatMap(g => g.bundle.docs || []),
    negativeEvidence: groups.flatMap(g => g.bundle.negativeEvidence || []),
    openQuestions: groups.flatMap(g => g.bundle.openQuestions || []),
  };

  return merged;
}

// ============================================================================
// Package path extraction helper
// ============================================================================

/**
 * Extract package path from file path.
 * Example: src/main/java/com/education/music/app/entity/VO/UserVO.java
 *          → entity/VO
 */
function extractPackagePath(filePath: string): string {
  const parts = filePath.split('/');

  // Find significant directories (exclude src/main/java, test, etc.)
  const significantParts = parts.filter(p =>
    !['src', 'main', 'java', 'test', 'kotlin', 'com', 'org', 'app', 'music', 'education'].includes(p.toLowerCase())
  );

  // Take last 2-3 meaningful directories
  if (significantParts.length >= 2) {
    return significantParts.slice(-2).join('/');
  }
  if (significantParts.length === 1) {
    return significantParts[0];
  }

  // Fallback: use parent directory of file
  return parts.slice(-2, -1).join('/') || 'root';
}

/**
 * Group raw results by package path.
 */
function groupByPackagePath<T extends { filePath: string }>(
  results: T[],
  maxGroupSize: number = 8,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of results) {
    const packagePath = extractPackagePath(row.filePath as string);

    if (!groups.has(packagePath)) {
      groups.set(packagePath, []);
    }

    const group = groups.get(packagePath)!;

    // Split large groups
    if (group.length >= maxGroupSize) {
      const subGroupId = `${packagePath}-${groups.size}`;
      groups.set(subGroupId, [row]);
    } else {
      group.push(row);
    }
  }

  return groups;
}

// ============================================================================
// Per-type evidence queries with grouping
// ============================================================================

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
async function queryConceptEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  // 第一层硬过滤：在 Cypher 查询中排除明显无价值的类
  // 同时提取字段定义作为 codeSnippet，帮助 LLM 判断业务价值
  const candidateCypher = `
    MATCH (c:Class)
    WHERE true ${targetFilter}
    AND NOT c.name =~ '(?i).*(Util|Helper|Common|Base|Abstract|Factory|Builder|Adapter|Wrapper|Proxy)$'
    AND NOT c.name =~ '(?i).*(Application|Main|Bootstrap|Launcher)$'
    AND NOT c.filePath =~ '(?i).*(test|Test|spec|_test).*'
    AND NOT c.filePath =~ '(?i).*(framework|infrastructure|util|common).*'
    AND NOT c.filePath =~ '(?i).*(node_modules|target|build|dist).*'
    OPTIONAL MATCH (c)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WITH c, collect(p.name) as fieldNames
    RETURN c.name as name, c.filePath as filePath, fieldNames as fieldList
    LIMIT 50
  `;
  const candidateResults = await executeQuery(candidateCypher);

  // 转换为候选列表（图谱可能没有字段信息）
  const candidates: ConceptCandidate[] = (candidateResults as Array<{ name: string; filePath: string; fieldList?: string[] }>).map(row => {
    // 检测是否是枚举类（类名包含 Enum 或 Type）
    const isEnum = row.name.includes('Enum') || row.name.endsWith('Type');

    return {
      className: row.name,
      filePath: row.filePath,
      codeSnippet: undefined, // 先设为 undefined，后续通过文件读取填充
      enumValues: isEnum && row.fieldList ? row.fieldList.filter(v => v.length > 0) : undefined,
    };
  });

  logger.info(`CONCEPT: ${candidates.length} candidates before filtering`);

  // 对没有代码片段的候选，通过读取文件填充
  const candidatesWithoutSnippet = candidates.filter(c => !c.codeSnippet);
  if (candidatesWithoutSnippet.length > 0) {
    logger.info(`CONCEPT: Reading files for ${candidatesWithoutSnippet.length} candidates without graph data`);
    const snippets = await batchExtractClassSnippets(
      repoPath,
      candidatesWithoutSnippet.map(c => ({ filePath: c.filePath, className: c.className })),
      500,
    );

    // 将读取到的代码片段填充回候选
    for (const c of candidates) {
      const snippet = snippets.get(c.className);
      if (snippet) {
        c.codeSnippet = snippet;
      }
    }

    // 统计填充结果
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
      // 将软标记、代码片段、枚举值存储在 customData 中，供 LLM 筛选使用
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

/**
 * 按包路径分组（保留软标记信息）
 */
function groupByPackagePathWithMarks<T extends { filePath: string }>(
  results: T[],
  maxGroupSize: number = 8,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of results) {
    const packagePath = extractPackagePath(row.filePath);

    if (!groups.has(packagePath)) {
      groups.set(packagePath, []);
    }

    const group = groups.get(packagePath)!;

    if (group.length >= maxGroupSize) {
      const subGroupId = `${packagePath}-${groups.size}`;
      groups.set(subGroupId, [row]);
    } else {
      group.push(row);
    }
  }

  return groups;
}

/**
 * DATA_MODEL: Query entity classes grouped by package.
 */
async function queryDataModelEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const entityCypher = `
    MATCH (c:Class)-[r:CodeRelation {type: 'CONTAINS'}]->(p:Property)
    WHERE c.name =~ '(?i).*(DO|Entity|Model|VO)$' ${targetFilter}
    RETURN c.name as entityName, c.filePath as filePath, collect(p.name) as fields
    LIMIT 30
  `;
  const entityResults = await executeQuery(entityCypher);

  const packageGroups = groupByPackagePath(
    entityResults as Array<{ entityName: string; filePath: string; fields: string[] }>,
    6,
  );

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const dataContracts: EvidenceBundle['dataContracts'] = rows.map((row, idx) => ({
      ref: `evidence://contract/CON-${String(idx + 1).padStart(3, '0')}`,
      kind: 'schema',
      location: row.filePath,
      name: row.entityName,
      fields: row.fields || [],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-DATA_MODEL-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.75,
        risks: [],
        capabilityHints: {
          nameCandidates: rows.map(r => r.entityName),
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

/**
 * CAPABILITY: Query Controller methods grouped by Controller class.
 * Each Controller is treated as a separate group (one capability domain).
 */
async function queryCapabilityEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND m.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const controllerCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*Controller$'
    MATCH (c)-[r:CodeRelation {type: 'CONTAINS'}]->(m:Method)
    WHERE true ${targetFilter}
    RETURN c.name as className, m.name as methodName, c.filePath as filePath,
           m.returnType as returnType, m.parameterCount as parameterCount, m.startLine as startLine
    ORDER BY c.name, m.name
    LIMIT 60
  `;
  const controllerResults = await executeQuery(controllerCypher);

  // Group by Controller class (each Controller = one capability domain)
  const controllerGroups = new Map<string, Array<{
    className: string;
    methodName: string;
    filePath: string;
    returnType?: string;
    parameterCount?: number;
    startLine: number;
  }>>();

  for (const row of controllerResults) {
    const className = row.className as string;
    if (!controllerGroups.has(className)) {
      controllerGroups.set(className, []);
    }
    controllerGroups.get(className)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [className, methods] of controllerGroups.entries()) {
    // Skip technical controllers
    if (className.toLowerCase().includes('health') || className.toLowerCase().includes('upload')) {
      continue;
    }

    const packagePath = extractPackagePath(methods[0].filePath);
    const groupId = `CAPABILITY-${className}`;
    const bundleId = `BUNDLE-CAPABILITY-${className}`.toUpperCase();

    const entryPoints: EvidenceBundle['entryPoints'] = methods.map((m, idx) => ({
      ref: `evidence://entry/EP-${String(idx + 1).padStart(3, '0')}`,
      kind: 'http',
      location: m.filePath,
      name: `${m.className}.${m.methodName}`,
      signature: m.returnType ? `${m.returnType}(${m.parameterCount || 0} params)` : '',
      startLine: m.startLine,
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CAPABILITY-${className}`,
        repoProfile: { name: repoName },
        confidence: 0.8,
        risks: [],
        capabilityHints: {
          nameCandidates: [className.replace(/Controller$/i, '')],
          relatedTerms: [],
        },
        entryPoints,
        behaviorSlices: [],
        dataContracts: [],
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

/**
 * BOUNDARY: Query config files, grouped by config type for multiple boundary extraction.
 */
async function queryBoundaryEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  // 查询配置文件，按类型分组
  const configCypher = `
    MATCH (f:File) WHERE f.name =~ '(?i).*(config|properties|yaml|yml)$'
    RETURN f.name as name, f.filePath as filePath
    LIMIT 20
  `;
  const configResults = await executeQuery(configCypher);

  if (configResults.length === 0) {
    return [];
  }

  // 按配置类型分组（支付、短信、缓存、数据库等）
  const configTypeKeywords: Record<string, string[]> = {
    '支付': ['pay', 'wxpay', 'alipay', 'payment'],
    '短信': ['sms', 'message', 'notify'],
    '缓存': ['redis', 'cache', 'memcache'],
    '数据库': ['db', 'mysql', 'datasource', 'jdbc'],
    '存储': ['oss', 'storage', 'file', 'upload'],
    '定时任务': ['job', 'schedule', 'quartz', 'task'],
    '安全': ['security', 'auth', 'login', 'token'],
    '通用': ['application', 'config', 'bootstrap'],
  };

  // 为每个配置文件创建独立的 evidence group，帮助 LLM 提取多条边界
  const groups: EvidenceGroup[] = [];
  let groupIdx = 0;

  for (const row of configResults) {
    const filePath = row.filePath as string || '';
    const fileName = row.name as string || '';

    // 确定配置类型
    let configType = '通用';
    for (const [type, keywords] of Object.entries(configTypeKeywords)) {
      if (keywords.some(k => fileName.toLowerCase().includes(k) || filePath.toLowerCase().includes(k))) {
        configType = type;
        break;
      }
    }

    groupIdx++;
    groups.push({
      groupId: `BOUNDARY-${configType}-${groupIdx}`,
      packagePath: `config/${configType}`,
      bundle: {
        bundleId: `BUNDLE-BOUNDARY-${configType}`,
        candidateId: `CAND-BOUNDARY-${groupIdx}`,
        repoProfile: { name: repoName },
        confidence: 0.6,
        risks: ['boundary_requires_manual_review'],
        capabilityHints: { nameCandidates: [], relatedTerms: [configType] },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [{
          ref: `evidence://doc/DOC-${String(groupIdx).padStart(3, '0')}`,
          location: filePath,
          kind: 'docs',
          excerpt: `${configType}配置文件: ${fileName}`,
        }],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}

/**
 * EXTERNAL: Query external dependencies (single group).
 */
async function queryExternalEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const importCypher = `
    MATCH (f:File) WHERE f.content =~ '(?i).*(alipay|wechat|wxpay|oss|sms|okhttp|feign).*'
    RETURN f.name as fileName, f.filePath as filePath
    LIMIT 15
  `;
  const importResults = await executeQuery(importCypher);

  if (importResults.length === 0) {
    return [];
  }

  const behaviorSlices: EvidenceBundle['behaviorSlices'] = importResults.map((row, idx) => ({
    ref: `evidence://behavior/BEH-${String(idx + 1).padStart(3, '0')}`,
    location: row.filePath as string || '',
    verb: 'import',
    object: row.fileName as string,
  }));

  return [{
    groupId: 'EXTERNAL-deps',
    packagePath: 'external',
    bundle: {
      bundleId: 'BUNDLE-EXTERNAL',
      candidateId: 'CAND-EXTERNAL',
      repoProfile: { name: repoName },
      confidence: 0.6,
      risks: [],
      capabilityHints: { nameCandidates: [], relatedTerms: [] },
      entryPoints: [],
      behaviorSlices,
      dataContracts: [],
      validationAnchors: [],
      moduleSurfaces: [],
      flowTraces: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    },
  }];
}

/**
 * CONSTRAINT: Query exceptions and throws grouped by package.
 */
async function queryConstraintEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const exceptionCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*(Exception|Error)$' ${targetFilter}
    RETURN c.name as name, c.filePath as filePath
    LIMIT 20
  `;
  const exceptionResults = await executeQuery(exceptionCypher);

  const throwCypher = `
    MATCH (f:Function) WHERE f.content CONTAINS 'throw'
    RETURN f.name as name, f.filePath as filePath
    LIMIT 15
  `;
  const throwResults = await executeQuery(throwCypher);

  const allResults = [
    ...exceptionResults.map(r => ({ ...r, verb: 'define' })),
    ...throwResults.map(r => ({ ...r, verb: 'throw' })),
  ] as Array<{ name: string; filePath: string; verb: string }>;

  if (allResults.length === 0) {
    return [];
  }

  const packageGroups = groupByPackagePath(allResults, 8);

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `CONSTRAINT-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-CONSTRAINT-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const behaviorSlices: EvidenceBundle['behaviorSlices'] = rows.map((row, idx) => ({
      ref: `evidence://behavior/BEH-${String(idx + 1).padStart(3, '0')}`,
      location: row.filePath,
      verb: row.verb,
      object: row.name,
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CONSTRAINT-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.65,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices,
        dataContracts: [],
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

/**
 * RELATION: Query Service call relations grouped by source Service.
 */
async function queryRelationEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const callCypher = `
    MATCH (s1:Class) WHERE s1.name =~ '(?i).*Service$'
    MATCH (s2:Class) WHERE s2.name =~ '(?i).*Service$' AND s1 <> s2
    MATCH (s1)-[r1:CodeRelation {type: 'CONTAINS'}]->(f1:Function)
    MATCH (f1)-[r2:CodeRelation {type: 'CALLS'}]->(f2:Function)
    MATCH (s2)-[r3:CodeRelation {type: 'CONTAINS'}]->(f2)
    RETURN s1.name as fromService, s2.name as toService,
           f1.name as fromMethod, f2.name as toMethod,
           f1.filePath as filePath
    LIMIT 40
  `;
  const callResults = await executeQuery(callCypher);

  if (callResults.length === 0) {
    return [];
  }

  // Group by source Service
  const serviceGroups = new Map<string, Array<{
    fromService: string;
    toService: string;
    fromMethod: string;
    toMethod: string;
    filePath: string;
  }>>();

  for (const row of callResults) {
    const fromService = row.fromService as string;
    if (!serviceGroups.has(fromService)) {
      serviceGroups.set(fromService, []);
    }
    serviceGroups.get(fromService)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [serviceName, calls] of serviceGroups.entries()) {
    const packagePath = extractPackagePath(calls[0].filePath);
    const groupId = `RELATION-${serviceName}`;
    const bundleId = `BUNDLE-RELATION-${serviceName}`.toUpperCase();

    const flowTraces: EvidenceBundle['flowTraces'] = calls.map((c, idx) => ({
      ref: `evidence://flow/FLOW-${String(idx + 1).padStart(3, '0')}`,
      steps: [
        { action: `${c.fromService}.${c.fromMethod}`, location: c.filePath },
        { action: `${c.toService}.${c.toMethod}` },
      ],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-RELATION-${serviceName}`,
        repoProfile: { name: repoName },
        confidence: 0.7,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces,
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}

/**
 * WORKFLOW: Query Controller->Service chains grouped by Controller.
 */
async function queryWorkflowEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const workflowCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*Controller$'
    MATCH (c)-[r1:CodeRelation {type: 'CONTAINS'}]->(cf:Function)
    MATCH (cf)-[r2:CodeRelation {type: 'CALLS'}]->(sf:Function)
    MATCH (s:Class)-[r3:CodeRelation {type: 'CONTAINS'}]->(sf) WHERE s.name =~ '(?i).*Service$'
    RETURN c.name as controller, s.name as service,
           cf.name as controllerMethod, sf.name as serviceMethod,
           cf.filePath as filePath
    LIMIT 40
  `;
  const workflowResults = await executeQuery(workflowCypher);

  if (workflowResults.length === 0) {
    return [];
  }

  // Group by Controller
  const controllerGroups = new Map<string, Array<{
    controller: string;
    service: string;
    controllerMethod: string;
    serviceMethod: string;
    filePath: string;
  }>>();

  for (const row of workflowResults) {
    const controller = row.controller as string;
    if (!controllerGroups.has(controller)) {
      controllerGroups.set(controller, []);
    }
    controllerGroups.get(controller)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [controllerName, flows] of controllerGroups.entries()) {
    const packagePath = extractPackagePath(flows[0].filePath);
    const groupId = `WORKFLOW-${controllerName}`;
    const bundleId = `BUNDLE-WORKFLOW-${controllerName}`.toUpperCase();

    const flowTraces: EvidenceBundle['flowTraces'] = flows.map((f, idx) => ({
      ref: `evidence://flow/FLOW-${String(idx + 1).padStart(3, '0')}`,
      steps: [
        { action: `${f.controller}.${f.controllerMethod}`, location: f.filePath },
        { action: `${f.service}.${f.serviceMethod}` },
      ],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-WORKFLOW-${controllerName}`,
        repoProfile: { name: repoName },
        confidence: 0.7,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces,
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}
