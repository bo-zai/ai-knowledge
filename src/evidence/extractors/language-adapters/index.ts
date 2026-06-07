/**
 * 语言适配器索引
 *
 * 提供统一的语言适配器注册和获取机制。
 * 新增语言只需实现 LanguageAdapter 接口并注册。
 */

import { javaAdapter } from './java-adapter.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 内部枚举信息
 */
export interface InternalEnum {
  /** 枚举名称 */
  name: string;
  /** 枚举值列表 */
  values: string[];
  /** 代码上下文 */
  contextSnippet: string;
}

/**
 * 命名模式配置
 *
 * 用于概念候选查询和架构证据收集的命名约定
 * 不同语言和框架有不同的命名约定
 */
export interface NamingPatterns {
  /** 业务入口类后缀（如 Java 的 Controller，Python 的 View/Handler） */
  entryPointSuffixes: string[];
  /** 数据模型类后缀（如 Java 的 Entity/DO，Python 的 Model） */
  dataModelSuffixes: string[];
  /** 枚举类命名模式（如 Java 的 Enum 后缀，Python 的 Enum 类） */
  enumPatterns: string[];
  /** 内部类分隔符（如 Java 的 $，Python 的无分隔符） */
  innerClassSeparator?: string;
  /** 传输类后缀（用于软标记） */
  transmissionSuffixes: string[];
  /** 配置类后缀（用于软标记） */
  configSuffixes: string[];
  /** 后端分层目录名（用于架构证据收集） */
  layerNames?: string[];
  /** 前端组件目录名（用于架构证据收集） */
  componentDirs?: string[];
  /** CLI 命令目录名（用于架构证据收集） */
  commandDirs?: string[];
  /** 库 API 目录名（用于架构证据收集） */
  apiDirs?: string[];
  /** 前端路由文件候选路径（用于架构证据收集） */
  routingFiles?: string[];
  /** 前端状态管理目录候选路径（用于架构证据收集） */
  stateDirs?: string[];
  /** 导出文件候选路径（用于架构证据收集） */
  exportFiles?: string[];
}

/**
 * 语言适配器接口
 *
 * 定义语言特定的解析规则，用于发现外部枚举/常量引用和内部枚举定义。
 * 所有语言特定逻辑必须通过此接口实现，确保通用性。
 */
export interface LanguageAdapter {
  /** 语言标识 */
  language: string;

  /** 命名模式配置 */
  namingPatterns: NamingPatterns;

  /** 从代码片段提取点号访问表达式（外部引用发现） */
  extractDotAccesses(codeSnippet: string): string[];

  /** 从代码片段提取 import 语句中的外部包路径 */
  extractExternalImports(codeSnippet: string): string[];

  /** 判断引用是否可能是业务枚举/常量（排除技术库） */
  isBusinessRef(refExpression: string, externalImports: string[]): boolean;

  /** 发现内部定义的枚举（可选，按语言实现） */
  discoverInternalEnums?(codeSnippet: string): InternalEnum[];

  /** 判断内部枚举是否值得生成知识（可选） */
  isInternalEnumWorthGenerating?(enumInfo: InternalEnum): boolean;
}

/**
 * 已注册的语言适配器映射
 */
const adapters: Map<string, LanguageAdapter> = new Map([
  ['java', javaAdapter],
  // 未来扩展：
  // ['python', pythonAdapter],
  // ['typescript', typescriptAdapter],
  // ['go', goAdapter],
]);

/**
 * 获取语言适配器
 *
 * @param language - 语言标识（java/python/typescript/go）
 * @returns 语言适配器，如果未注册则返回 null
 */
export function getLanguageAdapter(language: string): LanguageAdapter | null {
  return adapters.get(language.toLowerCase()) ?? null;
}

/**
 * 注册新的语言适配器
 */
export function registerLanguageAdapter(adapter: LanguageAdapter): void {
  adapters.set(adapter.language.toLowerCase(), adapter);
}

/**
 * 获取所有已注册的语言
 */
export function getSupportedLanguages(): string[] {
  return Array.from(adapters.keys());
}

/**
 * 项目配置文件与语言映射
 */
const PROJECT_CONFIG_TO_LANGUAGE: Record<string, string> = {
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'package.json': 'javascript',  // 需进一步检测 TypeScript
  'go.mod': 'go',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  'Cargo.toml': 'rust',
};

/**
 * 文件扩展名与语言映射
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.java': 'java',
  '.kt': 'java',  // Kotlin 也使用 Java 适配器（可扩展）
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.go': 'go',
  '.py': 'python',
  '.rs': 'rust',
};

/**
 * 检测项目语言
 *
 * 策略：
 * 1. 优先检查项目配置文件（pom.xml、package.json、go.mod 等）
 * 2. 如果没有配置文件，统计源文件扩展名确定
 *
 * @param repoPath - 项目根路径
 * @returns 语言标识（java/javascript/typescript/go/python）
 */
export async function detectProjectLanguage(repoPath: string): Promise<string> {
  // 1. 检查项目配置文件
  for (const [configFile, language] of Object.entries(PROJECT_CONFIG_TO_LANGUAGE)) {
    try {
      await fs.access(path.join(repoPath, configFile));
      // TypeScript 特殊处理：检查 tsconfig.json
      if (language === 'javascript') {
        try {
          await fs.access(path.join(repoPath, 'tsconfig.json'));
          return 'typescript';
        } catch {
          // 没有 tsconfig.json，可能是纯 JavaScript
        }
      }
      return language;
    } catch {
      // 配置文件不存在
    }
  }

  // 2. 统计源文件扩展名
  const extensionCounts = await countFileExtensions(repoPath);

  // 找出最多的扩展名
  let maxCount = 0;
  let detectedLanguage = 'java';  // 默认 Java（兼容现有逻辑）

  for (const [ext, count] of Object.entries(extensionCounts)) {
    if (count > maxCount && EXTENSION_TO_LANGUAGE[ext]) {
      maxCount = count;
      detectedLanguage = EXTENSION_TO_LANGUAGE[ext];
    }
  }

  return detectedLanguage;
}

/**
 * 统计项目源文件扩展名
 *
 * @param repoPath - 项目根路径
 * @returns 扩展名计数映射
 */
async function countFileExtensions(repoPath: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const excludeDirs = ['node_modules', 'target', 'build', 'dist', '.git', '.idea', '.vscode'];

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (EXTENSION_TO_LANGUAGE[ext]) {
            counts.set(ext, (counts.get(ext) || 0) + 1);
          }
        }
      }
    } catch {
      // 目录读取失败
    }
  }

  // 先检查 src 目录
  const srcPath = path.join(repoPath, 'src');
  try {
    await fs.access(srcPath);
    await walk(srcPath);
  } catch {
    // src 不存在，检查根目录
    await walk(repoPath);
  }

  return counts;
}