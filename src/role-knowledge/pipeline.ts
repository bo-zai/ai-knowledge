import path from "node:path";
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
  const discovery = await discoverDomains({
    registry,
    knowledgeObjects: [],
    codeSignals: [],
    docSignals: [],
    gitSignals: [],
  });

  const requestedDomains = input.domains.length > 0 ? input.domains : discovery.confirmed.map((item) => item.domainKey);
  const reports: Array<{ domain: string; role: Role; status: string; warnings: string[] }> = [];

  for (const domain of requestedDomains) {
    const domainName = discovery.confirmed.find((item) => item.domainKey === domain)?.domainName ?? domain;
    const doc = createParsedDocument({
      id: `${domain}-doc`,
      path: `${domain}.md`,
      text: `# ${domainName}\n\n${domainName}功能当前口径。`,
    });
    const chunks = buildDocumentChunks({ document: doc });
    if (input.roles.includes("pm")) {
      const claims = extractPmClaims(chunks);
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "pm",
        status: "generated",
        claims,
        currentMarkdown: renderPmKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      upsertRoleKnowledgeRef(registry, {
        domainKey: domain,
        domainName,
        role: "pm",
        indexPath: path.posix.join("roles", "pm", "domains", domain, "index.json"),
        generatedAt: index.generatedAt,
        status: "generated",
      });
      reports.push({ domain, role: "pm", status: "generated", warnings: [] });
    }

    if (input.roles.includes("tech-lead")) {
      const claims = extractTechLeadClaims([{ id: `${domain}-tech`, text: `${domainName}由独立服务处理。`, domain }]);
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "tech-lead",
        status: "generated",
        claims,
        currentMarkdown: renderTechLeadKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      upsertRoleKnowledgeRef(registry, {
        domainKey: domain,
        domainName,
        role: "techLead",
        indexPath: path.posix.join("roles", "tech-lead", "domains", domain, "index.json"),
        generatedAt: index.generatedAt,
        status: "generated",
      });
      reports.push({ domain, role: "tech-lead", status: "generated", warnings: [] });
    }

    if (input.roles.includes("qa")) {
      const claims = extractQaClaims([{ id: `${domain}-qa`, text: `${domainName}需要覆盖主流程、异常流和边界流。`, domain }]);
      const index = await writeRoleKnowledge({
        outputRoot: packageRoot,
        domain,
        domainName,
        role: "qa",
        status: "generated",
        claims,
        currentMarkdown: renderQaKnowledge({ domain, domainName, claims }),
        evolutionMarkdown: "## 演进\n\n暂无",
        evidenceJson: { claims: claims.length },
        reviewMarkdown: "",
        baseKnowledgeRefs: [],
      });
      upsertRoleKnowledgeRef(registry, {
        domainKey: domain,
        domainName,
        role: "qa",
        indexPath: path.posix.join("roles", "qa", "domains", domain, "index.json"),
        generatedAt: index.generatedAt,
        status: "generated",
      });
      reports.push({ domain, role: "qa", status: "generated", warnings: [] });
    }
  }

  await saveDomainRegistry(packageRoot, registry);

  return { reports };
}
