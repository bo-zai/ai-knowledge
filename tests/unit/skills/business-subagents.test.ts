import { describe, expect, it } from "vitest";
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
    expect(config.aliases).toEqual(["checkout", "refund"]);
    expect(config.paths).toEqual(["src/order/**", "src/checkout/**"]);
  });
});
