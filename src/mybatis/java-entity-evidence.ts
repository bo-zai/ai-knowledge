/**
 * Java Entity Evidence Resolver
 *
 * Resolves resultType/resultMap to Java entity files and extracts
 * field names, comments, and type information.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ResultMapDef, EntityEvidence } from './types.js';

/**
 * Resolve entity evidence from resultType or resultMap.
 */
export async function resolveEntityEvidence(args: {
  repoPath: string;
  coreRepoPath?: string; // Path to core module if separate
  resultType?: string;
  resultMap?: ResultMapDef | null;
}): Promise<EntityEvidence | null> {
  const { repoPath, resultType, resultMap } = args;

  // Resolve FQN to Java file path
  const javaFqn = resultMap?.type || resultType;
  if (!javaFqn) return null;

  // Try both repoPath and coreRepoPath
  const searchPaths = args.coreRepoPath
    ? [args.coreRepoPath, repoPath]
    : [repoPath];

  for (const searchPath of searchPaths) {
    const javaFile = await findJavaFile(searchPath, javaFqn);
    if (javaFile) {
      return parseJavaEntityFile(javaFile, javaFqn, resultMap);
    }
  }

  return null;
}

/**
 * Find Java file from FQN (Fully Qualified Name).
 */
async function findJavaFile(repoPath: string, fqn: string): Promise<string | null> {
  // Convert FQN to file path: com.education.music.core.DO.user.UserDO -> .../user/UserDO.java
  const parts = fqn.split('.');
  const className = parts[parts.length - 1];
  const packagePath = parts.slice(0, -1).join('/');

  // Possible locations
  const possiblePaths = [
    path.join(repoPath, 'src/main/java', packagePath, `${className}.java`),
    path.join(repoPath, packagePath, `${className}.java`),
  ];

  for (const filePath of possiblePaths) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  // Try glob search as fallback
  try {
    const { glob } = await import('glob');
    const pattern = `**/${className}.java`;
    const matches = await glob(pattern, {
      cwd: repoPath,
      absolute: true,
      ignore: ['node_modules/**', '.git/**', 'target/**', 'build/**'],
    });

    // Find the one matching the package
    for (const match of matches) {
      const relativePath = path.relative(repoPath, match);
      if (relativePath.includes(packagePath.replace(/\//g, path.sep))) {
        return match;
      }
    }

    // Return first match if package path doesn't match
    if (matches.length > 0) {
      return matches[0];
    }
  } catch {
    // glob not available
  }

  return null;
}

/**
 * Parse Java entity file and extract field evidence.
 */
async function parseJavaEntityFile(
  filePath: string,
  javaFqn: string,
  resultMap?: ResultMapDef | null
): Promise<EntityEvidence> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Extract class comment
  const classComment = extractClassComment(content);

  // Extract fields with comments
  const rawFields = extractJavaFields(content);

  // Build field evidence with resultMap mapping
  const fields = rawFields.map((field) => {
    // Find column mapping from resultMap
    const mapping = resultMap?.mappings.find((m) => m.property === field.name);

    return {
      javaProperty: field.name,
      javaFieldName: field.name,
      javaFieldType: field.type,
      javaFieldComment: field.comment,
      mappedColumn: mapping?.column ?? toSnakeCase(field.name),
    };
  });

  return {
    sourceStatementId: '', // Will be filled by caller
    javaType: javaFqn,
    javaFile: filePath,
    classComment,
    fields,
  };
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

/**
 * Extract class-level comment from Java file.
 */
function extractClassComment(content: string): string | undefined {
  // Match /** ... */ before class declaration
  const classCommentRegex = /\/\*\*[\s\S]*?\*\/\s*(?:@[\w\s]+\s*)*public\s+class/;
  const match = content.match(classCommentRegex);

  if (match) {
    // Clean up the comment
    const comment = match[0]
      .replace(/\/\*\*/, '')
      .replace(/\*\//, '')
      .replace(/\s*public\s+class.*$/, '')
      .replace(/^\s*\*\s*/gm, '') // Remove leading * on each line
      .trim();

    return comment || undefined;
  }

  return undefined;
}

/**
 * Extract Java fields with their comments and types.
 */
function extractJavaFields(content: string): Array<{
  name: string;
  type: string;
  comment?: string;
}> {
  const fields: Array<{ name: string; type: string; comment?: string }> = [];

  const classBody = findPrimaryTypeBody(content);
  if (!classBody) {
    return fields;
  }

  const lines = classBody.split(/\r?\n/);
  const fieldRegex =
    /^(?:private|protected|public)\s+(?:(?:static|final|transient|volatile)\s+)*([\w.$<>\[\],?]+)\s+(\w+)\s*(?:=[^;]*)?;$/;

  let depth = 1;
  let inJavadoc = false;
  const commentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (inJavadoc) {
      const cleaned = cleanJavadocLine(line);
      if (cleaned) {
        commentLines.push(cleaned);
      }

      if (line.includes('*/')) {
        inJavadoc = false;
      }
      continue;
    }

    if (depth === 1 && line.startsWith('/**')) {
      inJavadoc = true;
      const cleaned = cleanJavadocLine(line);
      if (cleaned) {
        commentLines.push(cleaned);
      }
      if (line.includes('*/')) {
        inJavadoc = false;
      }
      continue;
    }

    if (depth !== 1) {
      depth += countStructuralBraces(line);
      continue;
    }

    if (line.startsWith('@')) {
      continue;
    }

    const normalizedLine = stripInlineComment(line);
    if (
      normalizedLine.includes('(') ||
      /\b(class|interface|enum|record)\b/.test(normalizedLine)
    ) {
      depth += countStructuralBraces(normalizedLine);
      commentLines.length = 0;
      continue;
    }

    const match = normalizedLine.match(fieldRegex);
    if (match && !/\bstatic\b/.test(normalizedLine)) {
      fields.push({
        name: match[2],
        type: match[1].trim(),
        comment: commentLines.length > 0 ? commentLines.join('\n') : undefined,
      });
      commentLines.length = 0;
      continue;
    }

    if (normalizedLine.endsWith(';')) {
      commentLines.length = 0;
    }

    depth += countStructuralBraces(normalizedLine);
  }

  return fields;
}

function findPrimaryTypeBody(content: string): string | null {
  const typeMatch = /\b(?:public\s+)?(?:abstract\s+|final\s+)?(?:class|record)\s+\w+[^{]*\{/m.exec(content);
  if (!typeMatch) {
    return null;
  }

  const bodyStart = (typeMatch.index ?? 0) + typeMatch[0].length;
  let depth = 1;

  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(bodyStart, index);
      }
    }
  }

  return null;
}

function cleanJavadocLine(line: string): string {
  return line
    .replace('/**', '')
    .replace('*/', '')
    .replace(/^\s*\*\s?/, '')
    .trim();
}

function stripInlineComment(line: string): string {
  return line.replace(/\/\/.*$/, '').trim();
}

function countStructuralBraces(line: string): number {
  let balance = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && char === '\'') {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '{') {
      balance += 1;
    } else if (char === '}') {
      balance -= 1;
    }
  }

  return balance;
}

/**
 * Build field evidence lookup from entity and resultMap.
 */
export function buildFieldEvidenceLookup(
  entityEvidence: EntityEvidence,
  resultMap?: ResultMapDef | null
): Map<string, { javaProperty: string; javaComment?: string; mappedColumn?: string }> {
  const lookup = new Map();

  for (const field of entityEvidence.fields) {
    lookup.set(field.javaProperty, {
      javaProperty: field.javaProperty,
      javaComment: field.javaFieldComment,
      mappedColumn: field.mappedColumn,
    });

    // Also add by column name if mapped
    if (field.mappedColumn) {
      lookup.set(field.mappedColumn, {
        javaProperty: field.javaProperty,
        javaComment: field.javaFieldComment,
        mappedColumn: field.mappedColumn,
      });
    }
  }

  return lookup;
}
