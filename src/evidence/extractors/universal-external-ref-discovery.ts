/**
 * 通用外部引用发现模块
 *
 * 不依赖特定架构或命名模式，扫描所有代码文件发现外部枚举/常量引用。
 *
 * 设计原则：
 * - 通用性：适配任何项目架构（三层、四层、Clean Architecture 等）
 * - 语言无关：通过语言适配器扩展
 * - 不依赖候选列表：独立扫描，不受 LIMIT 限制
 */

import { logger } from '../../shared/logger.js';
import { discoverExternalReferences, type ExternalRefCandidate } from './external-ref-discovery.js';
import { getLanguageAdapter, type LanguageAdapter, type InternalEnum } from './language-adapters/index.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import type { ConceptCandidate, SuspiciousMark } from '../concept-filter.js';

/**
 * 扫描配置
 */
export interface ScanConfig {
  /** 扫描文件类型（语言适配器会进一步过滤） */
  fileExtensions: string[];
  /** 排除目录模式 */
  excludePatterns: RegExp[];
  /** 最大扫描文件数（防止超大项目） */
  maxFiles: number;
}

/**
 * 默认扫描配置
 */
const DEFAULT_SCAN_CONFIG: ScanConfig = {
  fileExtensions: ['.java', '.py', '.go', '.ts', '.tsx', '.js', '.jsx'],
  excludePatterns: [
    /test/i,
    /spec/i,
    /_test/i,
    /__tests__/i,
    /node_modules/i,
    /target/i,
    /build/i,
    /dist/i,
  ],
  maxFiles: 100,
};

/**
 * 通用外部引用发现
 *
 * @param lbugPath - 图谱数据库路径
 * @param repoPath - 项目根路径
 * @param executeQuery - 图谱查询执行器
 * @param language - 语言标识（java/python/go/typescript）
 * @param config - 扫描配置（可选）
 */
export async function discoverUniversalExternalRefs(
  lbugPath: string,
  repoPath: string,
  executeQuery: ReadOnlyQueryExecutor,
  language: string = 'java',
  config: Partial<ScanConfig> = {},
): Promise<ConceptCandidate[]> {
  const scanConfig = { ...DEFAULT_SCAN_CONFIG, ...config };

  // 1. 获取语言适配器
  const adapter = getLanguageAdapter(language);
  if (!adapter) {
    logger.warn(`UniversalExternalRef: no adapter for language '${language}'`);
    return [];
  }

  // 2. 从图谱查询本项目定义的类名集合
  const definedClasses = await queryDefinedClasses(executeQuery);
  logger.info(`UniversalExternalRef: ${definedClasses.size} classes defined in project`);

  // 3. 从图谱查询所有代码文件路径
  const filePaths = await queryAllCodeFiles(executeQuery, scanConfig);
  logger.info(`UniversalExternalRef: ${filePaths.length} files to scan`);

  if (filePaths.length === 0) {
    return [];
  }

  // 4. 批量提取代码内容
  const codeSnippets = await extractCodeContents(filePaths, lbugPath, executeQuery);
  logger.info(`UniversalExternalRef: ${codeSnippets.size} files extracted`);

  // 5. 发现外部引用
  const externalRefs = discoverExternalReferences(codeSnippets, definedClasses, adapter);

  // 5.1 发现内部定义的枚举（通过适配器，确保语言通用性）
  const internalEnums: InternalEnum[] = [];
  if (adapter.discoverInternalEnums) {
    for (const [filePath, code] of codeSnippets) {
      const found = adapter.discoverInternalEnums(code);
      for (const enumInfo of found) {
        // 过滤不值得生成的枚举（通过适配器判断）
        if (adapter.isInternalEnumWorthGenerating?.(enumInfo) ?? enumInfo.values.length >= 3) {
          internalEnums.push({
            ...enumInfo,
            contextSnippet: enumInfo.contextSnippet || code.slice(0, 200),
          });
        }
      }
    }
  }

  // 6. 转换为概念候选格式
  const candidates: ConceptCandidate[] = externalRefs.map(ref => ({
    className: ref.rootSymbol,
    filePath: ref.location,
    codeSnippet: ref.contextSnippet,
    enumValues: undefined,
    suspiciousMark: 'external_enum_usage' as SuspiciousMark,
  }));

  // 6.1 合并内部枚举候选
  for (const internal of internalEnums) {
    candidates.push({
      className: internal.name,
      filePath: '',  // 内部枚举可能跨文件，需要单独处理
      codeSnippet: internal.contextSnippet,
      enumValues: internal.values,
      suspiciousMark: undefined,
    });
  }

  logger.info(`UniversalExternalRef: discovered ${externalRefs.length} external refs + ${internalEnums.length} internal enums`);

  return candidates;
}

/**
 * 从图谱查询所有代码文件路径
 */
async function queryAllCodeFiles(
  executeQuery: ReadOnlyQueryExecutor,
  config: ScanConfig,
): Promise<string[]> {
  // 构建排除路径条件
  const excludeConditions = config.excludePatterns
    .map(p => `NOT c.filePath =~ '(?i).*${p.source}.*'`)
    .join('\n    AND ');

  const cypher = `
    MATCH (c:Class)
    WHERE ${excludeConditions}
    RETURN c.filePath as filePath
    LIMIT ${config.maxFiles}
  `;

  const results = await executeQuery(cypher);
  const filePaths: string[] = [];

  for (const row of results as Array<{ filePath: string }>) {
    filePaths.push(row.filePath);
  }

  return filePaths;
}

/**
 * 批量提取代码内容
 *
 * 使用主流程的 executeQuery（避免数据库连接冲突）
 */
async function extractCodeContents(
  filePaths: string[],
  lbugPath: string,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<Map<string, string>> {
  const codeSnippets = new Map<string, string>();

  if (filePaths.length === 0) {
    return codeSnippets;
  }

  // 1. 直接从图谱查询每个文件的类节点内容（避免单独打开数据库连接）
  // 批量查询（避免太大的查询）
  const batchSize = 50;
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const filePathList = batch.map(fp => `"${fp}"`).join(', ');

    const cypher = `
      MATCH (c:Class)
      WHERE c.filePath IN [${filePathList}]
      RETURN c.filePath as filePath, c.name as name, c.content as content, c.startLine as startLine, c.endLine as endLine
    `;

    const results = await executeQuery(cypher);

    for (const row of results as Array<{ filePath: string; name: string; content?: string; startLine?: number; endLine?: number }>) {
      if (row.content) {
        // 如果已有该文件的代码片段，合并或取较长的
        const existing = codeSnippets.get(row.filePath);
        if (!existing || row.content.length > existing.length) {
          codeSnippets.set(row.filePath, row.content);
        }
      }
    }
  }

  logger.debug(`UniversalExternalRef: extracted ${codeSnippets.size} file contents from graph`);

  return codeSnippets;
}

/**
 * 从图谱查询本项目定义的类名集合
 */
async function queryDefinedClasses(executeQuery: ReadOnlyQueryExecutor): Promise<Set<string>> {
  const cypher = `
    MATCH (c:Class)
    WHERE NOT c.filePath =~ '(?i).*(node_modules|target|build|dist|test|spec).*'
    RETURN c.name as name
  `;

  const results = await executeQuery(cypher);
  const classNames = new Set<string>();

  for (const row of results as Array<{ name: string }>) {
    classNames.add(row.name);
  }

  return classNames;
}