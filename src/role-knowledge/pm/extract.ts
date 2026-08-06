import type { DocumentChunk } from "../chunking.js";
import type { RoleClaim } from "../types.js";

export function extractPmClaims(
  chunks: DocumentChunk[],
  domain?: { domainKey: string; domainName: string },
): RoleClaim[] {
  const now = new Date().toISOString();
  return chunks.map((chunk, index) => ({
    id: `${chunk.id}-pm-${String(index + 1).padStart(3, "0")}`,
    role: "pm",
    domain: {
      domainKey: domain?.domainKey ?? chunk.domain_candidates[0]?.domainKey ?? "unknown",
      domainName: domain?.domainName ?? chunk.domain_candidates[0]?.domainKey ?? "unknown",
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
      notes: ["Derived from a document chunk."],
    },
    tags: ["business_rule"],
    generatedAt: now,
    updatedAt: now,
  }));
}

export function renderPmKnowledge(input: {
  domain: string;
  domainName: string;
  claims: RoleClaim[];
}): string {
  const current = input.claims
    .filter((claim) => claim.status !== "rejected")
    .map((claim) => `- ${claim.claim}`)
    .join("\n");

  return `# ${input.domainName}域 PM 当前口径\n\n## 当前产品口径\n\n${current || "- 暂无"}\n`;
}
