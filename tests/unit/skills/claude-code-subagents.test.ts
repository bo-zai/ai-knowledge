import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_CODE_AGENT } from "../../../src/skills/agents/claude-code.js";

describe("Claude Code business subagent initialization", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "rkg-subagents-"));
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("writes PM, technical lead, and QA subagents", async () => {
    const result = await CLAUDE_CODE_AGENT.initialize({
      repoPath,
      businessSubagents: [
        {
          domain: "order",
          domainName: "订单",
          aliases: ["checkout", "refund"],
          paths: ["src/order/**"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-pm.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-tech-lead.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-qa.md",
    );

    const pm = await fs.readFile(
      path.join(repoPath, ".claude", "agents", "order-pm.md"),
      "utf-8",
    );
    const techLead = await fs.readFile(
      path.join(repoPath, ".claude", "agents", "order-tech-lead.md"),
      "utf-8",
    );
    const qa = await fs.readFile(
      path.join(repoPath, ".claude", "agents", "order-qa.md"),
      "utf-8",
    );
    expect(pm).toContain("name: order-pm");
    expect(pm).toContain("你是 订单 的 PM agent。");
    expect(techLead).toContain("- role: tech");
    expect(qa).toContain("- role: qa");
  });

  it("reports not initialized when requested business subagents are missing", async () => {
    await CLAUDE_CODE_AGENT.initialize({ repoPath });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(initialized).toBe(false);
  });

  it("reports initialized when requested business subagents exist", async () => {
    await CLAUDE_CODE_AGENT.initialize({
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(initialized).toBe(true);
  });

  it("appends CLAUDE.md orchestration rules once", async () => {
    await fs.writeFile(path.join(repoPath, "CLAUDE.md"), "# Existing\n", "utf-8");

    const first = await CLAUDE_CODE_AGENT.generateAgentsMd(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });
    const second = await CLAUDE_CODE_AGENT.generateAgentsMd(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(first).toContain("业务域 Agent 协作规则：订单（order）");
    expect(second).toBeNull();

    const content = await fs.readFile(path.join(repoPath, "CLAUDE.md"), "utf-8");
    expect(content.match(/业务域 Agent 协作规则：订单（order）/g)).toHaveLength(1);
  });
});
