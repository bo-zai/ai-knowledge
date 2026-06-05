/**
 * 文件解析器（Fallback 路径）
 *
 * 当图数据不完整或被截断时，直接解析文件提取类结构。
 * 使用 Tree-sitter 解析，复用现有的语言提取配置。
 */

import * as fs from 'node:fs/promises';
import { SupportedLanguages, getLanguageFromFilename } from '../engine/shared/index.js';
import { createParserForLanguage } from '../engine/tree-sitter/parser-loader.js';
import type { SyntaxNode } from '../engine/ingestion/utils/ast-helpers.js';
import type {
  ExtractedClassCode,
  ExtractedField,
  ExtractedMethod,
  GraphClassNode,
} from './types.js';

/**
 * 解析文件并提取类结构
 *
 * @param filePath - 文件路径
 * @param className - 类名
 * @param dbPath - 图数据库路径（可选，用于获取行号信息）
 * @returns 提取的类结构，或 null 表示无法提取
 */
export async function parseFileAndExtractClass(
  filePath: string,
  className: string,
  dbPath?: string,
): Promise<ExtractedClassCode | null> {
  const language = getLanguageFromFilename(filePath);
  if (!language) return null;

  // 目前只支持 Java
  if (language !== SupportedLanguages.Java) {
    return null;
  }

  try {
    // 读取文件内容
    const content = await fs.readFile(filePath, 'utf-8');

    // 获取 Tree-sitter 解析器
    const parser = await createParserForLanguage(language, filePath);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    // 查找类声明节点
    const classNode = findClassNode(root, className);
    if (!classNode) return null;

    // 提取类结构
    return extractClassFromAst(classNode, content, filePath, language);
  } catch {
    return null;
  }
}

/**
 * 在 AST 中查找类声明节点
 */
function findClassNode(root: any, className: string): any | null {
  // 递归查找 class_declaration 节点
  const findNode = (node: any): any | null => {
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName?.('name');
      if (nameNode?.text === className) {
        return node;
      }
    }

    // 遍历子节点
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      const result = findNode(child);
      if (result) return result;
    }

    return null;
  };

  return findNode(root);
}

/**
 * 从 AST 节点提取类结构
 */
function extractClassFromAst(
  classNode: any,
  sourceCode: string,
  filePath: string,
  language: SupportedLanguages,
): ExtractedClassCode | null {
  const nameNode = classNode.childForFieldName?.('name');
  const className = nameNode?.text || '';
  if (!className) return null;

  const startLine = classNode.startPosition?.row + 1 || 1;
  const endLine = classNode.endPosition?.row + 1 || 1;

  // 提取类声明（类头部）
  const classDeclaration = extractClassDeclaration(classNode, sourceCode);
  const declarationEndLine = findDeclarationEndLine(classNode);

  // 提取字段和方法
  const fields: ExtractedField[] = [];
  const methods: ExtractedMethod[] = [];

  const bodyNode = classNode.childForFieldName?.('body');
  if (bodyNode) {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const child = bodyNode.namedChild(i);

      if (child.type === 'field_declaration') {
        const field = extractFieldFromAst(child, sourceCode);
        if (field) fields.push(field);
      }

      if (child.type === 'method_declaration') {
        const method = extractMethodFromAst(child, sourceCode);
        if (method) methods.push(method);
      }
    }
  }

  // 构建完整片段和精简片段
  const lines = sourceCode.split('\n');
  const startIdx = Math.max(0, startLine - 3);
  const endIdx = Math.min(lines.length, endLine + 2);
  const fullSnippet = lines.slice(startIdx, endIdx).join('\n');

  const compactSnippet = buildCompactSnippet(classDeclaration, fields, methods);

  return {
    className,
    filePath,
    startLine,
    endLine,
    classDeclaration,
    declarationLines: { start: startLine, end: declarationEndLine },
    fields,
    methods,
    fullSnippet,
    compactSnippet,
  };
}

/**
 * 提取类声明（类头部到第一个 {）
 */
function extractClassDeclaration(classNode: any, sourceCode: string): string {
  const startLine = classNode.startPosition?.row || 0;
  const lines = sourceCode.split('\n');

  // 找到类声明的结束位置（第一个 {）
  const declarationLines: string[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    declarationLines.push(line);
    if (line.includes('{')) {
      break;
    }
  }

  return declarationLines.join('\n').trim();
}

/**
 * 找到类声明的结束行号
 */
function findDeclarationEndLine(classNode: any): number {
  const startLine = classNode.startPosition?.row + 1 || 1;
  const bodyNode = classNode.childForFieldName?.('body');
  if (bodyNode) {
    return bodyNode.startPosition?.row + 1 || startLine;
  }
  return startLine + 1;
}

