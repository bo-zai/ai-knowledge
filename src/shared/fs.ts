import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

export async function appendText(path: string, content: string): Promise<void> {
  await appendFile(path, content, 'utf8');
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export async function removeDir(path: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (!isRetriableRemoveError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(150 * attempt);
    }
  }
}

function isRetriableRemoveError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const withCode = error as Error & { code?: string };
  return withCode.code === 'EBUSY' || withCode.code === 'EPERM' || withCode.code === 'ENOTEMPTY';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从源文件中提取指定类的代码片段
 *
 * 支持语言：Java, TypeScript, Kotlin
 *
 * @param filePath 源文件绝对路径
 * @param className 要提取的类名
 * @param maxLength 最大代码片段长度（默认 500 字符）
 * @returns 类的代码片段，如果无法提取则返回 undefined
 */
export async function extractClassCodeSnippet(
  filePath: string,
  className: string,
  maxLength: number = 500,
): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf8');

    // 根据语言选择匹配模式
    const lang = detectLanguage(filePath);

    // 提取类定义部分
    const classMatch = matchClassDefinition(content, className, lang);
    if (!classMatch) {
      return undefined;
    }

    // 提取字段定义（而非整个类体）
    const fieldsSnippet = extractFieldsFromClass(classMatch, lang, maxLength);
    return fieldsSnippet;
  } catch {
    return undefined;
  }
}

/**
 * 检测文件语言
 */
function detectLanguage(filePath: string): 'java' | 'typescript' | 'kotlin' | 'unknown' {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.java')) return 'java';
  if (ext.endsWith('.ts') || ext.endsWith('.tsx')) return 'typescript';
  if (ext.endsWith('.kt') || ext.endsWith('.kts')) return 'kotlin';
  return 'unknown';
}

/**
 * 匹配类定义部分
 * 返回类体内容（不含类声明头）
 */
function matchClassDefinition(
  content: string,
  className: string,
  lang: string,
): string | undefined {
  // 构建正则表达式匹配类定义
  // Java/Kotlin: class ClassName { ... }
  // TypeScript: class ClassName { ... } 或 export class ClassName { ... }
  const patterns: Record<string, RegExp> = {
    java: new RegExp(`(?:public|private|protected)?\\s*(?:abstract|final)?\\s*class\\s+${className}\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, 's'),
    typescript: new RegExp(`(?:export\\s+)?class\\s+${className}\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, 's'),
    kotlin: new RegExp(`(?:public|private)?\\s*class\\s+${className}\\s*(?:\\([^)]*\\))?\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, 's'),
  };

  const pattern = patterns[lang] || patterns.java;
  const match = content.match(pattern);
  return match ? match[1] : undefined;
}

/**
 * 从类体中提取字段定义
 * 只提取字段声明行，排除方法定义
 */
function extractFieldsFromClass(
  classBody: string,
  lang: string,
  maxLength: number,
): string | undefined {
  // 按行分割
  const lines = classBody.split('\n');

  // 字段声明特征：
  // Java: private/protected/public 类型 字段名;
  // TypeScript: private/protected/public 字段名: 类型;
  // Kotlin: val/var 字段名: 类型
  const fieldPatterns: Record<string, RegExp> = {
    java: /^\s*(?:private|protected|public)?\s+\w+\s+\w+\s*;/,
    typescript: /^\s*(?:private|protected|public)?\s*\w+\s*:\s*\w+/,
    kotlin: /^\s*(?:val|var)\s+\w+\s*:\s*\w+/,
  };

  const pattern = fieldPatterns[lang] || fieldPatterns.java;

  // 过滤出字段声明行
  const fieldLines: string[] = [];
  for (const line of lines) {
    if (pattern.test(line.trim())) {
      fieldLines.push(line.trim());
    }
    // 限制数量
    if (fieldLines.length >= 15) break;
  }

  if (fieldLines.length === 0) {
    // 如果没有找到字段，返回类体的前 N 行
    const snippet = lines.slice(0, 10).join('\n').trim();
    return snippet.length > maxLength ? snippet.slice(0, maxLength) : snippet;
  }

  // 构建代码片段
  const snippet = fieldLines.join('\n');
  return snippet.length > maxLength ? snippet.slice(0, maxLength) : snippet;
}

/**
 * 批量提取类的代码片段
 *
 * @param repoPath 仓库路径
 * @param candidates 候选列表（包含 filePath 和 className）
 * @returns Map<className, codeSnippet>
 */
export async function batchExtractClassSnippets(
  repoPath: string,
  candidates: Array<{ filePath: string; className: string }>,
  maxLength: number = 500,
): Promise<Map<string, string>> {
  const snippets = new Map<string, string>();

  // 并行提取，限制并发
  const batchSize = 10;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (c) => {
        const absolutePath = c.filePath.startsWith('/') ? c.filePath : `${repoPath}/${c.filePath}`;
        const snippet = await extractClassCodeSnippet(absolutePath, c.className, maxLength);
        return { className: c.className, snippet };
      }),
    );

    for (const { className, snippet } of results) {
      if (snippet) {
        snippets.set(className, snippet);
      }
    }
  }

  return snippets;
}
