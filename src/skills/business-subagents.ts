import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BusinessSubagentInitConfig,
  SkillFile,
} from "./agents/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type NormalizedBusinessSubagentConfig =
  Required<BusinessSubagentInitConfig>;

const TEMPLATE_DIR_CANDIDATES = [
  path.join(__dirname, "templates", "business-subagents"),
  path.join(__dirname, "..", "skills", "templates", "business-subagents"),
] as const;

let resolvedTemplateDir: string | null = null;

const TEMPLATE_NAMES = {
  pm: "pm.md",
  techLead: "tech-lead.md",
  qa: "qa.md",
  claudeSection: "claude-section.md",
} as const;

export function normalizeBusinessSubagentConfig(
  input: BusinessSubagentInitConfig,
): NormalizedBusinessSubagentConfig {
  const domain = normalizeDomain(input.domain);
  const domainName = input.domainName.trim();

  if (!domain) {
    throw new Error("business domain is required");
  }
  if (!domainName) {
    throw new Error("business domain name is required");
  }

  return {
    domain,
    domainName,
    aliases: normalizeList(input.aliases),
    paths: normalizeList(input.paths),
  };
}

export async function renderBusinessSubagentFiles(
  input: BusinessSubagentInitConfig,
): Promise<SkillFile[]> {
  const config = normalizeBusinessSubagentConfig(input);
  const [pmTemplate, techLeadTemplate, qaTemplate] = await Promise.all([
    loadBusinessSubagentTemplate(TEMPLATE_NAMES.pm),
    loadBusinessSubagentTemplate(TEMPLATE_NAMES.techLead),
    loadBusinessSubagentTemplate(TEMPLATE_NAMES.qa),
  ]);

  return [
    {
      name: `${config.domain}-pm`,
      filename: `.claude/agents/${config.domain}-pm.md`,
      content: renderTemplate(pmTemplate, config),
    },
    {
      name: `${config.domain}-tech-lead`,
      filename: `.claude/agents/${config.domain}-tech-lead.md`,
      content: renderTemplate(techLeadTemplate, config),
    },
    {
      name: `${config.domain}-qa`,
      filename: `.claude/agents/${config.domain}-qa.md`,
      content: renderTemplate(qaTemplate, config),
    },
  ];
}

export async function renderClaudeBusinessAgentSection(
  input: BusinessSubagentInitConfig,
): Promise<string> {
  const config = normalizeBusinessSubagentConfig(input);
  const template = await loadBusinessSubagentTemplate(
    TEMPLATE_NAMES.claudeSection,
  );

  return renderTemplate(template, config);
}

export function getBusinessSubagentDiskPath(
  repoPath: string,
  filename: string,
): string {
  const normalized = toSafeRelativePath(filename);
  return path.join(repoPath, normalized);
}

async function loadBusinessSubagentTemplate(filename: string): Promise<string> {
  const templateDir = await getBusinessSubagentTemplateDir();
  const templatePath = path.join(templateDir, filename);
  return fs.readFile(templatePath, "utf-8");
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .replaceAll("_", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeList(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).map((value) => value.trim()).filter(Boolean),
    ),
  ];
}

function renderTemplate(
  template: string,
  config: NormalizedBusinessSubagentConfig,
): string {
  const keywords = [config.domainName, config.domain, ...config.aliases].join(
    "、",
  );
  const paths =
    config.paths.length > 0 ? config.paths.join("、") : "未配置固定路径";

  return template
    .replaceAll("{{domain}}", config.domain)
    .replaceAll("{{domainName}}", config.domainName)
    .replaceAll("{{keywords}}", keywords)
    .replaceAll("{{paths}}", paths);
}

async function getBusinessSubagentTemplateDir(): Promise<string> {
  if (resolvedTemplateDir) {
    return resolvedTemplateDir;
  }

  for (const templateDir of TEMPLATE_DIR_CANDIDATES) {
    try {
      await fs.access(templateDir);
      resolvedTemplateDir = templateDir;
      return templateDir;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("business subagent templates are missing");
}

function toSafeRelativePath(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error("unsafe business subagent path");
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => segment === "..")) {
    throw new Error("unsafe business subagent path");
  }

  return segments.filter((segment) => segment.length > 0).join(path.sep);
}
