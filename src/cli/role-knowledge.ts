import { Command } from "commander";
import path from "node:path";
import { DEFAULT_KNOWLEDGE_DIR } from "../config/defaults.js";
import { loadDomainRegistry } from "../packaging/domain-registry.js";
import { buildRoleKnowledgeReport } from "../role-knowledge/reports.js";
import { runRoleKnowledgePipeline } from "../role-knowledge/pipeline.js";

export function buildRoleKnowledgeCommand(): Command {
  const command = new Command("role-knowledge").description(
    "Generate PM, tech-lead, and QA role knowledge from ai-knowledge",
  );

  command
    .command("discover-domains")
    .option("--repo <path>", "Target repository path")
    .action(async (options) => {
      const repoPath = options.repo ?? process.cwd();
      const registry = await loadDomainRegistry(
        path.join(repoPath, DEFAULT_KNOWLEDGE_DIR),
      );
      for (const domain of registry.domains) {
        console.log(`${domain.domainKey}\t${domain.domainName}`);
      }
    });

  command
    .command("generate")
    .option("--repo <path>", "Target repository path")
    .option("--role <role>", "Role to generate")
    .option("--domains <domains>", "Comma-separated domain list")
    .option("--with-docs", "Include documents")
    .option("--include-git", "Include git evidence")
    .option("--include-code", "Include code evidence")
    .action(async (options) => {
      const roles = options.role
        ? [options.role]
        : ["pm", "tech-lead", "qa"];
      const domains = options.domains
        ? String(options.domains)
            .split(",")
            .map((item: string) => item.trim())
            .filter(Boolean)
        : [];
      const result = await runRoleKnowledgePipeline({
        repoPath: options.repo ?? process.cwd(),
        outputRoot: options.repo ?? process.cwd(),
        roles: roles as Array<"pm" | "tech-lead" | "qa">,
        domains,
        includeDocs: Boolean(options.withDocs),
        includeGit: Boolean(options.includeGit),
        includeCode: Boolean(options.includeCode),
        llm: { enabled: false },
      });
      console.log(buildRoleKnowledgeReport(result.reports));
    });

  command
    .command("status")
    .option("--repo <path>", "Target repository path")
    .action(async (options) => {
      const repoPath = options.repo ?? process.cwd();
      const registry = await loadDomainRegistry(
        path.join(repoPath, DEFAULT_KNOWLEDGE_DIR),
      );
      for (const domain of registry.domains) {
        const refs = domain.roleKnowledgeRefs;
        if (!refs) {
          console.log(`${domain.domainKey}\tno-role-knowledge`);
          continue;
        }
        console.log(
          [
            domain.domainKey,
            refs.pm?.status ? `pm:${refs.pm.status}` : "pm:missing",
            refs.techLead?.status
              ? `tech-lead:${refs.techLead.status}`
              : "tech-lead:missing",
            refs.qa?.status ? `qa:${refs.qa.status}` : "qa:missing",
          ].join("\t"),
        );
      }
    });

  return command;
}
