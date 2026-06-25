import fs from "node:fs/promises";
import path from "node:path";
import type { RepositoryClassificationContext } from "./types.js";

const DEFAULT_KNOWLEDGE_DIR = "ai-knowledge";

export async function saveProjectContext(
  context: RepositoryClassificationContext,
  outputRoot: string,
): Promise<void> {
  const knowledgeDir = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR);
  const filePath = path.join(knowledgeDir, "project-context.json");
  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(context, null, 2) + "\n",
    "utf-8",
  );
}

export async function loadProjectContext(
  outputRoot: string,
): Promise<RepositoryClassificationContext | null> {
  const filePath = path.join(
    outputRoot,
    DEFAULT_KNOWLEDGE_DIR,
    "project-context.json",
  );
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as RepositoryClassificationContext;
  } catch {
    return null;
  }
}
