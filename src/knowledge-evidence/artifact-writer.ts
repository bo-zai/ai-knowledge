import fs from "fs/promises";
import path from "path";
import { getStoragePaths } from "../engine/storage/repo-manager.js";
import type { EvidencePlanArtifact } from "./types.js";
import type { CapabilityInventoryItem } from "../slicing/capability-inventory.js";

export async function writeEvidencePlanArtifact(
  repoPath: string,
  artifact: EvidencePlanArtifact,
): Promise<void> {
  const outputDir = getKnowledgeGenerationDir(repoPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(
    path.join(outputDir, "evidence-plan.json"),
    JSON.stringify(artifact, null, 2) + "\n",
    "utf-8",
  );

  if (artifact.type === "CONCEPT") {
    await fs.writeFile(
      path.join(outputDir, "concept-evidence-groups.json"),
      JSON.stringify(artifact, null, 2) + "\n",
      "utf-8",
    );
  }

  if (artifact.type === "CAPABILITY") {
    await fs.writeFile(
      path.join(outputDir, "capability-evidence-groups.json"),
      JSON.stringify(artifact, null, 2) + "\n",
      "utf-8",
    );
  }

  await fs.writeFile(
    path.join(outputDir, "evidence-quality-report.json"),
    JSON.stringify(
      {
        type: artifact.type,
        source: artifact.source,
        partitionMode: artifact.partitionMode,
        groupCount: artifact.groupCount,
        warnings: artifact.warnings,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

export async function writeCapabilityInventoryArtifact(
  repoPath: string,
  inventory: CapabilityInventoryItem[],
  warnings: string[],
): Promise<void> {
  const outputDir = getKnowledgeGenerationDir(repoPath);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "capability-inventory.json"),
    JSON.stringify({ inventory, warnings }, null, 2) + "\n",
    "utf-8",
  );
}

function getKnowledgeGenerationDir(repoPath: string): string {
  const { storagePath } = getStoragePaths(repoPath);
  return path.join(storagePath, "knowledge-generation");
}
