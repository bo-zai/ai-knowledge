/**
 * 代码提取器主入口
 *
 * 为知识生成流程提供结构化代码片段，支持从图数据库或文件解析双路径提取。
 *
 * 使用方式：
 *   import { extractClassCode } from './code-extractor/index.js';
 *   const result = await extractClassCode(filePath, className, { dbPath });
 */

import { SupportedLanguages, getLanguageFromFilename } from '../engine/shared/index.js';
import type {
  ExtractedClassCode,
  ExtractOptions,
  LanguageExtractorStrategy,
  BatchExtractResult,
} from './types.js';
import { queryClassNode, queryClassProperties, queryClassMethods, batchQueryGraphData } from './graph-querier.js';
import { javaExtractorStrategy } from './languages/java.js';
import { extractFromFileWithGraphLines } from './file-parser.js';
import lbug from '@ladybugdb/core';
import { openLbugConnection, closeLbugConnection } from '../engine/lbug/lbug-config.js';
import path from 'node:path';

/**
 * 语言策略注册表
 */
const STRATEGY_REGISTRY: Partial<Record<SupportedLanguages, LanguageExtractorStrategy>> = {
  [SupportedLanguages.Java]: javaExtractorStrategy,
  // [SupportedLanguages.TypeScript]: typescriptExtractorStrategy, // 待实现
  // [SupportedLanguages.Python]: pythonExtractorStrategy, // 待实现
};

/**
 * 获取语言提取策略
 *
 * @param language - 语言标识
 * @returns 语言策略，或 undefined 表示未实现
 */
export function getExtractorStrategy(language: SupportedLanguages): LanguageExtractorStrategy | undefined {
  return STRATEGY_REGISTRY[language];
}

/**
 * 提取类代码片段
 *
 * 双路径策略：
 * 1. 优先从图数据库查询 Class + Property + Method 节点
 * 2. 若图数据不完整或被截断，Fallback 到文件解析
 *
 * @param filePath - 文件路径（相对路径，需结合 repoPath）
 * @param className - 类名
 * @param options - 提取选项（需包含 dbPath 和 repoPath）
 * @returns 提取的类结构，或 null 表示无法提取
 */
export async function extractClassCode(
  filePath: string,
  className: string,
  options?: ExtractOptions,
): Promise<ExtractedClassCode | null> {
  const language = getLanguageFromFilename(filePath);
  if (!language) {
    return null;
  }
  const strategy = STRATEGY_REGISTRY[language];

  // 若语言策略未实现，返回 null
  if (!strategy) {
    return null;
  }

  // 若没有图数据库路径，返回 null
  const dbPath = options?.dbPath;
  if (!dbPath) {
    return null;
  }

  // 从图数据库查询
  try {
    const handle = await openLbugConnection(lbug, dbPath);
    try {
      const classNode = await queryClassNode(handle.conn, filePath, className);
      if (!classNode) {
        return null;
      }

      const properties = await queryClassProperties(handle.conn, classNode.id);
      const methods = await queryClassMethods(handle.conn, classNode.id);

      // 判断是否需要 Fallback
      if (strategy.needsFallback?.(classNode, properties)) {
        // Fallback 到文件解析
        // dbPath 格式：repo/.knowledge/lbug，repoPath = dbPath 的父目录的父目录
        const repoPath = path.dirname(path.dirname(dbPath));
        const absoluteFilePath = path.join(repoPath, filePath);
        return extractFromFileWithGraphLines(absoluteFilePath, classNode);
      }

      // 从图节点提取
      return strategy.extractFromGraphNodes(classNode, properties, methods);
    } finally {
      await closeLbugConnection(handle);
    }
  } catch {
    return null;
  }
}

/**
 * 批量提取多个类的代码片段
 *
 * @param candidates - 类候选列表
 * @param options - 提取选项（需包含 dbPath 和 repoPath）
 * @returns 批量提取结果
 */
export async function extractClassCodes(
  candidates: Array<{ filePath: string; className: string }>,
  options?: ExtractOptions,
): Promise<BatchExtractResult> {
  const results = new Map<string, ExtractedClassCode | null>();
  let successCount = 0;
  let failCount = 0;
  let fallbackCount = 0;

  const dbPath = options?.dbPath;
  if (!dbPath || candidates.length === 0) {
    for (const c of candidates) {
      results.set(`${c.filePath}:${c.className}`, null);
      failCount++;
    }
    return { successCount, failCount, fallbackCount, results };
  }

  // 计算 repoPath
  const repoPath = path.dirname(path.dirname(dbPath));

  // 批量查询图数据
  const graphData = await batchQueryGraphData(dbPath, candidates);

  for (const candidate of candidates) {
    const key = `${candidate.filePath}:${candidate.className}`;
    const data = graphData.get(key);

    if (!data) {
      results.set(key, null);
      failCount++;
      continue;
    }

    const language = getLanguageFromFilename(candidate.filePath);
    if (!language) {
      results.set(key, null);
      failCount++;
      continue;
    }
    const strategy = STRATEGY_REGISTRY[language];

    if (!strategy) {
      results.set(key, null);
      failCount++;
      continue;
    }

    // 判断是否需要 Fallback
    if (strategy.needsFallback?.(data.classNode, data.properties)) {
      // Fallback 到文件解析
      const absoluteFilePath = path.join(repoPath, candidate.filePath);
      const extracted = await extractFromFileWithGraphLines(absoluteFilePath, data.classNode);
      if (extracted) {
        results.set(key, extracted);
        fallbackCount++;
      } else {
        results.set(key, null);
        failCount++;
      }
      continue;
    }

    // 从图节点提取
    const extracted = strategy.extractFromGraphNodes(data.classNode, data.properties, data.methods);
    if (extracted) {
      results.set(key, extracted);
      successCount++;
    } else {
      results.set(key, null);
      failCount++;
    }
  }

  return { successCount, failCount, fallbackCount, results };
}

/**
 * 注册语言策略
 *
 * 用于扩展支持的语言。
 *
 * @param strategy - 语言提取策略
 */
export function registerStrategy(strategy: LanguageExtractorStrategy): void {
  STRATEGY_REGISTRY[strategy.language] = strategy;
}