import { describe, expect, it } from "vitest";
import { buildRoleKnowledgeCommand } from "../../../src/cli/role-knowledge.js";

describe("role-knowledge cli", () => {
  it("registers discover-domains, generate, and status subcommands", () => {
    const command = buildRoleKnowledgeCommand();
    expect(command.commands.some((sub) => sub.name() === "discover-domains")).toBe(true);
    expect(command.commands.some((sub) => sub.name() === "generate")).toBe(true);
    expect(command.commands.some((sub) => sub.name() === "status")).toBe(true);
  });
});
