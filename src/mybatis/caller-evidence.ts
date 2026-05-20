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
  // Common patterns:
  // - mapperClass.methodId(...)
  // - mapperVariable.methodId(...)
  // where mapperVariable is typically the mapper class name in camelCase

  const mapperVar = toCamelCase(mapperClass);

  // Match patterns like: mapper.methodId or authMapper.getMenuAuthList
  // Also match just .methodId() for more lenient matching
  const patterns = [
    `${mapperClass}.${methodId}`,
    `${mapperVar}.${methodId}`,
    `.${methodId}\\s*\\(`,
  ];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern.replace(/\./g, '\\.'), 'g');
      if (regex.test(content)) {
        return true;
      }
    } catch {
      // Invalid regex pattern, skip
      continue;
    }
  }

  // Fallback: simple string search for methodId
  if (content.includes(`.${methodId}(`)) {
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

  // Find method that contains the call
  const callerMethod = findCallingMethod(content, mapperClass, methodId);

  // Extract nearby comments (method comments)
  const nearbyComments = extractNearbyComments(content, callerMethod);

  // Extract business hints from method name and class name
  const businessHints = extractBusinessHints(callerClass, callerMethod);

  return {
    sourceStatementId: methodId,
    callerMethod: callerMethod || '',
    callerClass: packageName ? `${packageName}.${callerClass}` : callerClass,
    callerFile: filePath,
    nearbyComments,
    businessHints,
  };
}

/**
 * Find the method that calls the mapper method.
 */
function findCallingMethod(content: string, mapperClass: string, methodId: string): string | null {
  const mapperVar = toCamelCase(mapperClass);
  const callPattern = `${mapperVar}.${methodId}`;

  // Find the method containing this call
  // Match public/private method declarations
  const methodRegex = /(?:public|private|protected)\s+\w+\s+(\w+)\s*\([^)]*\)\s*\{([^}]*?)\}/g;

  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const methodName = match[1];
    const methodBody = match[2];

    if (methodBody.includes(callPattern) || methodBody.includes(`.${methodId}`)) {
      return methodName;
    }
  }

  return null;
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