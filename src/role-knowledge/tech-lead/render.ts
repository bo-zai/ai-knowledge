import type { RoleClaim } from "../types.js";

export function renderTechLeadKnowledge(input: {
  domain: string;
  domainName: string;
  claims: RoleClaim[];
}): string {
  const items = input.claims
    .filter((claim) => claim.status !== "rejected")
    .map((claim) => `- ${claim.claim}`)
    .join("\n");
  return `# ${input.domainName}域技术视图\n\n## 当前实现\n\n${items || "- 暂无"}\n`;
}
