import fs from "node:fs/promises";
import path from "node:path";
import type { Role, RoleClaim, RoleIndex } from "./types.js";

export async function writeRoleKnowledge(input: {
  outputRoot: string;
  domain: string;
  domainName: string;
  role: Role;
  status: "generated" | "partial" | "needs_review" | "blocked";
  claims: RoleClaim[];
  currentMarkdown: string;
  evolutionMarkdown?: string;
  evidenceJson?: unknown;
  reviewMarkdown?: string;
  warnings?: string[];
  baseKnowledgeRefs?: string[];
}): Promise<RoleIndex> {
  const roleRoot = path.join(input.outputRoot, "roles", input.role, "domains", input.domain);
  await fs.mkdir(path.join(roleRoot, "current"), { recursive: true });
  await fs.mkdir(path.join(roleRoot, "evolution"), { recursive: true });
  await fs.mkdir(path.join(roleRoot, "evidence"), { recursive: true });
  await fs.mkdir(path.join(roleRoot, "review"), { recursive: true });

  const now = new Date().toISOString();
  const index: RoleIndex = {
    schemaVersion: "role-knowledge/v1",
    role: input.role,
    status: input.status === "blocked" ? "rejected" : "validated",
    domain: {
      domainKey: input.domain,
      domainName: input.domainName,
      tags: [],
    },
    claims: input.claims,
    generatedAt: now,
    updatedAt: now,
  };

  const readProtocol = {
    schema_version: 1,
    domain: input.domain,
    domain_name: input.domainName,
    role: input.role,
    status: input.status,
    generated_at: now,
    confidence: input.status === "generated" ? "high" : "medium",
    base_knowledge_refs: input.baseKnowledgeRefs ?? [],
    read_profiles: {
      default: ["current/overview.md", "current/rules.md", "current/acceptance.md"],
      trace: ["evolution/timeline.md", "evolution/decisions.md", "evolution/deprecated.md"],
      evidence: ["evidence/claims.jsonl", "evidence/source-report.json"],
      review: ["review/open-questions.md", "review/conflicts.md"],
    },
    warnings: input.warnings ?? [],
    role_index: index,
  };

  await fs.writeFile(path.join(roleRoot, "current", "overview.md"), input.currentMarkdown + "\n", "utf-8");
  await fs.writeFile(path.join(roleRoot, "current", "rules.md"), input.currentMarkdown + "\n", "utf-8");
  await fs.writeFile(path.join(roleRoot, "current", "acceptance.md"), input.currentMarkdown + "\n", "utf-8");
  await fs.writeFile(path.join(roleRoot, "evolution", "timeline.md"), input.evolutionMarkdown ?? "", "utf-8");
  await fs.writeFile(path.join(roleRoot, "evolution", "decisions.md"), input.evolutionMarkdown ?? "", "utf-8");
  await fs.writeFile(path.join(roleRoot, "evolution", "deprecated.md"), input.evolutionMarkdown ?? "", "utf-8");
  await fs.writeFile(path.join(roleRoot, "evidence", "claims.jsonl"), input.claims.map((claim) => JSON.stringify(claim)).join("\n") + "\n", "utf-8");
  await fs.writeFile(path.join(roleRoot, "evidence", "source-report.json"), JSON.stringify(input.evidenceJson ?? { warnings: input.warnings ?? [] }, null, 2) + "\n", "utf-8");
  await fs.writeFile(path.join(roleRoot, "review", "open-questions.md"), input.reviewMarkdown ?? "", "utf-8");
  await fs.writeFile(path.join(roleRoot, "review", "conflicts.md"), input.reviewMarkdown ?? "", "utf-8");
  await fs.writeFile(path.join(roleRoot, "index.json"), JSON.stringify(readProtocol, null, 2) + "\n", "utf-8");

  return index;
}
