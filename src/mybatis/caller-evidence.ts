/**
 * Mapper Caller Evidence Resolver
 *
 * Resolves Java callers of MyBatis mapper methods via LadybugDB graph queries.
 * Uses CALLS edges to find caller methods, then reads file content only for
 * call site snippets and comments.
 */

import fs, { access } from "fs/promises";
import path from "path";
import type { CallerEvidence } from "./types.js";
import {
  withReadOnlyLbug,
  type ReadOnlyQueryExecutor,
} from "../engine/lbug/read-only-session.js";
import { getStoragePaths } from "../engine/storage/repo-manager.js";

/**
 * Resolve caller evidence for a mapper method.
 */
export async function resolveCallerEvidence(args: {
  repoPath: string;
  namespace: string;
  methodId: string;
}): Promise<CallerEvidence[]> {
  const { repoPath, namespace, methodId } = args;
  const mapperClass = namespace.split(".").pop() || namespace;

  try {
    const { lbugPath } = getStoragePaths(repoPath);
    await access(lbugPath); // Only use graph if DB already exists
    return await withReadOnlyLbug(lbugPath, async (query) => {
      const classRows = await query(
        `MATCH (c:Class) WHERE c.name = '${escapeCypherString(mapperClass)}' RETURN count(c) AS cnt`,
      );
      const classCount = Number(
        (classRows[0] as Record<string, unknown>)?.cnt ?? 0,
      );
      if (classCount === 0) {
        return findMapperCallersFallback(repoPath, mapperClass, methodId);
      }

      return findMapperCallersFromGraph(repoPath, mapperClass, methodId, query);
    });
  } catch {
    return findMapperCallersFallback(repoPath, mapperClass, methodId);
  }
}

/**
 * Find callers via graph: locate mapper methods, then trace CALLS edges back.
 */
