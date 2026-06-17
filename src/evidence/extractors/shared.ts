import type { ConceptCandidate } from "../concept-filter.js";

/**
 * Extract package path from file path.
 * Example: src/main/java/com/education/music/app/entity/VO/UserVO.java
 *          → entity/VO
 */
export function extractPackagePath(filePath: string): string {
  const parts = filePath.split("/");

  // Find significant directories (exclude src/main/java, test, etc.)
  const significantParts = parts.filter(
    (p) =>
      ![
        "src",
        "main",
        "java",
        "test",
        "kotlin",
        "com",
        "org",
        "app",
        "music",
        "education",
      ].includes(p.toLowerCase()),
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

  for (const row of results) {
    const packagePath = extractPackagePath(row.filePath as string);

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

  for (const row of results) {
    const packagePath = extractPackagePath(row.filePath);

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
