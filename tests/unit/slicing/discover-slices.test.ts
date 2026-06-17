import { describe, expect, it } from "vitest";
import { discoverSlices } from "../../../src/slicing/discover-slices";

describe("discoverSlices", () => {
  it("maps routes to slices", () => {
    const slices = discoverSlices({
      routes: ["GET /api/users"],
      processes: [],
      tools: [],
      communities: [],
      tables: [],
    });
    expect(slices).toHaveLength(1);
    expect(slices[0].kind).toBe("route");
    expect(slices[0].id).toBe("route:GET /api/users");
  });
});
