/**
 * Java Entity Evidence Resolver
 *
 * Resolves resultType/resultMap to Java entity files via LadybugDB graph queries.
 * Uses Class nodes and HAS_PROPERTY edges for field discovery.
 * Falls back to file-based parsing when graph is unavailable.
 */

import fs, { access } from 'fs/promises';
import path from 'path';
import type { ResultMapDef, EntityEvidence } from './types.js';
import { initLbug, executeQuery, closeLbug } from '../engine/lbug/lbug-adapter.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';

/**
 * Resolve entity evidence from resultType or resultMap.
 */
export async function resolveEntityEvidence(args: {
  repoPath: string;
  coreRepoPath?: string;
  resultType?: string;
  resultMap?: ResultMapDef | null;
}): Promise<EntityEvidence | null> {
  const { repoPath, resultType, resultMap } = args;
  const javaFqn = resultMap?.type || resultType;
  if (!javaFqn) return null;

  const searchPaths = args.coreRepoPath
    ? [args.coreRepoPath, repoPath]
    : [repoPath];

  // Try graph-based resolution first
  for (const searchPath of searchPaths) {
    const entityEvidence = await resolveEntityFromGraph(searchPath, javaFqn, resultMap);
    if (entityEvidence) return entityEvidence;
  }

  // Fallback to file-based resolution
  for (const searchPath of searchPaths) {
    const javaFile = await findJavaFile(searchPath, javaFqn);
    if (javaFile) {
      return parseJavaEntityFile(javaFile, javaFqn, resultMap);
    }
  }

  return null;
}

/**
 * Resolve entity via LadybugDB graph: find Class node and HAS_PROPERTY edges.
 */
async function resolveEntityFromGraph(
  repoPath: string,
  javaFqn: string,
  resultMap?: ResultMapDef | null,
): Promise<EntityEvidence | null> {
  const className = javaFqn.split('.').pop() || javaFqn;

  try {
    const { lbugPath } = getStoragePaths(repoPath);
    await access(lbugPath); // Only use graph if DB already exists
    await initLbug(lbugPath);

    // Check graph has this class
    const escapedClass = escapeCypherString(className);
    const classRows = await executeQuery(
      `MATCH (c:Class) WHERE c.name = '${escapedClass}' RETURN c.filePath AS fp, count(c) AS cnt`,
    );
    const cnt = Number((classRows[0] as Record<string, unknown>)?.cnt ?? 0);
    if (cnt === 0) {
      await closeLbug();
      return null;
    }

    const filePath = (classRows[0] as Record<string, unknown>)?.fp as string | undefined;
    if (!filePath) {
      await closeLbug();
      return null;
    }

    // Get class properties (fields)
    const propRows = await executeQuery(
      `MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property) WHERE c.name = '${escapedClass}' RETURN p.name AS name, p.declaredType AS type ORDER BY r.step`,
    );

    // Read file for class comment (not in graph)
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
    const classComment = content ? extractClassComment(content) : undefined;

    const fields = (propRows || [])
      .filter((row: Record<string, unknown>) => row.name && row.type)
      .map((row: Record<string, unknown>) => {
        const propName = row.name as string;
        const propType = row.type as string;
        // Find column mapping from resultMap
        const mapping = resultMap?.mappings.find((m) => m.property === propName);
        return {
          javaProperty: propName,
          javaFieldName: propName,
          javaFieldType: propType,
          javaFieldComment: undefined, // Property comments not in graph
          mappedColumn: mapping?.column ?? toSnakeCase(propName),
        };
      });

    await closeLbug();

    if (fields.length === 0 && !content) return null;

    const relativePath = path.isAbsolute(filePath)
      ? path.relative(repoPath, filePath).replace(/\\/g, '/')
      : filePath.replace(/\\/g, '/');

    return {
      sourceStatementId: '',
      javaType: javaFqn,
      javaFile: relativePath,
      classComment,
      fields,
    };
  } catch {
    return null;
  }
}

// ---- File-based fallback helpers ----