async function findMapperCallersFromGraph(
  repoPath: string,
  mapperClass: string,
  methodId: string,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<CallerEvidence[]> {
  const escapedClass = escapeCypherString(mapperClass);
  const escapedMethod = escapeCypherString(methodId);

  // Find all methods on the mapper class, then find callers
  const cypher = `
    MATCH (mapperClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(mapperMethod:Method)
    WHERE mapperClass.name = '${escapedClass}' AND mapperMethod.name = '${escapedMethod}'
    MATCH (callerMethod:Method)-[r:CodeRelation {type: 'CALLS'}]->(mapperMethod)
    MATCH (callerClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(callerMethod)
    RETURN DISTINCT
      callerClass.name AS className,
      callerClass.filePath AS filePath,
      callerMethod.name AS methodName,
      callerMethod.startLine AS startLine
    LIMIT 50
  `;

  const rows = await executeQuery(cypher);
  const callers: CallerEvidence[] = [];

  for (const row of rows || []) {
    const className = row.className as string;
    const filePath = row.filePath as string;
    const methodName = row.methodName as string;
    const startLine = row.startLine as number | undefined;

    if (!filePath || !className || !methodName) continue;

    const relative = path.isAbsolute(filePath)
      ? path.relative(repoPath, filePath).replace(/\\/g, "/")
      : filePath.replace(/\\/g, "/");

    if (!relative.endsWith(".java")) continue;

    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(repoPath, filePath);
    const content = await fs.readFile(fullPath, "utf-8").catch(() => "");
    if (!content) continue;

    const packageMatch = content.match(/package\s+([\w.]+)/);
    const packageName = packageMatch ? packageMatch[1] : "";
    const callSiteSnippet = startLine
      ? extractLineSnippet(content, startLine)
      : undefined;
    const nearbyComments = extractNearbyComments(content, methodName);
    const businessHints = extractBusinessHints(className, methodName);

    callers.push({
      sourceStatementId: methodId,
      callerMethod: methodName,
      callerClass: packageName ? `${packageName}.${className}` : className,
      callerFile: relative,
      callSiteSnippet,
      nearbyComments,
      businessHints,
    });
  }

  return callers;
}

/**
 * Fallback: file-based scanning when graph is unavailable.
 */
async function findMapperCallersFallback(
  repoPath: string,
  mapperClass: string,
  methodId: string,
): Promise<CallerEvidence[]> {
  const callers: CallerEvidence[] = [];
  const javaFiles = await findJavaFilesImportingMapper(repoPath, mapperClass);

  for (const javaFile of javaFiles) {
    const content = await fs.readFile(javaFile, "utf-8");
    if (callsMapperMethod(content, mapperClass, methodId)) {
      const evidence = extractCallerEvidence(
        content,
        javaFile,
        repoPath,
        mapperClass,
        methodId,
      );
      if (evidence) {
        callers.push(evidence);
      }
    }
  }

  return callers;
}

// ---- File-based fallback helpers (unchanged from original) ----

async function findJavaFilesImportingMapper(
  repoPath: string,
  mapperClass: string,
): Promise<string[]> {
  const files: string[] = [];
  try {
    const { glob } = await import("glob");
    const matches = await glob("**/*.java", {
      cwd: repoPath,
      absolute: true,
      ignore: ["node_modules/**", ".git/**", "target/**", "build/**"],
    });
    for (const file of matches) {
      try {
        const content = await fs.readFile(file, "utf-8");
        if (content.includes("import") && content.includes(mapperClass)) {
          files.push(file);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* glob not available */
  }
  return files;
}

function collectMapperReceivers(
  content: string,
  mapperClass: string,
): string[] {
  const receivers = new Set<string>([toCamelCase(mapperClass), mapperClass]);
  const escaped = escapeRegExp(mapperClass);
  const fieldRegex = new RegExp(`\\b${escaped}\\s+(\\w+)\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(content)) !== null && m[1]) receivers.add(m[1]);
  const paramRegex = new RegExp(`\\(${escaped}\\s+(\\w+)\\b`, "g");
  while ((m = paramRegex.exec(content)) !== null && m[1]) receivers.add(m[1]);
  return [...receivers];
}

function buildPreciseCallMatcher(
  receivers: string[],
  methodId: string,
): RegExp | null {
  if (receivers.length === 0) return null;
  const receiverPattern = receivers
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");
  return new RegExp(
    `(^|[^\\w])(?:${receiverPattern})\\s*\\.\\s*${escapeRegExp(methodId)}\\s*\\(`,
    "m",
  );
}

function callsMapperMethod(
  content: string,
  mapperClass: string,
  methodId: string,
): boolean {
  const receivers = collectMapperReceivers(content, mapperClass);
  const preciseMatcher = buildPreciseCallMatcher(receivers, methodId);
  if (preciseMatcher?.test(content)) return true;
  const staticCallRegex = new RegExp(
    `\\b${escapeRegExp(mapperClass)}\\s*\\.\\s*${escapeRegExp(methodId)}\\s*\\(`,
  );
  return staticCallRegex.test(content);
}

function extractCallerEvidence(
  content: string,
  filePath: string,
  repoPath: string,
  mapperClass: string,
  methodId: string,
): CallerEvidence | null {
  const classMatch = content.match(/public\s+class\s+(\w+)/);
  const callerClass = classMatch
    ? classMatch[1]
    : path.basename(filePath, ".java");
  const packageMatch = content.match(/package\s+([\w.]+)/);
  const packageName = packageMatch ? packageMatch[1] : "";
  const callSite = findCallSite(content, mapperClass, methodId);
  const callerMethod = findCallingMethod(content, callSite?.index ?? -1);
  const nearbyComments = extractNearbyComments(content, callerMethod);
  const businessHints = extractBusinessHints(callerClass, callerMethod);
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(repoPath, filePath).replace(/\\/g, "/")
    : filePath.replace(/\\/g, "/");

  return {
    sourceStatementId: methodId,
    callerMethod: callerMethod || "",
    callerClass: packageName ? `${packageName}.${callerClass}` : callerClass,
    callerFile: relativePath,
    callSiteSnippet: callSite?.snippet,
    nearbyComments,
    businessHints,
  };
}

function findCallingMethod(content: string, callIndex: number): string | null {
  if (callIndex === -1) return null;
  const beforeCall = content.slice(0, callIndex);
  const methodRegex =
    /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s*)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let lastMethodName: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(beforeCall)) !== null) lastMethodName = m[1];
  return lastMethodName;
}

function findCallSite(
  content: string,
  mapperClass: string,
  methodId: string,
): { index: number; snippet: string } | null {
  const receivers = collectMapperReceivers(content, mapperClass);
  const matcher = buildPreciseCallMatcher(receivers, methodId);
  if (matcher) {
    const match = matcher.exec(content);
    if (match && typeof match.index === "number") {
      const callIndex = match.index + (match[1]?.length ?? 0);
      return {
        index: callIndex,
        snippet: extractStatementSnippet(content, callIndex),
      };
    }
  }
  const staticCallRegex = new RegExp(
    `(^|[^\\w])${escapeRegExp(mapperClass)}\\s*\\.\\s*${escapeRegExp(methodId)}\\s*\\(`,
    "m",
  );
  const staticMatch = staticCallRegex.exec(content);
  if (staticMatch && typeof staticMatch.index === "number") {
    const callIndex = staticMatch.index + (staticMatch[1]?.length ?? 0);
    return {
      index: callIndex,
      snippet: extractStatementSnippet(content, callIndex),
    };
  }
  return null;
}

function extractStatementSnippet(content: string, callIndex: number): string {
  const start = findStatementStart(content, callIndex);
  const end = findStatementEnd(content, callIndex);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function findStatementStart(content: string, callIndex: number): number {
  let cursor = callIndex;
  while (cursor > 0) {
    const ch = content[cursor - 1];
    if (ch === ";" || ch === "{" || ch === "}") break;
    cursor -= 1;
  }
  return cursor;
}

function findStatementEnd(content: string, callIndex: number): number {
  let cursor = callIndex;
  while (cursor < content.length) {
    const ch = content[cursor];
    cursor += 1;
    if (ch === ";") break;
    if (ch === "\n" && content.slice(callIndex, cursor).includes(";")) break;
  }
  return cursor;
}

function extractLineSnippet(
  content: string,
  lineNumber: number,
): string | undefined {
  const lines = content.split("\n");
  const idx = lineNumber - 1; // 1-based
  if (idx < 0 || idx >= lines.length) return undefined;
  return lines[idx].trim();
}

function extractNearbyComments(
  content: string,
  methodName: string | null,
): string[] {
  if (!methodName) return [];
  const methodPos = content.indexOf(` ${methodName}(`);
  if (methodPos === -1) return [];
  const beforeMethod = content.slice(Math.max(0, methodPos - 500), methodPos);
  const commentRegex = /\/\*\*[\s\S]*?\*\/\s*$/;
  const commentMatch = beforeMethod.match(commentRegex);
  if (commentMatch) {
    return [
      commentMatch[0]
        .replace(/\/\*\*/, "")
        .replace(/\*\//, "")
        .replace(/^\s*\*\s*/gm, "")
        .trim(),
    ];
  }
  return [];
}

function extractBusinessHints(
  callerClass: string,
  callerMethod: string | null,
): string[] {
  const hints: string[] = [];
  if (callerClass.endsWith("Service")) {
    hints.push(`Domain: ${callerClass.replace("Service", "")}`);
  }
  if (callerMethod) {
    if (/^(get|query|find)/.test(callerMethod)) hints.push("Read operation");
    else if (/^(add|create|insert)/.test(callerMethod))
      hints.push("Write operation: create");
    else if (/^(update|modify)/.test(callerMethod))
      hints.push("Write operation: update");
    else if (/^(delete|remove)/.test(callerMethod))
      hints.push("Write operation: delete");
  }
  return hints;
}

function toCamelCase(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCypherString(value: string): string {
  return value.replace(/'/g, "''");
}