/**
 * 从 AST 提取字段信息
 */
function extractFieldFromAst(node: any, sourceCode: string): ExtractedField | null {
  const declarator = node.childForFieldName?.('declarator');
  const nameNode = declarator?.childForFieldName?.('name');
  const name = nameNode?.text;
  if (!name) return null;

  const typeNode = node.childForFieldName?.('type');
  const type = typeNode?.text;

  const line = node.startPosition?.row + 1 || 1;
  const startIdx = node.startIndex;
  const endIdx = node.endIndex;
  const content = sourceCode.slice(startIdx, endIdx);

  // 提取修饰符
  const modifiers: string[] = [];
  const modifiersNode = node.children?.find((c: any) => c.type === 'modifiers');
  if (modifiersNode) {
    for (const child of modifiersNode.children || []) {
      if (child.type === 'modifier') {
        modifiers.push(child.text);
      }
    }
  }

  return {
    name,
    type,
    modifiers,
    line,
    content,
  };
}

/**
 * 从 AST 提取方法信息
 */
function extractMethodFromAst(node: any, sourceCode: string): ExtractedMethod | null {
  const nameNode = node.childForFieldName?.('name');
  const name = nameNode?.text;
  if (!name) return null;

  const returnTypeNode = node.childForFieldName?.('type');
  const returnType = returnTypeNode?.text;

  const paramsNode = node.childForFieldName?.('parameters');
  const parameters = paramsNode?.namedChildCount || 0;

  const startLine = node.startPosition?.row + 1 || 1;
  const endLine = node.endPosition?.row + 1 || 1;

  // 提取方法签名（不含方法体）
  const signature = extractMethodSignatureFromAst(node, sourceCode);

  // 提取修饰符
  const modifiers: string[] = [];
  const modifiersNode = node.children?.find((c: any) => c.type === 'modifiers');
  if (modifiersNode) {
    for (const child of modifiersNode.children || []) {
      if (child.type === 'modifier') {
        modifiers.push(child.text);
      }
    }
  }

  return {
    name,
    returnType,
    parameters,
    modifiers,
    signature,
    startLine,
    endLine,
  };
}

/**
 * 从 AST 提取方法签名（不含方法体）
 */
function extractMethodSignatureFromAst(node: any, sourceCode: string): string {
  const startIdx = node.startIndex;
  const bodyNode = node.childForFieldName?.('body');
  const bodyStartIdx = bodyNode?.startIndex || node.endIndex;

  const signatureContent = sourceCode.slice(startIdx, bodyStartIdx).trim();
  return signatureContent + ';';
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

  // 字段声明
  if (fields.length > 0) {
    for (const field of fields) {
      lines.push(`  ${field.content.trim()}`);
    }
    lines.push('');
  }

  // 方法签名
  if (methods.length > 0) {
    for (const method of methods) {
      lines.push(`  ${method.signature}`);
    }
  }

  // 类结尾
  lines.push('}');

  return lines.join('\n');
}

/**
 * 从图节点获取行号，然后从文件提取
 *
 * 当图数据只有行号信息但内容被截断时使用。
 */
export async function extractFromFileWithGraphLines(
  filePath: string,
  classNode: GraphClassNode,
): Promise<ExtractedClassCode | null> {
  const language = getLanguageFromFilename(filePath);
  if (!language || language !== SupportedLanguages.Java) {
    return null;
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // 使用图中的行号范围
    const startIdx = Math.max(0, classNode.startLine - 3);
    const endIdx = Math.min(lines.length, classNode.endLine + 2);
    const fullSnippet = lines.slice(startIdx, endIdx).join('\n');

    // 使用 Tree-sitter 解析提取结构
    const parser = await createParserForLanguage(language, filePath);
    const tree = parser.parse(content);
    const astNode = findClassNode(tree.rootNode, classNode.name);
    if (!astNode) {
      // 无法解析，直接返回行号范围的代码
      return {
        className: classNode.name,
        filePath: classNode.filePath,
        startLine: classNode.startLine,
        endLine: classNode.endLine,
        classDeclaration: lines.slice(startIdx, startIdx + 5).join('\n'),
        declarationLines: { start: classNode.startLine, end: classNode.startLine + 5 },
        fields: [],
        methods: [],
        fullSnippet,
        compactSnippet: fullSnippet.slice(0, 500),
      };
    }

    return extractClassFromAst(astNode, content, filePath, language);
  } catch {
    return null;
  }
}