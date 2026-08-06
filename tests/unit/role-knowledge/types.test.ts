import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Confidence,
  DomainProfile,
  Role,
  RoleClaim,
  RoleIndex,
  RoleKnowledgeRef,
  RoleKnowledgeStatus,
} from "../../../src/role-knowledge/types.js";
import {
  roleClaimSchema,
  roleIndexSchema,
  type RoleClaimInput,
  type RoleIndexInput,
} from "../../../src/role-knowledge/schemas.js";

const domain: DomainProfile = {
  domainKey: "checkout",
  domainName: "Checkout",
  summary: "Checkout domain",
  tags: [],
};

const claim: RoleClaim = {
  id: "role-claim-checkout-validation",
  role: "pm",
  status: "draft",
  confidence: "medium",
  claim: "Checkout requires visible payment and fulfillment validation.",
  domain,
  sourceRefs: [
    {
      kind: "file",
      path: "src/checkout/checkout-service.ts",
      symbol: "CheckoutService",
      lineStart: 12,
      lineEnd: 44,
    },
  ],
  knowledgeRefs: [
    {
      objectId: "CAP-checkout",
      objectType: "CAP",
      path: "capabilities/checkout.md",
    },
  ],
  roleRefs: [
    {
      role: "qa",
      domain: "checkout",
      path: "roles/qa/domains/checkout/index.json",
      relation: "supports",
    },
  ],
  relations: [
    {
      relation: "supports",
      targetClaimId: "role-claim-payment-validation",
    },
  ],
  validation: {
    status: "unvalidated",
    notes: ["Needs PM review"],
  },
  tags: ["checkout", "payment"],
};

describe("role knowledge foundational types", () => {
  it("exports stable role, status, confidence, and ref unions", () => {
    expectTypeOf<Role>().toEqualTypeOf<
      "pm" | "tech-lead" | "qa" | "review"
    >();
    expectTypeOf<RoleKnowledgeStatus>().toEqualTypeOf<
      "draft" | "validated" | "rejected" | "stale"
    >();
    expectTypeOf<Confidence>().toEqualTypeOf<"low" | "medium" | "high">();
    expectTypeOf<RoleKnowledgeRef>().toMatchTypeOf<{
      indexPath?: string;
      generatedAt?: string;
    }>();
  });

  it("parses a role claim with source, knowledge, role, and validation refs", () => {
    const parsed = roleClaimSchema.parse(claim);

    expect(parsed.role).toBe("pm");
    expect(parsed.sourceRefs[0].kind).toBe("file");
    expect(parsed.knowledgeRefs[0].objectType).toBe("CAP");
    expect(parsed.roleRefs[0].relation).toBe("supports");
    expect(parsed.validation.status).toBe("unvalidated");
  });

  it("parses a role index composed of role claims", () => {
    const index: RoleIndex = {
      schemaVersion: "role-knowledge/v1",
      role: "pm",
      status: "draft",
      domain,
      claims: [claim],
      generatedAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };

    const parsed = roleIndexSchema.parse(index);

    expect(parsed.schemaVersion).toBe("role-knowledge/v1");
    expect(parsed.claims).toHaveLength(1);
    expectTypeOf<RoleClaimInput>().toEqualTypeOf<RoleClaim>();
    expectTypeOf<RoleIndexInput>().toEqualTypeOf<RoleIndex>();
  });

  it("rejects invalid role values at schema boundaries", () => {
    expect(() =>
      roleClaimSchema.parse({
        ...claim,
        role: "architect",
      }),
    ).toThrow();
  });
});
