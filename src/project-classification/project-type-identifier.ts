import { logger } from "../shared/logger.js";
import { PromptLoader } from "../shared/prompt-loader.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import { callLlmForJson } from "../generation/llm-json-client.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import type {
  ProjectTypeEvidence,
  ProjectTypeIdentificationResult,
  RepositoryClassificationContext,
} from "./types.js";

export async function identifyProjectType(
  evidence: ProjectTypeEvidence,
  claimsProvider: LlmClaimsProvider,
  timeout?: number,
): Promise<ProjectTypeIdentificationResult> {
  const promptTemplate = PromptLoader.load("project-type-identifier");
  const userPrompt = JSON.stringify(
    {
      directory_tree: evidence.directoryTree,
      config_files: evidence.configFiles,
      entry_candidates: evidence.entryCandidates,
      readme_snippet: evidence.readmeSnippet || "",
      dependencies: evidence.dependencies.slice(0, 30),
    },
    null,
    2,
  );

  logger.debug("Identifying project type with LLM...");

  const result = await callLlmForJson<ProjectTypeIdentificationResult>({
    systemPrompt: promptTemplate.raw,
    userPrompt,
    claimsProvider,
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      directoryTree: evidence.directoryTree,
      configFiles: evidence.configFiles,
      dependencies: evidence.dependencies.slice(0, 30),
    },
    logLabel: "Project type identification",
  });

  if (!result.success || !result.data) {
    logger.warn("Project type identification failed, using fallback");
    return inferProjectTypeFromEvidence(evidence);
  }

  const context = buildClassificationBase(result.data);
  return {
    projectType: context.projectType,
    primaryLanguage: context.primaryLanguage,
    framework: context.framework,
    techStack: context.techStack,
    confidence: context.confidence,
    identificationEvidence: context.identificationEvidence,
  };
}

export function buildClassificationBase(
  result: ProjectTypeIdentificationResult | Record<string, unknown>,
): Pick<
  RepositoryClassificationContext,
  | "projectType"
  | "primaryLanguage"
  | "framework"
  | "techStack"
  | "confidence"
  | "identificationEvidence"
> {
  const raw = result as Record<string, unknown>;
  return {
    projectType:
      ((raw.projectType ??
        raw.project_type) as RepositoryClassificationContext["projectType"]) ??
      "unknown",
    primaryLanguage:
      ((raw.primaryLanguage ??
        raw.primary_language) as RepositoryClassificationContext["primaryLanguage"]) ??
      "other",
    framework: raw.framework as string | undefined,
    techStack: ((raw.techStack ?? raw.tech_stack) as string[]) ?? [],
    confidence: (raw.confidence as number) ?? 0.5,
    identificationEvidence:
      ((raw.identificationEvidence ??
        raw.identification_evidence) as string[]) ?? [],
  };
}

function inferProjectTypeFromEvidence(
  evidence: ProjectTypeEvidence,
): ProjectTypeIdentificationResult {
  const tree = evidence.directoryTree.toLowerCase();
  const deps = evidence.dependencies.join(",").toLowerCase();
  const topLevelDirectoryCount = evidence.topLevelDirectories.length;
  const entryCandidateCount = evidence.entryCandidates.length;
  const structuralSignals = new Set(evidence.structuralSignals);
  const hasBackendLayering = hasSignals(structuralSignals, [
    "layered-entry",
    "layered-logic",
  ]);
  const hasDataLayer = hasSignals(structuralSignals, ["layered-data"]);
  const hasUiLayer = structuralSignals.has("ui-surface");
  const hasExtensionLikeModules = countSignals(structuralSignals, [
    "extension-cluster",
  ]);
  const hasAsyncBoundaries = countSignals(structuralSignals, [
    "async-boundary-cluster",
  ]);

  let projectType: ProjectTypeIdentificationResult["projectType"] = "unknown";
  let primaryLanguage: ProjectTypeIdentificationResult["primaryLanguage"] =
    "other";
  let framework: string | undefined;
  const techStack: string[] = [];
  const identificationEvidence: string[] = [];

  if (deps.includes("spring") || evidence.configFiles.includes("pom.xml")) {
    primaryLanguage = "java";
    framework = "spring-boot";
    techStack.push("Spring Boot");
  }
  if (
    deps.includes("react") ||
    deps.includes("vue") ||
    deps.includes("angular")
  ) {
    primaryLanguage = "typescript";
    techStack.push("React/Vue/Angular");
  }
  // CLI 工具检测（优先级较高，避免被后续if-else覆盖）
  if (deps.includes("commander") || deps.includes("yargs")) {
    primaryLanguage = "typescript";
    projectType = "cli-tool";
    identificationEvidence.push("CLI 依赖：commander/yargs");
  } else if (
    topLevelDirectoryCount >= 6 &&
    hasExtensionLikeModules >= 4 &&
    entryCandidateCount <= 1
  ) {
    projectType = "library";
    identificationEvidence.push("顶层模块数量多且以扩展/适配结构为主");
  } else if (
    topLevelDirectoryCount >= 4 &&
    entryCandidateCount >= 2 &&
    hasBackendLayering &&
    hasDataLayer
  ) {
    projectType = "microservices";
    identificationEvidence.push("存在多个入口模块且后端分层信号稳定");
  } else if (tree.includes("packages/") || tree.includes("apps/")) {
    projectType = "monorepo";
    identificationEvidence.push("存在 packages/ 或 apps/ 目录");
  } else if (hasBackendLayering && hasDataLayer) {
    projectType = "backend-service";
    identificationEvidence.push("存在稳定的入口层、服务层和数据访问层");
  } else if (
    (hasUiLayer || tree.includes("components")) &&
    (deps.includes("react") || deps.includes("vue"))
  ) {
    projectType = "frontend-app";
    identificationEvidence.push("存在 components 目录 + UI 框架依赖");
  } else if (tree.includes("bin/") || tree.includes("cli")) {
    projectType = "cli-tool";
    identificationEvidence.push("存在 bin/ 或 cli 目录");
  } else if (hasAsyncBoundaries >= 2 && hasDataLayer) {
    projectType = "backend-service";
    identificationEvidence.push("存在异步边界与数据层信号");
  }

  return {
    projectType,
    primaryLanguage,
    framework,
    techStack,
    confidence: 0.5,
    identificationEvidence,
  };
}

function hasSignals(signals: Set<string>, targets: string[]): boolean {
  return targets.some((target) => signals.has(target));
}

function countSignals(signals: Set<string>, targets: string[]): number {
  return targets.filter((target) => signals.has(target)).length;
}
