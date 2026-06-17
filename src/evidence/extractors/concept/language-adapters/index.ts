/**
 * 语言适配器索引（概念提取专用）
 *
 * 提供统一的语言适配器工厂函数，用于创建不同语言的适配器实例。
 */

import type { LanguageAdapter } from "../types.js";
import { createJavaAdapter } from "./java-adapter.js";

/**
 * 支持的语言列表
 */
export const SUPPORTED_LANGUAGES = ["java"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * 创建语言适配器
 *
 * @param language - 语言标识（java, typescript, python 等）
 * @returns 语言适配器实例，如果语言不支持则返回 null
 */
export function createLanguageAdapter(
  language: string,
): LanguageAdapter | null {
  const normalizedLanguage = language.toLowerCase();

  switch (normalizedLanguage) {
    case "java":
    case "kotlin": // Kotlin 也使用 Java 适配器
      return createJavaAdapter();

    // 未来扩展：
    // case 'typescript':
    //   return createTypeScriptAdapter();
    // case 'python':
    //   return createPythonAdapter();
    // case 'go':
    //   return createGoAdapter();

    default:
      return null;
  }
}

/**
 * 检查语言是否支持
 *
 * @param language - 语言标识
 * @returns 是否支持该语言
 */
export function isLanguageSupported(language: string): boolean {
  return SUPPORTED_LANGUAGES.includes(
    language.toLowerCase() as SupportedLanguage,
  );
}

/**
 * 获取所有支持的语言列表
 */
export function getSupportedLanguages(): string[] {
  return [...SUPPORTED_LANGUAGES];
}

// 导出适配器创建函数
export { createJavaAdapter } from "./java-adapter.js";
