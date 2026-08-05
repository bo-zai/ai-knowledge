import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_CODE_AGENT } from "../../../src/skills/agents/claude-code.js";
import type {
  Agent,
  SkillInitConfig,
} from "../../../src/skills/agents/types.js";

const claudeCodeAgent = CLAUDE_CODE_AGENT as Agent & {
  generateAgentsMd(
    repoPath: string,
    config?: SkillInitConfig,
  ): Promise<string | null>;
};

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
          domain: "Order_Service",
          domainName: "订单",
          aliases: ["checkout", "refund"],
          paths: ["src/order/**"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-service-pm.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-service-tech-lead.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-service-qa.md",
    );
    await expect(
      fs.access(path.join(repoPath, ".claude", "agents", "order-service-pm.md")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(repoPath, ".claude", "agents", "order-service-tech-lead.md"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(repoPath, ".claude", "agents", "order-service-qa.md")),
    ).resolves.toBeUndefined();
  });

  it("reports not initialized when requested business subagents are missing", async () => {
    await CLAUDE_CODE_AGENT.initialize({ repoPath });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "Order_Service", domainName: "订单" }],
    });

    expect(initialized).toBe(false);
  });

  it("reports initialized when requested business subagents exist", async () => {
    await CLAUDE_CODE_AGENT.initialize({
      repoPath,
      businessSubagents: [{ domain: "Order_Service", domainName: "订单" }],
    });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "Order_Service", domainName: "订单" }],
    });

    expect(initialized).toBe(true);
  });

  it("appends CLAUDE.md orchestration rules once", async () => {
    await fs.writeFile(path.join(repoPath, "CLAUDE.md"), "# Existing\n", "utf-8");

    const first = await claudeCodeAgent.generateAgentsMd(repoPath, {
      repoPath,
      businessSubagents: [
        { domain: "order", domainName: "订单" },
        { domain: "payment", domainName: "支付" },
      ],
    });
    const second = await claudeCodeAgent.generateAgentsMd(repoPath, {
      repoPath,
      businessSubagents: [
        { domain: "order", domainName: "订单" },
        { domain: "payment", domainName: "支付" },
      ],
    });

    expect(first).toContain("业务域 Agent 协作规则：订单（order）");
    expect(first).toContain("业务域 Agent 协作规则：支付（payment）");
    expect(second).toBeNull();

    const content = await fs.readFile(path.join(repoPath, "CLAUDE.md"), "utf-8");
    expect(content.match(/业务域 Agent 协作规则：订单（order）/g)).toHaveLength(1);
    expect(content.match(/业务域 Agent 协作规则：支付（payment）/g)).toHaveLength(
      1,
    );
  });
});
