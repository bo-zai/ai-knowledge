import { describe, expect, it } from "vitest";
import { buildRouteEvidence } from "../../../src/evidence/route-evidence";

describe("buildRouteEvidence", () => {
  it("creates slice evidence bundle for route", () => {
    const bundle = buildRouteEvidence({
      route: "GET /api/users",
      handler_file: "src/routes/users.ts",
      response_keys: ["id", "name"],
      error_keys: ["error", "message"],
      middleware: ["auth"],
    });
    expect(bundle.slice.kind).toBe("route");
    expect(bundle.slice.id).toBe("route:GET /api/users");
    expect(bundle.facts.length).toBeGreaterThanOrEqual(1);
  });

  it("propagates middleware as symbols", () => {
    const bundle = buildRouteEvidence({
      route: "POST /api/orders",
      handler_file: "src/routes/orders.ts",
      response_keys: ["orderId"],
      error_keys: ["error"],
      middleware: ["auth", "validator", "rate-limiter"],
    });

    // 检查 middleware 事实
    const mwFact = bundle.facts.find((f) => f.id === "F-004");
    expect(mwFact).toBeDefined();
    expect(mwFact?.claim).toContain("auth");

    // 检查 middleware 符号
    const mwSymbols = bundle.symbols.filter((s) => s.role === "middleware");
    expect(mwSymbols).toHaveLength(3);
  });

  it("emits gap when response shape is missing", () => {
    const bundle = buildRouteEvidence({
      route: "GET /api/unknown",
      handler_file: "src/routes/unknown.ts",
      response_keys: [],
      error_keys: ["error"],
      middleware: [],
    });

    expect(bundle.gaps).toHaveLength(1);
    expect(bundle.gaps[0].kind).toBe("missing-response-shape");
    expect(bundle.gaps[0].question).toContain("响应结构");
  });

  it("includes handler symbol with role", () => {
    const bundle = buildRouteEvidence({
      route: "DELETE /api/users/:id",
      handler_file: "src/routes/users.ts",
      response_keys: ["success"],
      error_keys: ["error"],
      middleware: [],
    });

    const handlerSymbol = bundle.symbols.find((s) => s.role === "handler");
    expect(handlerSymbol).toBeDefined();
    expect(handlerSymbol?.kind).toBe("function");
  });
});
