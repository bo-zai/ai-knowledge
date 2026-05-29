/**
 * Mapper Caller Evidence Resolver
 *
 * Resolves Java callers of MyBatis mapper methods.
 * Finds Service/Controller classes that invoke mapper methods.
 */

import fs from 'fs/promises';
import path from 'path';
import type { CallerEvidence } from './types.js';

/**
 * Resolve caller evidence for a mapper method.
 */
export async function resolveCallerEvidence(args: {
  repoPath: string;
  namespace: string;
  methodId: string;
}): Promise<CallerEvidence[]> {
  const { repoPath, namespace, methodId } = args;

  // Extract mapper class name from namespace
  const mapperClass = namespace.split('.').pop() || namespace;

  // Find Java files that import and use this mapper
  const callers = await findMapperCallers(repoPath, mapperClass, methodId);

  return callers;
}

/**
 * Collect all possible mapper receiver names from Java content.
 */
function collectMapperReceivers(content: string, mapperClass: string): string[] {
  const receivers = new Set<string>([toCamelCase(mapperClass), mapperClass]);
  const escapedMapperClass = escapeRegExp(mapperClass);

  // 字段声明: private QuestionMapper mapper; 或 private QuestionMapper questionMapper;
  const fieldRegex = new RegExp(`\\b${escapedMapperClass}\\s+(\\w+)\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(content)) !== null) {
    if (match[1]) {
      receivers.add(match[1]);
    }
  }

  // 构造器/方法参数: public void run(QuestionMapper mapper) 或 public Service(QuestionMapper questionMapper)
  const paramRegex = new RegExp(`\\(${escapedMapperClass}\\s+(\\w+)\\b`, 'g');
  while ((match = paramRegex.exec(content)) !== null) {
    if (match[1]) {
      receivers.add(match[1]);
    }
  }

  return [...receivers];
}

/**
 * Build a precise call matcher that only matches known receivers.
 */
function buildPreciseCallMatcher(receivers: string[], methodId: string): RegExp | null {
  if (receivers.length === 0) {
    return null;
  }

  const receiverPattern = receivers
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join('|');
  const escapedMethodId = escapeRegExp(methodId);

  return new RegExp(
    `(^|[^\\w])(?:${receiverPattern})\\s*\\.\\s*${escapedMethodId}\\s*\\(`,
    'm',
  );
}

/**
 * Find Java files that call a specific mapper method.
 */
async function findMapperCallers(
  repoPath: string,
  mapperClass: string,
  methodId: string
): Promise<CallerEvidence[]> {
  const callers: CallerEvidence[] = [];

  // Search for Java files that import the mapper
  const javaFiles = await findJavaFilesImportingMapper(repoPath, mapperClass);

  for (const javaFile of javaFiles) {
    const content = await fs.readFile(javaFile, 'utf-8');

    // Check if this file calls the specific method
    if (callsMapperMethod(content, mapperClass, methodId)) {
      const evidence = extractCallerEvidence(content, javaFile, mapperClass, methodId);
      if (evidence) {
        callers.push(evidence);
      }
    }
  }

  return callers;
}

/**
 * Find Java files that import a specific mapper.
 */
async function findJavaFilesImportingMapper(repoPath: string, mapperClass: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const { glob } = await import('glob');

    // Search for Java files
    const pattern = '**/*.java';
    const matches = await glob(pattern, {
      cwd: repoPath,
      absolute: true,
      ignore: ['node_modules/**', '.git/**', 'target/**', 'build/**'],
    });

    for (const file of matches) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        // Check if imports the mapper
        if (content.includes(`import`) && content.includes(mapperClass)) {
          files.push(file);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // glob not available
  }

  return files;
}

/**
 * Check if content calls a specific mapper method.
 */
function callsMapperMethod(content: string, mapperClass: string, methodId: string): boolean {
  // 收集可能的 mapper receiver 名称
  const receivers = collectMapperReceivers(content, mapperClass);

  // 构建精确匹配器
  const preciseMatcher = buildPreciseCallMatcher(receivers, methodId);
  if (preciseMatcher && preciseMatcher.test(content)) {
    return true;
  }

  // Fallback: 检查是否存在 mapper 类名静态调用
  const escapedMapperClass = escapeRegExp(mapperClass);
  const escapedMethodId = escapeRegExp(methodId);
  const staticCallRegex = new RegExp(`\\b${escapedMapperClass}\\s*\\.\\s*${escapedMethodId}\\s*\\(`);
  if (staticCallRegex.test(content)) {
    return true;
  }

  return false;
}

/**
 * Extract caller evidence from a Java file.
 */
function extractCallerEvidence(
  content: string,
  filePath: string,
  mapperClass: string,
  methodId: string
): CallerEvidence | null {
  // Extract class name
  const classMatch = content.match(/public\s+class\s+(\w+)/);
  const callerClass = classMatch ? classMatch[1] : path.basename(filePath, '.java');

  // Extract package
  const packageMatch = content.match(/package\s+([\w.]+)/);
  const packageName = packageMatch ? packageMatch[1] : '';

  const callSite = findCallSite(content, mapperClass, methodId);

  // Find method that contains the call
  const callerMethod = findCallingMethod(content, callSite?.index ?? -1);

  // Extract nearby comments (method comments)
  const nearbyComments = extractNearbyComments(content, callerMethod);

  // Extract business hints from method name and class name
  const businessHints = extractBusinessHints(callerClass, callerMethod);

  return {
    sourceStatementId: methodId,
    callerMethod: callerMethod || '',
    callerClass: packageName ? `${packageName}.${callerClass}` : callerClass,
    callerFile: filePath,
    callSiteSnippet: callSite?.snippet,
    nearbyComments,
    businessHints,
  };
}

/**
 * Find the method that calls the mapper method.
 */
function findCallingMethod(content: string, callIndex: number): string | null {
  if (callIndex === -1) {
    return null;
  }

  const beforeCall = content.slice(0, callIndex);
  const methodRegex = /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s*)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;

  let lastMethodName: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(beforeCall)) !== null) {
    lastMethodName = match[1];
  }

  return lastMethodName;
}

function findCallSite(
  content: string,
  mapperClass: string,
  methodId: string,
): { index: number; snippet: string } | null {
  const receivers = collectMapperReceivers(content, mapperClass);
  const matcher = buildPreciseCallMatcher(receivers, methodId);

  // 先尝试精确匹配
  if (matcher) {
    const match = matcher.exec(content);
    if (match && typeof match.index === 'number') {
      const callIndex = match.index + (match[1]?.length ?? 0);
      return {
        index: callIndex,
        snippet: extractStatementSnippet(content, callIndex),
      };
    }
  }

  // Fallback: 尝试静态调用 mapperClass.methodId(...)
  const escapedMapperClass = escapeRegExp(mapperClass);
  const escapedMethodId = escapeRegExp(methodId);
  const staticCallRegex = new RegExp(
    `(^|[^\\w])${escapedMapperClass}\\s*\\.\\s*${escapedMethodId}\\s*\\(`,
    'm',
  );
  const staticMatch = staticCallRegex.exec(content);
  if (staticMatch && typeof staticMatch.index === 'number') {
    const callIndex = staticMatch.index + (staticMatch[1]?.length ?? 0);
    return {
      index: callIndex,
      snippet: extractStatementSnippet(content, callIndex),
    };
  }

  // 如果找不到精确匹配，返回 null 而不是使用宽泛匹配
  // 这符合设计要求：缺失证据比错误证据更安全
  return null;
}

function extractStatementSnippet(content: string, callIndex: number): string {
  const statementStart = findStatementStart(content, callIndex);
  const statementEnd = findStatementEnd(content, callIndex);
  return content
    .slice(statementStart, statementEnd)
    .replace(/\s+/g, ' ')
    .trim();
}

function findStatementStart(content: string, callIndex: number): number {
  let cursor = callIndex;
  while (cursor > 0) {
    const previousChar = content[cursor - 1];
    if (previousChar === ';' || previousChar === '{' || previousChar === '}') {
      break;
    }
    cursor -= 1;
  }
  return cursor;
}

function findStatementEnd(content: string, callIndex: number): number {
  let cursor = callIndex;
  while (cursor < content.length) {
    const currentChar = content[cursor];
    cursor += 1;
    if (currentChar === ';') {
      break;
    }
    if (currentChar === '\n' && content.slice(callIndex, cursor).includes(';')) {
      break;
    }
  }
  return cursor;
}

/**
 * Extract comments near the calling method.
 */
function extractNearbyComments(content: string, methodName: string | null): string[] {
  if (!methodName) return [];

  const comments: string[] = [];

  // Find method position
  const methodPos = content.indexOf(` ${methodName}(`);
  if (methodPos === -1) return [];

  // Look for preceding comments (up to 500 chars before)
  const beforeMethod = content.slice(Math.max(0, methodPos - 500), methodPos);

  // Match /** ... */ comments
  const commentRegex = /\/\*\*[\s\S]*?\*\/\s*$/;
  const commentMatch = beforeMethod.match(commentRegex);

  if (commentMatch) {
    const cleanedComment = commentMatch[0]
      .replace(/\/\*\*/, '')
      .replace(/\*\//, '')
      .replace(/^\s*\*\s*/gm, '')
      .trim();
    comments.push(cleanedComment);
  }

  return comments;
}

/**
 * Extract business hints from class/method names.
 */
function extractBusinessHints(callerClass: string, callerMethod: string | null): string[] {
  const hints: string[] = [];

  // From class name
  if (callerClass.endsWith('Service')) {
    const domain = callerClass.replace('Service', '');
    hints.push(`Domain: ${domain}`);
  }

  // From method name
  if (callerMethod) {
    if (callerMethod.startsWith('get') || callerMethod.startsWith('query') || callerMethod.startsWith('find')) {
      hints.push('Read operation');
    } else if (callerMethod.startsWith('add') || callerMethod.startsWith('create') || callerMethod.startsWith('insert')) {
      hints.push('Write operation: create');
    } else if (callerMethod.startsWith('update') || callerMethod.startsWith('modify')) {
      hints.push('Write operation: update');
    } else if (callerMethod.startsWith('delete') || callerMethod.startsWith('remove')) {
      hints.push('Write operation: delete');
    }
  }

  return hints;
}

/**
 * Convert class name to camelCase variable name.
 */
function toCamelCase(className: string): string {
  // AuthMapper -> authMapper
  return className.charAt(0).toLowerCase() + className.slice(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}