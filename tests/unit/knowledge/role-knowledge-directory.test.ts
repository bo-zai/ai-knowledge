import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureDirectoryStructure,
  ensureRoleKnowledgeStructure,
} from "../../../src/knowledge/init-directory.js";

async function existsAsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

describe("role knowledge directory structure", () => {
  it("creates role knowledge directories under an ai-knowledge package", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "role-knowledge-dirs-"));
    const packageRoot = join(outputRoot, "ai-knowledge");

    const layout = await ensureRoleKnowledgeStructure(packageRoot);

    expect(layout.roleDirs.pm).toBe(join(packageRoot, "roles", "pm"));
    await expect(existsAsDirectory(join(packageRoot, "roles", "pm"))).resolves.toBe(
      true,
    );
    await expect(
      existsAsDirectory(join(packageRoot, "roles", "tech-lead")),
    ).resolves.toBe(true);
    await expect(existsAsDirectory(join(packageRoot, "roles", "qa"))).resolves.toBe(
      true,
    );
    await expect(
      existsAsDirectory(join(packageRoot, "roles", "_review")),
    ).resolves.toBe(true);
    await expect(
      existsAsDirectory(join(packageRoot, ".internal", "role-knowledge")),
    ).resolves.toBe(true);
  });

  it("does not remove existing role knowledge files when ensuring structure", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "role-knowledge-dirs-"));
    const packageRoot = join(outputRoot, "ai-knowledge");
    const marker = join(packageRoot, "roles", "pm", "checkout.json");

    await ensureRoleKnowledgeStructure(packageRoot);
    await writeFile(marker, "{\"id\":\"ROLE-PM-checkout\"}\n", "utf-8");
    await ensureRoleKnowledgeStructure(packageRoot);

    await expect(stat(marker)).resolves.toBeDefined();
  });

  it("keeps existing directory initialization behavior separate", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "role-knowledge-dirs-"));
    const packageRoot = join(outputRoot, "ai-knowledge");

    await ensureDirectoryStructure(packageRoot, ["CAPABILITY"]);

    expect(await existsAsDirectory(join(packageRoot, "capabilities"))).toBe(true);
    expect(await existsAsDirectory(join(packageRoot, "roles", "pm"))).toBe(false);
  });
});