async function findJavaFile(repoPath: string, fqn: string): Promise<string | null> {
  const parts = fqn.split('.');
  const className = parts[parts.length - 1];
  const packagePath = parts.slice(0, -1).join('/');

  const possiblePaths = [
    path.join(repoPath, 'src/main/java', packagePath, `${className}.java`),
    path.join(repoPath, packagePath, `${className}.java`),
  ];

  for (const filePath of possiblePaths) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch { /* skip */ }
  }

  try {
    const { glob } = await import('glob');
    const matches = await glob(`**/${className}.java`, {
      cwd: repoPath,
      absolute: true,
      ignore: ['node_modules/**', '.git/**', 'target/**', 'build/**'],
    });
    for (const match of matches) {
      const relativePath = path.relative(repoPath, match);
      if (relativePath.includes(packagePath.replace(/\//g, path.sep))) return match;
    }
    if (matches.length > 0) return matches[0];
  } catch { /* glob not available */ }

  return null;
}

async function parseJavaEntityFile(
  filePath: string,
  javaFqn: string,
  resultMap?: ResultMapDef | null,
): Promise<EntityEvidence> {
  const content = await fs.readFile(filePath, 'utf-8');
  const classComment = extractClassComment(content);
  const rawFields = extractJavaFields(content);

  const fields = rawFields.map((field) => {
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
    sourceStatementId: '',
    javaType: javaFqn,
    javaFile: filePath,
    classComment,
    fields,
  };
}

function toSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
}

function extractClassComment(content: string): string | undefined {
  const classCommentRegex = /\/\*\*[\s\S]*?\*\/\s*(?:@[\w\s]+\s*)*public\s+class/;
  const match = content.match(classCommentRegex);
  if (match) {
    const comment = match[0]
      .replace(/\/\*\*/, '')
      .replace(/\*\//, '')
      .replace(/\s*public\s+class.*$/, '')
      .replace(/^\s*\*\s*/gm, '')
      .trim();
    return comment || undefined;
  }
  return undefined;
}

function extractJavaFields(content: string): Array<{ name: string; type: string; comment?: string }> {
  const fields: Array<{ name: string; type: string; comment?: string }> = [];
  const classBody = findPrimaryTypeBody(content);
  if (!classBody) return fields;

  const lines = classBody.split(/\r?\n/);
  const fieldRegex = /^(?:private|protected|public)\s+(?:(?:static|final|transient|volatile)\s+)*([\w.$<>\[\],?]+)\s+(\w+)\s*(?:=[^;]*)?;$/;

  let depth = 1;
  let inJavadoc = false;
  const commentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inJavadoc) {
      const cleaned = cleanJavadocLine(line);
      if (cleaned) commentLines.push(cleaned);
      if (line.includes('*/')) inJavadoc = false;
      continue;
    }

    if (depth === 1 && line.startsWith('/**')) {
      inJavadoc = true;
      const cleaned = cleanJavadocLine(line);
      if (cleaned) commentLines.push(cleaned);
      if (line.includes('*/')) inJavadoc = false;
      continue;
    }

    if (depth !== 1) {
      depth += countStructuralBraces(line);
      continue;
    }

    if (line.startsWith('@')) continue;

    const normalizedLine = stripInlineComment(line);
    if (normalizedLine.includes('(') || /\b(class|interface|enum|record)\b/.test(normalizedLine)) {
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

    if (normalizedLine.endsWith(';')) commentLines.length = 0;
    depth += countStructuralBraces(normalizedLine);
  }

  return fields;
}

function findPrimaryTypeBody(content: string): string | null {
  const typeMatch = /\b(?:public\s+)?(?:abstract\s+|final\s+)?(?:class|record)\s+\w+[^{]*\{/m.exec(content);
  if (!typeMatch) return null;
  const bodyStart = (typeMatch.index ?? 0) + typeMatch[0].length;
  let depth = 1;
  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(bodyStart, index);
    }
  }
  return null;
}

function cleanJavadocLine(line: string): string {
  return line.replace('/**', '').replace('*/', '').replace(/^\s*\*\s?/, '').trim();
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
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (!inDoubleQuote && char === '\'') { inSingleQuote = !inSingleQuote; continue; }
    if (!inSingleQuote && char === '"') { inDoubleQuote = !inDoubleQuote; continue; }
    if (inSingleQuote || inDoubleQuote) continue;
    if (char === '{') balance += 1;
    else if (char === '}') balance -= 1;
  }
  return balance;
}

export function buildFieldEvidenceLookup(
  entityEvidence: EntityEvidence,
  resultMap?: ResultMapDef | null,
): Map<string, { javaProperty: string; javaComment?: string; mappedColumn?: string }> {
  const lookup = new Map();
  for (const field of entityEvidence.fields) {
    lookup.set(field.javaProperty, {
      javaProperty: field.javaProperty,
      javaComment: field.javaFieldComment,
      mappedColumn: field.mappedColumn,
    });
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

function escapeCypherString(value: string): string {
  return value.replace(/'/g, "''");
}
