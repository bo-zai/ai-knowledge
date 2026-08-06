import type { RoleClaim } from "../types.js";

export function renderQaKnowledge(input: {
  domain: string;
  domainName: string;
  claims: RoleClaim[];
}): string {
  const items = input.claims
    .filter((claim) => claim.status !== "rejected")
    .map((claim) => `- ${claim.claim}`)
    .join("\n");
  return `# ${input.domainName}域测试视图\n\n## 当前测试策略\n\n${items || "- 暂无"}\n`;
}
