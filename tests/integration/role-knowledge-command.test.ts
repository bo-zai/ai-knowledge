import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

describe("role knowledge command", () => {
  it("generates pm role knowledge from an existing domain registry", async () => {
    const repo = await mkdtemp(join(tmpdir(), "role-knowledge-cli-"));
    const internal = join(repo, "ai-knowledge", ".internal");
    await mkdir(internal, { recursive: true });
    await writeFile(
      join(internal, "domain-registry.json"),
      JSON.stringify(
        {
          updatedAt: "2026-08-06T00:00:00.000Z",
          domains: [
            { domainKey: "order", domainName: "订单", capabilityRefs: [] },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await execa("node", [
      "dist/cli/index.js",
      "role-knowledge",
      "generate",
      "--repo",
      repo,
      "--role",
      "pm",
    ]);

    const index = await readFile(
      join(repo, "ai-knowledge", "roles", "pm", "domains", "order", "index.json"),
      "utf-8",
    );
    const registry = await readFile(
      join(repo, "ai-knowledge", ".internal", "domain-registry.json"),
      "utf-8",
    );

    expect(result.stdout).toContain("order pm generated");
    expect(index).toContain("read_profiles");
    expect(index).toContain('"status": "generated"');
    expect(registry).toContain("roleKnowledgeRefs");
  });
});
