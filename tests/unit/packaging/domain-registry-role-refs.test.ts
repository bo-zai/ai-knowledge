import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadDomainRegistry,
  saveDomainRegistry,
  sortDomainRegistry,
  upsertCapabilityDomain,
  upsertRoleKnowledgeRef,
  type DomainRegistry,
} from "../../../src/packaging/domain-registry.js";

describe("domain registry role knowledge refs", () => {
  it("upserts role knowledge refs without replacing existing capability refs", () => {
    const registry: DomainRegistry = {
      updatedAt: "2026-08-06T00:00:00.000Z",
      domains: [],
    };

    upsertCapabilityDomain(registry, {
      domainKey: "checkout",
      domainName: "Checkout",
      capabilityId: "CAP-checkout",
      capabilityName: "Checkout",
      capabilityPath: "capabilities/checkout.md",
    });

    const entry = upsertRoleKnowledgeRef(registry, {
      domainKey: "checkout",
      domainName: "Checkout",
      role: "pm",
      indexPath: "roles/pm/domains/checkout/index.json",
      generatedAt: "2026-08-06T00:00:00.000Z",
      status: "generated",
    });

    expect(entry.capabilityRefs).toHaveLength(1);
    expect(entry.roleKnowledgeRefs?.pm?.indexPath).toBe(
      "roles/pm/domains/checkout/index.json",
    );
  });

  it("updates the same role ref without dropping the domain entry", () => {
    const registry: DomainRegistry = {
      updatedAt: "2026-08-06T00:00:00.000Z",
      domains: [],
    };

    upsertRoleKnowledgeRef(registry, {
      domainKey: "checkout",
      domainName: "Checkout",
      role: "qa",
      indexPath: "roles/qa/domains/checkout/index.json",
      generatedAt: "2026-08-06T00:00:00.000Z",
      status: "partial",
    });
    const entry = upsertRoleKnowledgeRef(registry, {
      domainKey: "checkout",
      domainName: "Checkout",
      role: "qa",
      indexPath: "roles/qa/domains/checkout/index.json",
      generatedAt: "2026-08-06T01:00:00.000Z",
      status: "blocked",
      confidence: "high",
    });

    expect(registry.domains).toHaveLength(1);
    expect(entry.roleKnowledgeRefs?.qa?.generatedAt).toBe(
      "2026-08-06T01:00:00.000Z",
    );
    expect(entry.roleKnowledgeRefs?.qa?.status).toBe("blocked");
  });

  it("persists and loads optional role knowledge refs", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "role-registry-"));
    const registry: DomainRegistry = {
      updatedAt: "2026-08-06T00:00:00.000Z",
      domains: [],
    };

    upsertRoleKnowledgeRef(registry, {
      domainKey: "checkout",
      domainName: "Checkout",
      role: "techLead",
      indexPath: "roles/tech-lead/domains/checkout/index.json",
      generatedAt: "2026-08-06T00:00:00.000Z",
      status: "generated",
    });
    await saveDomainRegistry(packageRoot, sortDomainRegistry(registry));

    const raw = await readFile(
      join(packageRoot, ".internal", "domain-registry.json"),
      "utf-8",
    );
    const loaded = await loadDomainRegistry(packageRoot);

    expect(raw).toContain("roleKnowledgeRefs");
    expect(loaded.domains[0].roleKnowledgeRefs?.techLead?.indexPath).toContain(
      "roles/tech-lead/domains/checkout/index.json",
    );
  });
});
