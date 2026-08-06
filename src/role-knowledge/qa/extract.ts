import type { RoleClaim } from "../types.js";

export function extractQaClaims(
  chunks: Array<{ id: string; text: string; domain: string }>,
): RoleClaim[] {
  const now = new Date().toISOString();
  return chunks.map((chunk, index) => ({
    id: `${chunk.id}-qa-${String(index + 1).padStart(3, "0")}`,
    role: "qa",
    domain: {
      domainKey: chunk.domain,
      domainName: chunk.domain,
      tags: [],
    },
    claim: chunk.text.trim(),
    status: "draft",
    confidence: "medium",
    sourceRefs: [],
    knowledgeRefs: [],
    roleRefs: [],
    relations: [],
    validation: {
      status: "unvalidated",
      notes: ["Derived from PM rules and implementation risk."],
    },
    tags: ["boundary_case"],
    generatedAt: now,
    updatedAt: now,
  }));
}
