/**
 * Java 代码提取策略
 *
 * 从图节点或 AST 提取 Java 类结构：
 * - 类声明（含 extends/implements）
 * - 字段列表（含类型、修饰符）
 * - 方法签名（不含方法体）
 */

import { SupportedLanguages } from '../../engine/shared/index.js';
import type {
  LanguageExtractorStrategy,
  GraphClassNode,
  GraphPropertyNode,
  GraphMethodNode,
  ExtractedClassCode,
  ExtractedField,
  ExtractedMethod,
} from '../types.js';

/**
 * Java 提取策略
 */
export const javaExtractorStrategy: LanguageExtractorStrategy = {
  language: SupportedLanguages.Java,

  /**
   * 从图节点提取类结构
   */
  extractFromGraphNodes(
    classNode: GraphClassNode,
    properties: GraphPropertyNode[],
    methods: GraphMethodNode[],
  ): ExtractedClassCode | null {
    // 必须有类内容
    if (!classNode.content || classNode.content.length < 10) {
      return null;
    }

    // 提取类声明
    const classDeclaration = extractJavaClassDeclaration(classNode.content);
    const declarationLines = findDeclarationLines(classNode.content);

    // 提取字段
    const fields: ExtractedField[] = properties.map((p) => ({
      name: p.name,
      type: extractFieldTypeFromContent(p.content),
      modifiers: extractModifiersFromContent(p.content),
      line: p.startLine,
      content: p.content ?? '',
    }));

    // 提取方法签名
    const extractedMethods: ExtractedMethod[] = methods.map((m) => ({
      name: m.name,
      returnType: m.returnType,
      parameters: m.parameterCount,
      modifiers: extractModifiersFromContent(m.content),
      signature: extractMethodSignature(m.content ?? ''),
      startLine: m.startLine,
      endLine: m.endLine,
    }));

    // 构建精简片段
    const compactSnippet = buildCompactSnippet(classDeclaration, fields, extractedMethods);

    return {
      className: classNode.name,
      filePath: classNode.filePath,
      startLine: classNode.startLine,
      endLine: classNode.endLine,
      classDeclaration,
      declarationLines,
      fields,
      methods: extractedMethods,
      fullSnippet: classNode.content,
      compactSnippet,
    };
  },

  /**
   * 判断是否需要 Fallback
   */
  needsFallback(classNode: GraphClassNode, properties: GraphPropertyNode[]): boolean {
    // 类内容缺失或过短
    if (!classNode.content || classNode.content.length < 50) {
      return true;
    }
    // 截断标记（超过 5000 字符的大型类）
    if (classNode.content.includes('... [truncated]')) {
      return true;
    }
    // 没有字段信息（可能图解析不完整）
    if (properties.length === 0 && classNode.content.includes('field')) {
      return true;
    }
    return false;
  },
};

/**
 * 提取 Java 类声明（第一行到第一个 {）
 */
function extractJavaClassDeclaration(content: string): string {
  const lines = content.split('\n');
  const declarationLines: string[] = [];

  for (const line of lines) {
    declarationLines.push(line);
    if (line.includes('{')) {
      break;
    }
  }

  return declarationLines.join('\n').trim();
}

/**
 * 找到类声明的行号范围
 */
function findDeclarationLines(content: string): { start: number; end: number } {
  const lines = content.split('\n');
  let start = 1;
  let end = 1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('{')) {
      end = i + 1;
      break;
    }
  }

  return { start, end };
}

/**
 * 从字段内容提取类型
 */
function extractFieldTypeFromContent(content?: string): string | undefined {
  if (!content) return undefined;

  // Java 字段格式: [modifiers] Type name [= value];
  // 尝试匹配类型部分
  const match = content.match(/^\s*(?:public|private|protected|static|final|transient|volatile)?\s+(\w+(?:<[^>]+>)?)\s+\w+/);
  return match ? match[1] : undefined;
}

/**
 * 从内容提取修饰符
 */
