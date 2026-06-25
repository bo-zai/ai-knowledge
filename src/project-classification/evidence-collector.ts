import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectTypeEvidence } from "./types.js";

export async function collectProjectTypeEvidence(
  repoPath: string,
): Promise<ProjectTypeEvidence> {
  const directoryTree = await collectDirectoryTree(repoPath, 2);
  const configFiles = await collectConfigFiles(repoPath);
  const entryCandidates = await collectEntryCandidates(repoPath);
  const readmeSnippet = await collectReadmeSnippet(repoPath);
  const dependencies = await collectDependencies(repoPath);
  const topLevelDirectories = await collectTopLevelDirectories(repoPath);
  const structuralSignals = collectStructuralSignals({
    directoryTree,
    configFiles,
    dependencies,
    topLevelDirectories,
  });

  return {
    directoryTree,
    configFiles,
    entryCandidates,
    readmeSnippet,
    dependencies,
    topLevelDirectories,
    structuralSignals,
  };
}

async function collectDirectoryTree(
  repoPath: string,
  depth: number,
): Promise<string> {
  const lines: string[] = [];
  await walkDirectory(repoPath, "", depth, lines);
  return lines.join("\n");
}

async function walkDirectory(
  dir: string,
  prefix: string,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (maxDepth <= 0) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => !shouldExclude(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory() && maxDepth > 1) {
        await walkDirectory(
          path.join(dir, entry.name),
          `${prefix}  `,
          maxDepth - 1,
          lines,
        );
      }
    }
  } catch {
    // 忽略不可读目录，保留已有证据。
  }
}

function shouldExclude(name: string): boolean {
  const excluded = new Set([
    "node_modules",
    ".git",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "target",
    "out",
    ".knowledge",
    "ai-knowledge",
    ".codegraph",
    ".claude",
  ]);
  return excluded.has(name) || name.startsWith(".");
}

async function collectConfigFiles(repoPath: string): Promise<string[]> {
  const patterns = [
    "pom.xml",
    "build.gradle",
    "package.json",
    "go.mod",
    "Cargo.toml",
    "requirements.txt",
  ];
  const files: string[] = [];

  for (const pattern of patterns) {
    try {
      await fs.access(path.join(repoPath, pattern));
      files.push(pattern);
    } catch {
      // ignore
    }
  }

  return files;
}

async function collectEntryCandidates(repoPath: string): Promise<string[]> {
  const checkPaths = [
    "src/main.ts",
    "src/main.tsx",
    "src/index.ts",
    "src/cli.ts",
    "main.go",
    "Application.java",
  ];
  const candidates: string[] = [];

  for (const checkPath of checkPaths) {
    try {
      await fs.access(path.join(repoPath, checkPath));
      candidates.push(checkPath);
    } catch {
      // ignore
    }
  }

  return candidates;
}

async function collectReadmeSnippet(
  repoPath: string,
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(
      path.join(repoPath, "README.md"),
      "utf-8",
    );
    return content.slice(0, 500).split("\n").slice(0, 10).join("\n");
  } catch {
    return undefined;
  }
}

async function collectDependencies(repoPath: string): Promise<string[]> {
  const dependencies: string[] = [];

  try {
    const packageJsonContent = await fs.readFile(
      path.join(repoPath, "package.json"),
      "utf-8",
    );
    const packageJson = JSON.parse(packageJsonContent) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    dependencies.push(...Object.keys(packageJson.dependencies ?? {}));
    dependencies.push(...Object.keys(packageJson.devDependencies ?? {}));
  } catch {
    // ignore
  }

  try {
    const pomContent = await fs.readFile(
      path.join(repoPath, "pom.xml"),
      "utf-8",
    );
    const dependenciesSection = pomContent.match(
      /<dependencies>([\s\S]*?)<\/dependencies>/,
    );
    if (dependenciesSection) {
      const artifactMatches = dependenciesSection[1].match(
        /<artifactId>([^<]+)<\/artifactId>/g,
      );
      if (artifactMatches) {
        dependencies.push(
          ...artifactMatches.map((match) =>
            match
              .replace("<artifactId>", "")
              .replace("</artifactId>", "")
              .trim(),
          ),
        );
      }
    }

    if (dependencies.length === 0) {
      const rootArtifactId = pomContent.match(
        /<artifactId>([^<]+)<\/artifactId>/,
      );
      if (rootArtifactId) {
        dependencies.push(rootArtifactId[1].trim());
      }
    }
  } catch {
    // ignore
  }

  return dependencies.slice(0, 80);
}

async function collectTopLevelDirectories(repoPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(repoPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !shouldExclude(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function collectStructuralSignals(
  evidence: Pick<
    ProjectTypeEvidence,
    "directoryTree" | "configFiles" | "dependencies" | "topLevelDirectories"
  >,
): string[] {
  const signals: string[] = [];
  const normalizedSegments = collectNormalizedSegments(evidence);

  if (
    hasAnySegment(normalizedSegments, ["controller", "handler", "route", "api"])
  ) {
    signals.push("layered-entry");
  }

  if (
    hasAnySegment(normalizedSegments, ["service", "usecase", "application"])
  ) {
    signals.push("layered-logic");
  }

  if (hasAnySegment(normalizedSegments, ["mapper", "repository", "dao"])) {
    signals.push("layered-data");
  }

  if (
    hasAnySegment(normalizedSegments, [
      "component",
      "components",
      "view",
      "views",
      "page",
      "pages",
    ])
  ) {
    signals.push("ui-surface");
  }

  if (
    countMatchingSegments(normalizedSegments, [
      "module",
      "adapter",
      "extension",
      "plugin",
      "starter",
    ]) >= 2
  ) {
    signals.push("extension-cluster");
  }

  if (
    countMatchingSegments(normalizedSegments, [
      "listener",
      "consumer",
      "subscriber",
      "job",
      "task",
      "event",
    ]) >= 2
  ) {
    signals.push("async-boundary-cluster");
  }

  if (evidence.configFiles.includes("pom.xml")) {
    signals.push("maven-project");
  }

  return [...new Set(signals)];
}

function collectNormalizedSegments(
  evidence: Pick<
    ProjectTypeEvidence,
    "directoryTree" | "dependencies" | "topLevelDirectories"
  >,
): Set<string> {
  const rawParts = [
    evidence.directoryTree,
    evidence.dependencies.join("\n"),
    evidence.topLevelDirectories.join("\n"),
  ]
    .join("\n")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  return new Set(rawParts);
}

function hasAnySegment(segments: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => segments.has(candidate));
}

function countMatchingSegments(
  segments: Set<string>,
  candidates: string[],
): number {
  return candidates.reduce(
    (count, candidate) => (segments.has(candidate) ? count + 1 : count),
    0,
  );
}
