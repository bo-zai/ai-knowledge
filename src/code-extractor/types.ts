/**
 * 代码提取器核心类型定义
 *
 * 为知识生成流程提供结构化代码片段，支持从图数据库或文件解析双路径提取。
 */

import type { SupportedLanguages } from "../engine/shared/index.js";

/**
 * 提取的类代码结构
 */
export interface ExtractedClassCode {
  /** 类名 */
  className: string;
  /** 文件路径 */
  filePath: string;
  /** 开始行号 */
  startLine: number;
  /** 结束行号 */
  endLine: number;

  /** 类声明片段（类头部，含 extends/implements） */
  classDeclaration: string;
  /** 类声明行号范围 */
  declarationLines: { start: number; end: number };

  /** 字段列表（含类型、修饰符） */
  fields: ExtractedField[];
  /** 方法签名列表（不含方法体） */
  methods: ExtractedMethod[];

  /** 原始代码片段（完整类代码，用于 LLM 分析） */
  fullSnippet: string;

  /** 精简代码片段（类声明 + 字段 + 方法签名，不含方法体） */
  compactSnippet: string;
}

/**
 * 提取的字段信息
 */
export interface ExtractedField {
  /** 字段名 */
  name: string;
  /** 字段类型 */
  type?: string;
  /** 修饰符列表（public, private, static, final, etc.） */
  modifiers?: string[];
  /** 行号 */
  line: number;
  /** 字段声明原文 */
  content: string;
}

/**
 * 提取的方法信息
 */
export interface ExtractedMethod {
  /** 方法名 */
  name: string;
  /** 返回类型 */
  returnType?: string;
  /** 参数数量 */
  parameters?: number;
  /** 修饰符列表 */
  modifiers?: string[];
  /** 方法签名原文（不含方法体） */
  signature: string;
  /** 开始行号 */
  startLine: number;
  /** 结束行号 */
  endLine?: number;
}

/**
 * 提取选项
 */
export interface ExtractOptions {
  /** 最大代码片段长度（字符），默认 5000 */
  maxSnippetLength?: number;
  /** 是否包含方法体，默认 false */
  includeMethodBody?: boolean;
  /** 是否包含注释，默认 false */
  includeComments?: boolean;
  /** 图数据库路径（优先路径） */
  dbPath?: string;
}

/**
 * 图数据库类节点结构
 */
export interface GraphClassNode {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content?: string;
  description?: string;
}

/**
 * 图数据库 Property 节点结构
 */
export interface GraphPropertyNode {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content?: string;
}

/**
 * 图数据库 Method 节点结构
 */
export interface GraphMethodNode {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content?: string;
  parameterCount?: number;
  returnType?: string;
}

/**
 * 语言提取策略接口
 *
 * 每种语言实现自己的提取策略，支持从图节点或 AST 节点提取类结构。
 */
export interface LanguageExtractorStrategy {
  /** 语言标识 */
  language: SupportedLanguages;

  /**
   * 从图节点提取类结构
   *
   * @param classNode - 类节点
   * @param properties - 字段节点列表
   * @param methods - 方法节点列表
   * @returns 提取的类结构，或 null 表示无法提取
   */
  extractFromGraphNodes(
    classNode: GraphClassNode,
    properties: GraphPropertyNode[],
    methods: GraphMethodNode[],
  ): ExtractedClassCode | null;

  /**
   * 判断是否需要 Fallback 到文件解析
   *
   * @param classNode - 类节点
   * @param properties - 字段节点列表
   * @returns true 表示图数据不完整，需要 Fallback
   */
  needsFallback?(
    classNode: GraphClassNode,
    properties: GraphPropertyNode[],
  ): boolean;
}

/**
 * 批量提取结果
 */
export interface BatchExtractResult {
  /** 成功提取的数量 */
  successCount: number;
  /** 失败的数量 */
  failCount: number;
  /** Fallback 到文件解析的数量 */
  fallbackCount: number;
  /** 提取结果映射 */
  results: Map<string, ExtractedClassCode | null>;
}
