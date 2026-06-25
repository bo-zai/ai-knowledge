import { promises as fs } from "node:fs";
import path from "node:path";

import type { EvidenceAtom } from "../types.js";
import type {
  EvidenceSource,
  EvidenceSourceCollectionResult,
} from "./types.js";
import type { EvidenceCollectionContext } from "../types.js";
import type { DomainClusterInput } from "../../../partitioning/types.js";

const DOCUMENT_PATTERNS = ["README.md", "README.MD", "readme.md"];

export class ProjectDocSource implements EvidenceSource {
  readonly sourceName = "project-doc";
  readonly sourceKind = "doc" as const;

  async collect(
    _clusterInput: DomainClusterInput,
    context: EvidenceCollectionContext,
  ): Promise<EvidenceSourceCollectionResult> {
    const atoms: EvidenceAtom[] = [];
    const documentPaths = await collectCandidateDocumentPaths(context.repoPath);

    for (const documentPath of documentPaths) {
      const content = await safeReadFile(documentPath);
      if (!content) {
        continue;
      }

      atoms.push(buildDocAtom(documentPath, content, context.repoPath));
    }

    return {
      sourceName: this.sourceName,
      sourceKind: this.sourceKind,
      atoms,
      metadata: {
        documentCount: atoms.length,
      },
    };
  }
}

export function createProjectDocSource(): ProjectDocSource {
  return new ProjectDocSource();
}

async function collectCandidateDocumentPaths(
  repoPath: string,
): Promise<string[]> {
  const documentPaths = new Set<string>();

  for (const pattern of DOCUMENT_PATTERNS) {
    const absolutePath = path.join(repoPath, pattern);
    if (await exists(absolutePath)) {
      documentPaths.add(absolutePath);
    }
  }

  const docsPath = path.join(repoPath, "docs");
  if (await exists(docsPath)) {
    for (const filePath of await collectMarkdownFiles(docsPath, 2)) {
      documentPaths.add(filePath);
    }
  }

  return [...documentPaths];
}

async function collectMarkdownFiles(
  directoryPath: string,
  depth: number,
): Promise<string[]> {
  if (depth < 0) {
    return [];
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await collectMarkdownFiles(absolutePath, depth - 1)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

function buildDocAtom(
  documentPath: string,
  content: string,
  repoPath: string,
): EvidenceAtom {
  const relativePath =
    path.relative(repoPath, documentPath) || path.basename(documentPath);

  return {
    id: `doc-fragment:${relativePath}`,
    atomKind: "doc-fragment",
    sourceKind: "doc",
    summary: `项目文档 ${relativePath} 提供了仓库说明片段`,
    subjects: [
      {
        kind: "document",
        id: relativePath,
        name: relativePath,
      },
    ],
    attributes: {
      relativePath,
      characterCount: content.length,
    },
    confidence: 0.65,
    locations: [
      {
        path: documentPath,
        snippet: truncateSnippet(content),
      },
    ],
    tags: ["project-doc"],
  };
}

async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function truncateSnippet(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 497)}...`;
}
