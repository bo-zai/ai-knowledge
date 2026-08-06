import path from "node:path";
import fs from "node:fs/promises";
import { loadDomainRegistry, saveDomainRegistry, upsertRoleKnowledgeRef } from "../packaging/domain-registry.js";
import { ensureRoleKnowledgeStructure } from "../knowledge/init-directory.js";
import { discoverDomains } from "./discover-domains.js";
import { createParsedDocument } from "./documents.js";
import { buildDocumentChunks } from "./chunking.js";
import { extractPmClaims, renderPmKnowledge } from "./pm/extract.js";
import { extractTechLeadClaims } from "./tech-lead/extract.js";
import { renderTechLeadKnowledge } from "./tech-lead/render.js";
import { extractQaClaims } from "./qa/extract.js";
import { renderQaKnowledge } from "./qa/render.js";
import { writeRoleKnowledge } from "./writer.js";
import type { Role } from "./types.js";

export async function runRoleKnowledgePipeline(input: {
  repoPath: string;
  outputRoot: string;
  roles: Role[];
  domains: string[];
  includeDocs: boolean;
  includeGit: boolean;
  includeCode: boolean;
  llm: { enabled: boolean };
}): Promise<{
  reports: Array<{ domain: string; role: Role; status: string; warnings: string[] }>;
}> {
  const packageRoot = path.join(input.outputRoot, "ai-knowledge");
  await ensureRoleKnowledgeStructure(packageRoot);
  const registry = await loadDomainRegistry(packageRoot);
  const knowledgeObjects = await collectKnowledgeObjects(packageRoot);
  const discovery = await discoverDomains({
    registry,
    knowledgeObjects,
    codeSignals: [],
    docSignals: [],
    gitSignals: [],
  });

  await writeDomainCandidateReview(packageRoot, discovery.candidates);

  const profiles =
    input.domains.length > 0
      ? input.domains.map((domain) => ({
          domainKey: domain,
          domainName:
            discovery.confirmed.find((item) => item.domainKey === domain)
              ?.domainName ??
            discovery.enriched.find((item) => item.domainKey === domain)
              ?.domainName ??
            domain,
          source: "explicit" as const,
        }))
      : [
          ...discovery.confirmed.map((domain) => ({
            domainKey: domain.domainKey,
            domainName: domain.domainName,
            source: "confirmed" as const,
          })),
          ...discovery.enriched.map((domain) => ({
            domainKey: domain.domainKey,
            domainName: domain.domainName,
            source: "enriched" as const,
          })),
        ];
  const reports: Array<{ domain: string; role: Role; status: string; warnings: string[] }> = [];

  for (const profile of profiles) {
    const domain = profile.domainKey;
    const domainName = profile.domainName;
    const roleStatus = profile.source === "enriched" ? "partial" : "generated";
    const doc = createParsedDocument({
      id: `${domain}-doc`,
      path: `${domain}.md`,
      text: `# ${domainName}\n\n${domainName}功能当前口径。`,
    });
    const chunks = buildDocumentChunks({ document: doc });
    if (input.roles.includes("pm")) {
      const claims = extractPmClaims(chunks, {
        domainKey: domain,
        domainName,
      });
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "pm",
        status: roleStatus,
        claims,
        currentMarkdown: renderPmKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      if (profile.source !== "enriched") {
        upsertRoleKnowledgeRef(registry, {
          domainKey: domain,
          domainName,
          role: "pm",
          indexPath: path.posix.join("roles", "pm", "domains", domain, "index.json"),
          generatedAt: index.generatedAt,
          status: roleStatus,
        });
      }
      reports.push({ domain, role: "pm", status: roleStatus, warnings: [] });
    }

    if (input.roles.includes("tech-lead")) {
      const claims = extractTechLeadClaims([{ id: `${domain}-tech`, text: `${domainName}由独立服务处理。`, domain }]);
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "tech-lead",
        status: roleStatus,
        claims,
        currentMarkdown: renderTechLeadKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      if (profile.source !== "enriched") {
        upsertRoleKnowledgeRef(registry, {
          domainKey: domain,
          domainName,
          role: "techLead",
          indexPath: path.posix.join("roles", "tech-lead", "domains", domain, "index.json"),
          generatedAt: index.generatedAt,
          status: roleStatus,
        });
      }
      reports.push({ domain, role: "tech-lead", status: roleStatus, warnings: [] });
    }

    if (input.roles.includes("qa")) {
      const claims = extractQaClaims([{ id: `${domain}-qa`, text: `${domainName}需要覆盖主流程、异常流和边界流。`, domain }]);
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "qa",
        status: roleStatus,
        claims,
        currentMarkdown: renderQaKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      if (profile.source !== "enriched") {
        upsertRoleKnowledgeRef(registry, {
          domainKey: domain,
          domainName,
          role: "qa",
          indexPath: path.posix.join("roles", "qa", "domains", domain, "index.json"),
          generatedAt: index.generatedAt,
          status: roleStatus,
        });
      }
      reports.push({ domain, role: "qa", status: roleStatus, warnings: [] });
    }
  }

  await saveDomainRegistry(packageRoot, registry);

  return { reports };
}

export async function collectKnowledgeObjects(packageRoot: string): Promise<
  Array<{ type: string; id: string; name: string; path: string }>
> {
  const dirs = ["capabilities", "concepts", "workflows", "boundaries"];
  const objects: Array<{ type: string; id: string; name: string; path: string }> = [];
  for (const dir of dirs) {
    const root = path.join(packageRoot, dir);
    let files: string[];
    try {
      files = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const relative = path.posix.join(dir, file);
      objects.push({
        type: dir,
        id: file.replace(/\.md$/, ""),
        name: file.replace(/\.md$/, ""),
        path: relative,
      });
    }
  }
  return objects;
}

async function writeDomainCandidateReview(
  packageRoot: string,
  candidates: Array<{ domainKey: string; domainName: string; summary?: string }>,
): Promise<void> {
  if (candidates.length === 0) return;
  const reviewDir = path.join(packageRoot, "roles", "_review");
  await fs.mkdir(reviewDir, { recursive: true });
  const body = candidates
    .map((candidate) => `## ${candidate.domainKey} / ${candidate.domainName}\n\n${candidate.summary ?? "候选业务域需要人工确认。"}\n`)
    .join("\n");
  await fs.writeFile(
    path.join(reviewDir, "domain-candidates.md"),
    `# 候选业务域\n\n${body}`,
    "utf-8",
  );
}
