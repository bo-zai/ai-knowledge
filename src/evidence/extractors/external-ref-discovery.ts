/**
 * 外部引用发现模块 - 语言无关核心逻辑
 *
 * 发现代码中引用但不在当前项目定义的枚举/常量/类型。
 * 核心思路：分析点号访问表达式，检查符号是否来自外部包。
 */

import { logger } from "../../shared/logger.js";
import type { LanguageAdapter } from "./language-adapters/index.js";

/**
 * 外部引用候选
 */
export interface ExternalRefCandidate {
  /** 引用表达式（如 OrderStatusEnum.PROCESSING） */
  refExpression: string;
  /** 根符号名（如 OrderStatusEnum） */
  rootSymbol: string;
  /** 引用位置（文件路径:行号） */
  location: string;
  /** 代码片段（包含引用的上下文） */
  contextSnippet: string;
  /** 来源语言 */
  language: string;
}

/**
 * 发现外部引用候选
 *
 * @param codeSnippets - 代码片段列表（文件路径 -> 代码内容）
 * @param definedSymbols - 当前项目定义的符号集合（从图谱获取）
 * @param adapter - 语言适配器
 * @returns 外部引用候选列表
 */
export function discoverExternalReferences(
  codeSnippets: Map<string, string>,
  definedSymbols: Set<string>,
  adapter: LanguageAdapter,
): ExternalRefCandidate[] {
  const candidates: ExternalRefCandidate[] = [];

  for (const [filePath, code] of codeSnippets) {
    // 1. 提取点号访问表达式
    const dotAccesses = adapter.extractDotAccesses(code);

    // 2. 提取外部 import（用于判断是否来自外部包）
    const externalImports = adapter.extractExternalImports(code);

    // 3. 过滤出不在本项目定义的引用
    for (const ref of dotAccesses) {
      const parts = ref.split(".");
      if (parts.length < 2) continue; // 至少两级访问才可能是枚举

      const rootSymbol = parts[0];

      // 检查是否在本项目定义
      if (definedSymbols.has(rootSymbol)) continue;

      // 检查是否可能是业务枚举（而非技术库）
      if (!adapter.isBusinessRef(ref, externalImports)) continue;

      // 提取引用上下文
      const contextSnippet = extractContext(code, ref, 100);

      candidates.push({
        refExpression: ref,
        rootSymbol,
        location: filePath,
        contextSnippet,
        language: adapter.language,
      });
    }
  }

  // 去重（同一符号在多处引用）
  const uniqueCandidates = deduplicateByRootSymbol(candidates);

  logger.info(
    `ExternalRef: discovered ${uniqueCandidates.length} unique external references`,
  );

  return uniqueCandidates;
}

/**
 * 从代码中提取引用上下文
 */
function extractContext(
  code: string,
  ref: string,
  contextLength: number,
): string {
  const refIndex = code.indexOf(ref);
  if (refIndex === -1) return "";

  const start = Math.max(0, refIndex - contextLength);
  const end = Math.min(code.length, refIndex + ref.length + contextLength);

  return code.slice(start, end);
}

/**
 * 按根符号去重
 */
function deduplicateByRootSymbol(
  candidates: ExternalRefCandidate[],
): ExternalRefCandidate[] {
  const seen = new Set<string>();
  const unique: ExternalRefCandidate[] = [];

  for (const c of candidates) {
    if (!seen.has(c.rootSymbol)) {
      seen.add(c.rootSymbol);
      unique.push(c);
    }
  }

  return unique;
}
