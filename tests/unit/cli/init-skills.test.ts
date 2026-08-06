import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skillMocks = vi.hoisted(() => ({
  initializeSkills: vi.fn(),
  getSupportedAgentIds: vi.fn(),
}));

vi.mock("../../../src/skills/index.js", () => skillMocks);

import { runInitSkills } from "../../../src/cli/init-skills.js";

describe("runInitSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    skillMocks.getSupportedAgentIds.mockReturnValue(["claude-code"]);
    skillMocks.initializeSkills.mockResolvedValue({
      agentCount: 1,
      results: [],
      succeeded: 1,
      failed: 0,
      agentsMdUpdated: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a business subagent config when only aliases and paths are provided", async () => {
    await runInitSkills({
      repo: ".",
      businessDomainAliases: "checkout, refund",
      businessDomainPaths: "src/order/**, src/checkout/**",
    });

    expect(skillMocks.initializeSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        businessSubagents: [
          {
            domain: "",
            domainName: "",
            aliases: ["checkout", "refund"],
            paths: ["src/order/**", "src/checkout/**"],
          },
        ],
      }),
      undefined,
    );
  });

  it("passes a business subagent config when a business option is present as an empty string", async () => {
    await runInitSkills({
      repo: ".",
      businessDomain: "",
    });

    expect(skillMocks.initializeSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        businessSubagents: [
          {
            domain: "",
            domainName: "",
            aliases: [],
            paths: [],
          },
        ],
      }),
      undefined,
    );
  });
});
