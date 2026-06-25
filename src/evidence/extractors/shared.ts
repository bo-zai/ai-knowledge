import type { ConceptCandidate } from "../concept-filter.js";

const TECHNICAL_PATH_SEGMENTS = new Set([
  "src",
  "main",
  "java",
  "test",
  "tests",
  "kotlin",
  "scala",
  "groovy",
  "com",
  "org",
  "net",
  "io",
  "github",
]);

/**
 * Extract package path from file path.
 * Example: src/main/java/com/education/music/app/entity/VO/UserVO.java
 *          → entity/VO
 */
export function extractPackagePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const significantParts = parts.filter(
    (part) => !TECHNICAL_PATH_SEGMENTS.has(part.toLowerCase()),
  );

  // Take last 2-3 meaningful directories
  if (significantParts.length >= 2) {
    return significantParts.slice(-2).join("/");
  }
  if (significantParts.length === 1) {
    return significantParts[0];
  }

  // Fallback: use parent directory of file
  return parts.slice(-2, -1).join("/") || "root";
}

/**
 * Group raw results by package path.
 */
export function groupByPackagePath<T extends { filePath: string }>(
  results: T[],
  maxGroupSize: number = 8,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  const context = createPackageGroupingContext(
    results.map((row) => row.filePath),
  );

  for (const row of results) {
    const packagePath = extractPackagePathWithContext(
      row.filePath as string,
      context,
    );

    if (!groups.has(packagePath)) {
      groups.set(packagePath, []);
    }

    const group = groups.get(packagePath)!;

    // Split large groups
    if (group.length >= maxGroupSize) {
      const subGroupId = `${packagePath}-${groups.size}`;
      groups.set(subGroupId, [row]);
    } else {
      group.push(row);
    }
  }

  return groups;
}

/**
 * 按包路径分组（保留软标记信息）
 */
export function groupByPackagePathWithMarks<T extends { filePath: string }>(
  results: T[],
  maxGroupSize: number = 8,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  const context = createPackageGroupingContext(
    results.map((row) => row.filePath),
  );

  for (const row of results) {
    const packagePath = extractPackagePathWithContext(row.filePath, context);

    if (!groups.has(packagePath)) {
      groups.set(packagePath, []);
    }

    const group = groups.get(packagePath)!;

    if (group.length >= maxGroupSize) {
      const subGroupId = `${packagePath}-${groups.size}`;
      groups.set(subGroupId, [row]);
    } else {
      group.push(row);
    }
  }

  return groups;
}

interface PackageGroupingContext {
  sharedPrefix: string[];
}

function extractPackagePathWithContext(
  filePath: string,
  context: PackageGroupingContext,
): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const significantParts = parts.filter(
    (part) => !TECHNICAL_PATH_SEGMENTS.has(part.toLowerCase()),
  );
  const trimmedParts = significantParts.slice(context.sharedPrefix.length);

  if (trimmedParts.length >= 2) {
    return trimmedParts.slice(-2).join("/");
  }
  if (trimmedParts.length === 1) {
    return trimmedParts[0];
  }

  return extractPackagePath(filePath);
}

function createPackageGroupingContext(
  filePaths: string[],
): PackageGroupingContext {
  const tokenLists = filePaths
    .map((filePath) =>
      filePath
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .filter((part) => !TECHNICAL_PATH_SEGMENTS.has(part.toLowerCase())),
    )
    .filter((tokens) => tokens.length > 0);

  if (tokenLists.length === 0) {
    return { sharedPrefix: [] };
  }

  const first = tokenLists[0];
  const sharedPrefix: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const token = first[index];
    if (
      tokenLists.every(
        (tokens) => tokens.length > index && tokens[index] === token,
      )
    ) {
      sharedPrefix.push(token);
      continue;
    }
    break;
  }

  return {
    sharedPrefix: sharedPrefix.slice(0, Math.max(0, sharedPrefix.length - 1)),
  };
}