function extractModifiersFromContent(content?: string): string[] {
  if (!content) return [];

  const modifiers: string[] = [];
  const modifierKeywords = ['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'volatile', 'transient', 'native', 'strictfp'];

  for (const keyword of modifierKeywords) {
    if (content.includes(keyword)) {
      modifiers.push(keyword);
    }
  }

  return modifiers;
}

/**
 * 从方法内容提取签名（不含方法体）
 */
function extractMethodSignature(content: string): string {
  // 找到方法体的开始（第一个 {）
  const braceIndex = content.indexOf('{');
  if (braceIndex > 0) {
    // 签名部分 + 分号（若方法体被截断）
    return content.slice(0, braceIndex).trim() + ';';
  }
  // 若没有方法体（抽象方法或接口方法），返回完整内容
  return content.trim();
}

/**
 * 构建精简代码片段
 */
function buildCompactSnippet(
  classDeclaration: string,
  fields: ExtractedField[],
  methods: ExtractedMethod[],
): string {
  const lines: string[] = [];

  // 类声明
  lines.push(classDeclaration);
  lines.push('');

  // 字段声明（清理上下文注释，只保留字段定义）
  if (fields.length > 0) {
    for (const field of fields) {
      // 清理字段内容：去掉上下文注释，只保留字段声明行
      const cleanedField = cleanFieldContent(field.content);
      if (cleanedField) {
        lines.push(`  ${cleanedField}`);
      }
    }
    lines.push('');
  }

  // 方法签名（清理多余的 }）
  if (methods.length > 0) {
    for (const method of methods) {
      // 清理方法签名：去掉方法体残留的多余 }
      const cleanedSignature = cleanMethodSignature(method.signature);
      lines.push(`  ${cleanedSignature}`);
    }
  }

  // 类结尾
  lines.push('}');

  return lines.join('\n');
}

/**
 * 清理字段内容：保留字段定义及其紧邻的业务注释
 *
 * 保留规则：
 * 1. 字段定义行 - 修饰符 + 类型 + 名称
 * 2. 紧邻字段上方的 Javadoc 或单行注释
 *
 * 删除规则：
 * 1. 上下文代码 - 前后方法或其他字段
 * 2. 无关的注释 - 与当前字段无关
 */
function cleanFieldContent(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  const cleanedLines: string[] = [];
  const pendingCommentLines: string[] = [];
  let inJavadoc = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 Javadoc 开始
    if (trimmed.startsWith('/**')) {
      inJavadoc = true;
      pendingCommentLines.push(trimmed);
      continue;
    }

    // Javadoc 中间行或结束
    if (inJavadoc) {
      pendingCommentLines.push(trimmed);
      if (trimmed.endsWith('*/')) {
        inJavadoc = false;
      }
      continue;
    }

    // 单行注释（//）
    if (trimmed.startsWith('//')) {
      pendingCommentLines.push(trimmed);
      continue;
    }

    // Java 字段特征：修饰符 + 类型 + 名称
    if (/^(private|protected|public|static|final|transient|volatile)\s+/.test(trimmed)) {
      // 如果有 pendingCommentLines，先添加注释
      if (pendingCommentLines.length > 0) {
        cleanedLines.push(...pendingCommentLines);
        pendingCommentLines.length = 0;
      }
      cleanedLines.push(trimmed);
    } else {
      // 不是字段定义，清除 pendingComment
      pendingCommentLines.length = 0;
      inJavadoc = false;
    }
  }

  return cleanedLines.join('\n');
}

/**
 * 清理方法签名：去掉多余的 }
 */
function cleanMethodSignature(signature: string): string {
  if (!signature) return '';

  // 方法签名应该以 ; 结尾，去掉多余的 }
  let cleaned = signature.trim();

  // 如果末尾有多余的 }，去掉
  while (cleaned.endsWith('}') && !cleaned.includes('{')) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  // 确保以 ; 结尾
  if (!cleaned.endsWith(';')) {
    cleaned = cleaned + ';';
  }

  return cleaned;
}