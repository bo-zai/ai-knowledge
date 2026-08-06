import { describe, expect, it } from "vitest";
import { discoverDomains } from "../../../src/role-knowledge/discover-domains.js";

describe("discoverDomains", () => {
  it("prefers registry domains and marks unregistered candidates as low confidence", async () => {
    const result = await discoverDomains({
      registry: {
        updatedAt: "2026-08-06T10:00:00+08:00",
        domains: [
          { domainKey: "order", domainName: "订单", capabilityRefs: [] },
        ],
      },
      knowledgeObjects: [
        { type: "capability", id: "cap-order-cancel", name: "订单取消", path: "capabilities/order-cancel.md" },
      ],
      codeSignals: [],
      docSignals: [
        { domainKey: "payment", domainName: "支付", reason: "需求文档中出现支付域" },
      ],
      gitSignals: [],
    });
    expect(result.confirmed.some((d) => d.domainKey === "order")).toBe(true);
    expect(result.candidates.some((d) => d.domainKey === "payment")).toBe(true);
  });
});
