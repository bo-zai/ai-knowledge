import { describe, expect, it } from "vitest";
import {
  getExpectedBusinessSubagentFilenames,
  getBusinessSubagentDiskPath,
  normalizeBusinessSubagentConfig,
  renderBusinessSubagentFiles,
  renderClaudeBusinessAgentSection,
} from "../../../src/skills/business-subagents.js";
import type { BusinessSubagentInitConfig } from "../../../src/skills/agents/types.js";

describe("business subagent config types", () => {
  it("allows one business domain config with optional aliases and paths", () => {
    const config: BusinessSubagentInitConfig = {
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**", "src/checkout/**"],
    };

    expect(config.domain).toBe("order");
    expect(config.domainName).toBe("订单");
  });
});

describe("business subagent rendering", () => {
  it("normalizes domain id, aliases, and paths", () => {
    const config = normalizeBusinessSubagentConfig({
      domain: "Order_Service",
      domainName: "订单",
      aliases: [" checkout ", "", "refund", "checkout"],
      paths: [" src/order/** ", "", "src/order/**"],
    });

    expect(config.domain).toBe("order-service");
    expect(config.domainName).toBe("订单");
    expect(config.aliases).toEqual(["checkout", "refund"]);
    expect(config.paths).toEqual(["src/order/**"]);
  });

  it("renders three Claude Code subagent files", async () => {
    const files = await renderBusinessSubagentFiles({
      domain: "Order_Service",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**"],
    });

    expect(files).toHaveLength(3);
    expect(files.map((file) => file.filename)).toEqual([
      ".claude/agents/order-service-pm.md",
      ".claude/agents/order-service-tech-lead.md",
      ".claude/agents/order-service-qa.md",
    ]);
    expect(files[0]?.content).toContain("name: order-service-pm");
    expect(files[0]?.content).toContain("你是 订单 的 PM agent。");
    expect(files[0]?.content).not.toContain("mcp__business_knowledge");
    expect(files[1]?.content).toContain("role: tech");
    expect(files[1]?.content).not.toContain("mcp__business_knowledge");
    expect(files[2]?.content).toContain("role: qa");
    expect(files[2]?.content).not.toContain("mcp__business_knowledge");
  });

  it("builds expected Claude Code subagent filenames", () => {
    expect(
      getExpectedBusinessSubagentFilenames({
        domain: "Order_Service",
        domainName: "订单",
      }),
    ).toEqual([
      ".claude/agents/order-service-pm.md",
      ".claude/agents/order-service-tech-lead.md",
      ".claude/agents/order-service-qa.md",
    ]);
  });

  it("renders CLAUDE.md orchestration rules for a domain", async () => {
    const section = await renderClaudeBusinessAgentSection({
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**"],
    });

    expect(section).toContain("## 业务域 Agent 协作规则");
    expect(section).toContain("order-pm");
    expect(section).toContain("order-tech-lead");
    expect(section).toContain("order-qa");
    expect(section).toContain("checkout");
    expect(section).toContain("src/order/**");
  });

  it("rejects an empty domain", () => {
    expect(() =>
      normalizeBusinessSubagentConfig({
        domain: "",
        domainName: "订单",
      }),
    ).toThrow("business domain is required");
  });

  it("rejects an empty domain name", () => {
    expect(() =>
      normalizeBusinessSubagentConfig({
        domain: "order",
        domainName: "",
      }),
    ).toThrow("business domain name is required");
  });

  it("rejects unsafe disk paths", () => {
    const repoPath = "D:\\workspace\\repo";

    expect(() =>
      getBusinessSubagentDiskPath(repoPath, "..\\evil.md"),
    ).toThrow("unsafe business subagent path");
    expect(() =>
      getBusinessSubagentDiskPath(repoPath, "C:\\evil.md"),
    ).toThrow("unsafe business subagent path");
    expect(() =>
      getBusinessSubagentDiskPath(repoPath, "\\\\server\\share\\evil.md"),
    ).toThrow("unsafe business subagent path");
  });
});
