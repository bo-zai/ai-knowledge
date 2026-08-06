import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { execa, type ExecaError } from "execa";
import { runInitSkills } from "../../src/cli/init-skills.js";

const BUSINESS_DOMAIN_ARGS = [
  "init-skills",
  "--agents",
  "claude-code",
  "--business-domain",
  "order",
  "--business-domain-name",
  "订单",
  "--business-domain-aliases",
  "checkout,refund",
  "--business-domain-paths",
  "src/order/**,src/checkout/**",
] as const;

const EXPECTED_AGENT_FILES = [
  ".claude/agents/order-pm.md",
  ".claude/agents/order-tech-lead.md",
  ".claude/agents/order-qa.md",
] as const;

describe("init-skills business subagents", () => {
  it("creates Claude business subagents through the built CLI", async () => {
    const repo = await createTempRepo();

    try {
      const result = await runBuiltCli(repo);

      if (result.blockedByNativeModule) {
        return;
      }

      for (const filename of EXPECTED_AGENT_FILES) {
        expect(result.stdout).toContain(filename);
        await expect(fileExists(repo, filename)).resolves.toBe(true);
      }

      await expectFileContents(repo);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it("creates Claude business subagents through runInitSkills", async () => {
    const repo = await createTempRepo();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await runInitSkills({
        repo,
        agents: "claude-code",
        businessDomain: "order",
        businessDomainName: "订单",
        businessDomainAliases: "checkout,refund",
        businessDomainPaths: "src/order/**,src/checkout/**",
      });

      for (const filename of EXPECTED_AGENT_FILES) {
        await expect(fileExists(repo, filename)).resolves.toBe(true);
      }

      await expectFileContents(repo);
    } finally {
      logSpy.mockRestore();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it("updates CLAUDE.md on a rerun when business subagent files already exist", async () => {
    const repo = await createTempRepo();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await runInitSkills({
        repo,
        agents: "claude-code",
        businessDomain: "order",
        businessDomainName: "订单",
        updateAgentsMd: false,
      });

      await expect(fileExists(repo, "CLAUDE.md")).resolves.toBe(false);

      await runInitSkills({
        repo,
        agents: "claude-code",
        businessDomain: "order",
        businessDomainName: "订单",
      });

      const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf-8");
      expect(claudeMd).toContain("业务域 Agent 协作规则：订单（order）");
    } finally {
      logSpy.mockRestore();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});

describe("isKnownNativeModuleBlocker", () => {
  it("matches the known Ladybug native module load failure", () => {
    expect(
      isKnownNativeModuleBlocker({
        message:
          "Error: ERR_DLOPEN_FAILED at @ladybugdb/core lbug_native.js lbugjs.node",
      }),
    ).toBe(true);
  });

  it("does not match unrelated native module load failures", () => {
    expect(
      isKnownNativeModuleBlocker({
        message: "Error: ERR_DLOPEN_FAILED at unrelated-native.node",
      }),
    ).toBe(false);
  });
});

async function runBuiltCli(repo: string) {
  try {
    const result = await execa("node", [
      "dist/cli/index.js",
      ...BUSINESS_DOMAIN_ARGS,
      "--repo",
      repo,
    ]);
    return {
      stdout: result.stdout,
      blockedByNativeModule: false,
    };
  } catch (error) {
    if (isKnownNativeModuleBlocker(error)) {
      console.warn(
        "Skipping built CLI assertions because @ladybugdb/core native module loading failed before init-skills executed.",
      );
      return {
        stdout: "",
        blockedByNativeModule: true,
      };
    }

    throw error;
  }
}

async function expectFileContents(repo: string): Promise<void> {
  const pm = await fs.readFile(
    path.join(repo, ".claude", "agents", "order-pm.md"),
    "utf-8",
  );
  expect(pm).toContain("name: order-pm");
  expect(pm).toContain("你是 订单 的 PM agent。");

  const techLead = await fs.readFile(
    path.join(repo, ".claude", "agents", "order-tech-lead.md"),
    "utf-8",
  );
  expect(techLead).toContain("name: order-tech-lead");
  expect(techLead).toContain("- role: tech");

  const qa = await fs.readFile(
    path.join(repo, ".claude", "agents", "order-qa.md"),
    "utf-8",
  );
  expect(qa).toContain("name: order-qa");
  expect(qa).toContain("- role: qa");

  const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf-8");
  expect(claudeMd).toContain("业务域 Agent 协作规则：订单（order）");
  expect(claudeMd).toContain("checkout");
  expect(claudeMd).toContain("refund");
  expect(claudeMd).toContain("src/order/**");
  expect(claudeMd).toContain("src/checkout/**");
}

async function createTempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "init-skills-subagents-"));
}

async function fileExists(repo: string, filename: string): Promise<boolean> {
  try {
    await fs.access(path.join(repo, ...filename.split("/")));
    return true;
  } catch {
    return false;
  }
}

function isKnownNativeModuleBlocker(error: unknown): boolean {
  const execaError = error as ExecaError;
  const output = [
    execaError.message,
    execaError.stdout,
    execaError.stderr,
    execaError.shortMessage,
  ]
    .filter(Boolean)
    .join("\n");

  const hasKnownModuleIdentity =
    output.includes("@ladybugdb") || output.includes("lbug");
  const hasNativeLoadFailureSignal =
    output.includes("ERR_DLOPEN_FAILED") ||
    output.includes("lbugjs.node") ||
    output.includes("lbug_native") ||
    output.includes("process.dlopen");

  return hasKnownModuleIdentity && hasNativeLoadFailureSignal;
}
