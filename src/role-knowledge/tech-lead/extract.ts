import type { RoleClaim } from "../types.js";

export function extractTechLeadClaims(
  chunks: Array<{ id: string; text: string; domain: string }>,
): RoleClaim[] {
  const now = new Date().toISOString();
  return chunks.map((chunk, index) => ({
    id: `${chunk.id}-tech-${String(index + 1).padStart(3, "0")}`,
    role: "tech-lead",
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
      notes: ["Derived from code evidence."],
    },
    tags: ["call_flow"],
    generatedAt: now,
    updatedAt: now,
  }));
}
