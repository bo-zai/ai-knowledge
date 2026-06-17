import { basename } from "node:path";

/**
 * Extract repository name from a path, handling both Windows and POSIX styles.
 * @param repoPath - The repository path (Windows or POSIX)
 * @returns The basename of the repository directory
 */
export function getRepoBasename(repoPath: string): string {
  // Node.js path.basename handles both Windows and POSIX paths correctly
  // based on the current platform, but we need to handle paths from either
  // platform regardless of where we're running.

  // Normalize the path first to handle mixed separators
  const normalized = repoPath.replace(/\\/g, "/");

  // Remove trailing separators
  const trimmed = normalized.replace(/\/+$/, "");

  // Handle Windows drive letter roots (e.g., "C:" or "C:/")
  if (trimmed.match(/^[A-Za-z]:$/)) {
    return "unknown";
  }

  // Handle POSIX root
  if (trimmed === "" || trimmed === "/") {
    return "unknown";
  }

  // Split and get the last non-empty segment
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : "unknown";
}

/**
 * Generate a safe repository ID from a path.
 * @param repoPath - The repository path
 * @returns A sanitized repo ID suitable for manifest and frontmatter
 */
export function getRepoId(repoPath: string): string {
  const name = getRepoBasename(repoPath);
  if (name === "unknown") {
    return "unknown";
  }
  // Sanitize: lowercase, replace spaces and underscores with dashes, remove special chars
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
