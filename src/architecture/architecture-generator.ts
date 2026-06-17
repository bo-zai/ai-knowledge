/**
 * 架构概览生成模块
 *
 * 根据项目类型选择对应模板，调用 LLM 生成 architecture.md
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { PromptLoader } from "../shared/prompt-loader.js";
import { LLM_DEFAULTS } from "../config/defaults.js";
import { callLlmForJson } from "../generation/llm-json-client.js";
import type { LlmClaimsProvider } from "../generation/knowledge-generator.js";
import type { ProjectContext, ProjectType } from "./project-context.js";
import type { ModuleTopology } from "../schemas/module.js";
import {
  getLanguageAdapter,
  detectProjectLanguage,
} from "../evidence/extractors/language-adapters/index.js";
import type { LanguageAdapter } from "../evidence/extractors/language-adapters/index.js";
import {
  createDirectoryNameChecker,
  loadIgnoreRules,
  isHardcodedIgnoredDirectory,
} from "../config/ignore-service.js";

/** 默认知识库目录名 */
const DEFAULT_KNOWLEDGE_DIR = "ai-knowledge";

/** 架构概览生成结果 */
export interface ArchitectureGenerationResult {
  success: boolean;
  content?: string;
  filePath: string;
}

/** 目录结构条目 */
export interface DirectoryStructureItem {
  path: string;
  purpose: string;
  coding_guide: string;
}

/** 忽略目录条目 */
export interface IgnoreDirectoryItem {
  path: string;
  reason: string;
}

/** 编码约定条目 */
export interface CodingConventionItem {
  convention: string;
  description: string;
}

/** 调试入口条目 */
export interface DebugEntrypointItem {
  type: string;
  location: string;
  description: string;
}

/** 中间件能力条目 */
export interface MiddlewareCapabilityItem {
  middleware_type: string; // AOP | Config | Filter | Interceptor | Listener
  class_name: string;
  annotations: string[]; // @Aspect, @Configuration, @Component 等
  scope?: string; // 切点表达式或作用范围
  description: string;
  source_file: string;
}

/** 架构概览 JSON 结构（新版） */
export interface ArchitectureOverview {
  architecture_overview_name: string;
  summary_zh: string;
  project_type: ProjectType;
  tech_stack: string[];
  // 多模块项目专用字段
  coupling_mode?: string; // 紧耦合 | 松耦合
  module_topology?: ModuleTopologyItem[];
  module_dependencies_description?: string;
  module_architectures?: ModuleArchitectureItem[];
  shared_modules_description?: string;
  business_domain_panorama?: BusinessDomainPanorama;
  // 后端：分包模式
  package_mode?: string; // 按层分包 | 按领域分包 | 混合分包
  layer_package_paths?: LayerPackagePathItem[]; // 分层包路径（后端）
  // 后端：中间件能力（AOP切面、配置类、过滤器等）
  middleware_capabilities?: MiddlewareCapabilityItem[];
  // 前端：组件组织模式
  component_mode?: string; // feature-based | type-based | 混合模式
  layer_directory_paths?: LayerDirectoryPathItem[]; // 分层目录路径（前端/CLI）
  // CLI：命令组织模式
  command_mode?: string; // 独立文件模式 | 集中定义模式 | 模块化模式
  directory_structure: DirectoryStructureItem[];
  ignore_directories: IgnoreDirectoryItem[];
  coding_conventions: CodingConventionItem[];
  business_domains_navigation?: string;
  export_structure?: string;
  debug_entrypoints: DebugEntrypointItem[];
  evidence: string[];
}

/** 模块拓扑条目 */
export interface ModuleTopologyItem {
  name: string;
  path: string;
  type: string;
  role: string; // deployable | shared
  description?: string;
  dependencies?: string[];
  used_by?: string[];
  entry_point?: string;
}

/** 模块架构条目 */
export interface ModuleArchitectureItem {
  module_name: string;
  package_mode: string;
  layer_package_paths?: LayerPackagePathItem[];
  note?: string; // 用于简单模块的备注说明
}

/** 业务领域全景 */
export interface BusinessDomainPanorama {
  core_domains?: string[];
  supporting_domains?: string[];
  auxiliary_domains?: string[];
  domain_interactions?: string;
}

/** 分层包路径条目（后端） */
export interface LayerPackagePathItem {
  layer: string;
  package_path: string;
  coding_guide: string;
}

/** 分层目录路径条目（前端/CLI） */
export interface LayerDirectoryPathItem {
  layer: string;
  directory_path: string;
  coding_guide: string;
}

/**
 * 必须在 ARCHITECTURE 知识中列出的忽略目录
 * 只包含项目特定的构建产物和工具生成目录
 * 不包含通用目录（.git/、.idea/、node_modules/），Agent 已知这些
 */
const REQUIRED_IGNORE_DIRS: IgnoreDirectoryItem[] = [
  { path: "ai-knowledge/", reason: "知识库生成产物" },
  { path: ".codegraph/", reason: "代码索引文件" },
];

/**
 * 收集类型特定证据
 */
export async function collectArchitectureEvidence(
  repoPath: string,
  projectType: ProjectType,
  adapter: LanguageAdapter | null,
  dirNameChecker: (name: string) => boolean,
): Promise<Record<string, unknown>> {
  const baseEvidence = await collectBaseEvidence(repoPath, dirNameChecker);

  // 根据项目类型收集特定证据（使用适配器配置）
  switch (projectType) {
    case "backend-service":
      return {
        ...baseEvidence,
        layer_dirs: await detectLayerDirectories(repoPath, adapter),
        entry_types: await detectBackendEntries(repoPath, adapter),
        coding_convention_evidence: await detectBackendCodingConventions(
          repoPath,
          adapter,
        ),
        middleware_evidence: await detectMiddlewareCapabilities(
          repoPath,
          adapter,
        ),
      };

    case "frontend-app":
      return {
        ...baseEvidence,
        component_dirs: await detectComponentDirs(repoPath, adapter),
        routing_file: await detectRoutingFile(repoPath, adapter),
        state_management: await detectStateManagement(repoPath, adapter),
        coding_convention_evidence:
          await detectFrontendCodingConventions(repoPath),
      };

    case "cli-tool":
      return {
        ...baseEvidence,
        command_dir: await detectCommandDir(repoPath, adapter),
        export_file: await detectExportFile(repoPath, adapter),
        coding_convention_evidence: await detectCliCodingConventions(
          repoPath,
          adapter,
        ),
      };

    case "library":
      return {
        ...baseEvidence,
        api_dirs: await detectApiDirs(repoPath, adapter),
        export_config: await detectExportConfig(repoPath),
        coding_convention_evidence:
          await detectLibraryCodingConventions(repoPath),
      };

    default:
      return baseEvidence;
  }
}

/**
 * 生成架构概览
 */
export async function generateArchitectureOverview(
  repoPath: string,
  context: ProjectContext,
  claimsProvider: LlmClaimsProvider,
  outputRoot: string,
  moduleTopology?: ModuleTopology,
  timeout?: number,
): Promise<ArchitectureGenerationResult> {
  const knowledgeDir = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR);
  const filePath = path.join(knowledgeDir, "architecture.md");

  // 根据项目类型和模块拓扑选择模板
  const templateName = getTemplateName(context.projectType, moduleTopology);
  logger.debug(`Using architecture template: ${templateName}`);

  // 使用通用语言检测
  const language = await detectProjectLanguage(repoPath);
  const adapter = getLanguageAdapter(language);
  if (!adapter) {
    logger.warn(
      `Architecture: no adapter for language '${language}', using fallback`,
    );
  }

  // 创建目录名检查器（基于 .gitignore + 硬编码规则）
  const dirNameChecker = await createDirectoryNameChecker(repoPath);

  // 收集类型特定证据（使用适配器配置）
  const evidence = await collectArchitectureEvidence(
    repoPath,
    context.projectType,
    adapter,
    dirNameChecker,
  );

  // 加载提示词模板
  const systemPrompt = PromptLoader.load(templateName).raw;

  // 构建用户提示词
  const userPromptData: Record<string, unknown> = {
    project_name: path.basename(repoPath),
    identified_type: context.projectType,
    identified_tech_stack: context.techStack,
    identified_framework: context.framework,
    evidence,
  };

  // 多模块项目添加模块拓扑信息
  if (moduleTopology && moduleTopology.moduleCount > 1) {
    userPromptData.coupling_mode =
      moduleTopology.couplingMode === "tightly-coupled" ? "紧耦合" : "松耦合";
    userPromptData.module_topology = moduleTopology.modules;
    userPromptData.module_count = moduleTopology.moduleCount;

    // 收集各模块的目录结构
    // 深度设置为 10 层，确保能获取完整的包结构（如 src/main/java/io/joyrpc/controller/）
    const moduleDirTrees: Record<string, string> = {};
    for (const module of moduleTopology.modules) {
      const modulePath = path.join(repoPath, module.path.slice(0, -1));
      const moduleTree = await collectModuleDirectoryTree(modulePath, 10);
      moduleDirTrees[module.name] = moduleTree;
    }
    userPromptData.module_dir_trees = moduleDirTrees;

    // 收集根 pom.xml（Maven 多模块）
    const rootPomPath = path.join(repoPath, "pom.xml");
    try {
      const rootPomContent = await fs.readFile(rootPomPath, "utf-8");
      // 提取 modules 部分
      const modulesMatch = rootPomContent.match(
        /<modules>([\s\S]*?)<\/modules>/,
      );
      userPromptData.root_pom_modules = modulesMatch?.[1] ?? "";
    } catch {
      // 根 pom.xml 不存在
    }
  }

  const userPrompt = JSON.stringify(userPromptData, null, 2);

  logger.debug("Generating architecture overview with LLM...");

  // 调用 LLM（传递 timeout 和完整证据作为 repairContext）
  const result = await callLlmForJson<ArchitectureOverview>({
    systemPrompt,
    userPrompt,
    claimsProvider,
    knowledgeType: "ARCHITECTURE",
    fallbackContext: { projectName: path.basename(repoPath) },
    maxRetries: LLM_DEFAULTS.maxRetries,
    timeout,
    repairContext: {
      projectName: path.basename(repoPath),
      projectType: context.projectType,
      techStack: context.techStack,
      evidence,
    },
    logLabel: "Architecture generation",
  });

  if (!result.success || !result.data) {
    logger.warn("Architecture generation failed, using fallback template");
    const fallbackContent = generateFallbackArchitecture(repoPath, context);
    await writeArchitectureFile(filePath, fallbackContent);
    return { success: true, content: fallbackContent, filePath };
  }

  // 确保忽略目录完整性
  const completeData = ensureIgnoreDirectories(result.data);

  // 转换为 Markdown
  const mdContent = architectureToMarkdown(completeData, context);

  // 写入文件
  await writeArchitectureFile(filePath, mdContent);

  logger.info(`Architecture overview generated: ${filePath}`);

  return { success: true, content: mdContent, filePath };
}

/**
 * 确保忽略目录列表完整，并过滤掉通用目录
 *
 * 通用目录（Agent 已知）不应该写入项目知识：
 * - .git/、.svn/ — 版本控制
 * - .idea/、.vscode/ — IDE 配置
 * - node_modules/ — npm 依赖
 *
 * 只保留两类目录：
 * 1. 项目特定的构建产物（target/、dist/、build/ 等）
 * 2. 工具生成目录（ai-knowledge/、.codegraph/）
 */
function ensureIgnoreDirectories(
  data: ArchitectureOverview,
): ArchitectureOverview {
  // 通用目录（Agent 已知，不需要写入）
  const COMMON_IGNORE_DIRS = new Set([
    ".git/",
    ".svn/",
    ".hg/",
    ".bzr/", // 版本控制
    ".idea/",
    ".vscode/",
    ".vs/",
    ".eclipse/", // IDE 配置
    "node_modules/",
    "bower_components/", // 依赖目录
  ]);

  const existingDirs = data.ignore_directories || [];

  // 过滤掉通用目录
  const filteredDirs = existingDirs.filter(
    (d) => !COMMON_IGNORE_DIRS.has(d.path),
  );

  // 确保工具生成目录存在
  const existingPaths = new Set(filteredDirs.map((d) => d.path));
  const missingDirs = REQUIRED_IGNORE_DIRS.filter(
    (d) => !existingPaths.has(d.path),
  );

  return {
    ...data,
    ignore_directories: [...filteredDirs, ...missingDirs],
  };
}

/**
 * 写入架构概览文件
 */
async function writeArchitectureFile(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * 根据项目类型获取模板名称
 */
function getTemplateName(
  projectType: ProjectType,
  moduleTopology?: ModuleTopology,
): string {
  // 多模块项目使用专用模板
  if (moduleTopology && moduleTopology.moduleCount > 1) {
    return "rules-architecture-multi-module";
  }

  const templateMap: Record<string, string> = {
    "backend-service": "rules-architecture-backend",
    "frontend-app": "rules-architecture-frontend",
    "cli-tool": "rules-architecture-cli",
    library: "rules-architecture-library",
  };

  // 复合类型和特殊类型默认使用 backend 模板
  return templateMap[projectType] || "rules-architecture-backend";
}

/**
 * 架构概览 JSON 转 Markdown（新版）
 */
function architectureToMarkdown(
  data: ArchitectureOverview,
  context: ProjectContext,
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 头部
  lines.push(`# ${data.architecture_overview_name || "项目架构概览"}`);
  lines.push("");
  lines.push(`> 类型：ARCHITECTURE`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push("");

  // 一句话定位
  lines.push(`## 一句话定位`);
  lines.push("");
  lines.push(data.summary_zh || "项目架构概览（待人工补充）");
  lines.push("");

  // 项目类型
  lines.push(`## 项目类型`);
  lines.push("");
  lines.push(data.project_type || "unknown");
  lines.push("");

  // 技术栈
  lines.push(`## 技术栈`);
  lines.push("");
  const techStack = data.tech_stack || [];
  lines.push(techStack.length > 0 ? techStack.join("、") : "未识别");
  lines.push("");

  // 多模块项目专用章节
  // 模块依赖关系描述
  if (data.module_dependencies_description) {
    lines.push(`## 模块依赖关系`);
    lines.push("");
    lines.push(data.module_dependencies_description);
    lines.push("");
  }

  // 各模块架构
  if (data.module_architectures && data.module_architectures.length > 0) {
    lines.push(`## 各模块架构`);
    lines.push("");
    for (const module of data.module_architectures) {
      lines.push(`### ${module.module_name}`);
      lines.push("");
      if (module.package_mode) {
        lines.push(`**分包模式**：${module.package_mode}`);
        lines.push("");
      }
      if (module.note) {
        lines.push(module.note);
        lines.push("");
      }
      if (module.layer_package_paths && module.layer_package_paths.length > 0) {
        lines.push("| 分层 | 包路径 | 编码时 |");
        lines.push("|------|--------|--------|");
        for (const layer of module.layer_package_paths) {
          lines.push(
            `| ${layer.layer} | ${layer.package_path} | ${layer.coding_guide} |`,
          );
        }
        lines.push("");
      }
    }
  }

  // 共享模块说明
  if (data.shared_modules_description) {
    lines.push(`## 共享模块说明`);
    lines.push("");
    lines.push(data.shared_modules_description);
    lines.push("");
  }

  // 业务领域全景
  if (data.business_domain_panorama) {
    lines.push(`## 业务领域全景`);
    lines.push("");
    const panorama = data.business_domain_panorama;
    if (panorama.core_domains && panorama.core_domains.length > 0) {
      lines.push(`**核心域**：${panorama.core_domains.join("、")}`);
      lines.push("");
    }
    if (panorama.supporting_domains && panorama.supporting_domains.length > 0) {
      lines.push(`**支撑域**：${panorama.supporting_domains.join("、")}`);
      lines.push("");
    }
    if (panorama.auxiliary_domains && panorama.auxiliary_domains.length > 0) {
      lines.push(`**辅助域**：${panorama.auxiliary_domains.join("、")}`);
      lines.push("");
    }
    if (panorama.domain_interactions) {
      lines.push(`**域间交互**：${panorama.domain_interactions}`);
      lines.push("");
    }
  }

  // 分包模式（后端服务核心字段）
  if (data.package_mode) {
    lines.push(`## 分包模式`);
    lines.push("");
    lines.push(data.package_mode);
    lines.push("");
  }

  // 组件组织模式（前端应用核心字段）
  if (data.component_mode) {
    lines.push(`## 组件组织模式`);
    lines.push("");
    lines.push(data.component_mode);
    lines.push("");
  }

  // 命令组织模式（CLI 工具核心字段）
  if (data.command_mode) {
    lines.push(`## 命令组织模式`);
    lines.push("");
    lines.push(data.command_mode);
    lines.push("");
  }

  // 分层包路径（后端核心字段）
  if (data.layer_package_paths && data.layer_package_paths.length > 0) {
    lines.push(`## 分层包路径`);
    lines.push("");
    lines.push("| 分层 | 包路径 | 编码时 |");
    lines.push("|------|--------|--------|");
    for (const layer of data.layer_package_paths) {
      lines.push(
        `| ${layer.layer} | ${layer.package_path} | ${layer.coding_guide} |`,
      );
    }
    lines.push("");
  }

  // 中间件能力（后端核心字段）
  if (data.middleware_capabilities && data.middleware_capabilities.length > 0) {
    lines.push(`## 中间件能力`);
    lines.push("");
    lines.push("以下类提供横切关注点处理能力（AOP切面、配置类、过滤器等）：");
    lines.push("");
    lines.push("| 类型 | 类名 | 注解 | 作用范围 | 说明 |");
    lines.push("|------|------|------|----------|------|");
    for (const mw of data.middleware_capabilities) {
      const scope = mw.scope ? mw.scope.slice(0, 50) : "—";
      lines.push(
        `| ${mw.middleware_type} | ${mw.class_name} | ${mw.annotations.join(", ")} | ${scope} | ${mw.description} |`,
      );
    }
    lines.push("");
  }

  // 分层目录路径（前端/CLI核心字段）
  if (data.layer_directory_paths && data.layer_directory_paths.length > 0) {
    lines.push(`## 分层目录路径`);
    lines.push("");
    lines.push("| 分层 | 目录路径 | 编码时 |");
    lines.push("|------|----------|--------|");
    for (const layer of data.layer_directory_paths) {
      lines.push(
        `| ${layer.layer} | ${layer.directory_path} | ${layer.coding_guide} |`,
      );
    }
    lines.push("");
  }

  // 目录结构（表格形式）
  if (data.directory_structure && data.directory_structure.length > 0) {
    lines.push(`## 目录结构`);
    lines.push("");
    lines.push("| 目录 | 用途 | 编码时 |");
    lines.push("|------|------|--------|");
    for (const dir of data.directory_structure) {
      lines.push(`| ${dir.path} | ${dir.purpose} | ${dir.coding_guide} |`);
    }
    lines.push("");
  }

  // 忽略目录
  if (data.ignore_directories && data.ignore_directories.length > 0) {
    lines.push(`## 忽略目录`);
    lines.push("");
    lines.push("以下目录不包含业务逻辑，浏览代码时跳过：");
    lines.push("");
    for (const dir of data.ignore_directories) {
      lines.push(`- ${dir.path} — ${dir.reason}`);
    }
    lines.push("");
  }

  // 编码约定
  if (data.coding_conventions && data.coding_conventions.length > 0) {
    lines.push(`## 编码约定`);
    lines.push("");
    for (const conv of data.coding_conventions) {
      lines.push(`- **${conv.convention}**：${conv.description}`);
    }
    lines.push("");
  }

  // 导出结构（library/cli 时）
  if (data.export_structure) {
    lines.push(`## 导出结构`);
    lines.push("");
    lines.push(data.export_structure);
    lines.push("");
  }

  // 业务领域导航（backend/frontend 时）
  if (data.business_domains_navigation) {
    lines.push(`## 业务领域导航`);
    lines.push("");
    lines.push(data.business_domains_navigation);
    lines.push("");
  }

  // 调试入口
  if (data.debug_entrypoints && data.debug_entrypoints.length > 0) {
    lines.push(`## 调试入口`);
    lines.push("");
    lines.push("| 类型 | 位置 | 说明 |");
    lines.push("|------|------|------|");
    for (const entry of data.debug_entrypoints) {
      lines.push(
        `| ${entry.type} | ${entry.location} | ${entry.description} |`,
      );
    }
    lines.push("");
  }

  // 证据
  if (data.evidence && data.evidence.length > 0) {
    lines.push(`## 证据`);
    lines.push("");
    for (const ev of data.evidence) {
      lines.push(`- ${ev}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 生成降级架构概览（新版）
 */
function generateFallbackArchitecture(
  repoPath: string,
  context: ProjectContext,
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();
  const projectName = path.basename(repoPath);
  const techStack = context.techStack || [];

  lines.push(`# ${projectName} 架构概览`);
  lines.push("");
  lines.push(`> 类型：ARCHITECTURE`);
  lines.push(`> 生成时间：${timestamp}`);
  lines.push("");

  lines.push(`## 一句话定位`);
  lines.push("");
  lines.push(
    `${context.projectType || "unknown"} 项目，技术栈：${techStack.length > 0 ? techStack.join("、") : "未识别"}`,
  );
  lines.push("");

  lines.push(`## 项目类型`);
  lines.push("");
  lines.push(context.projectType || "unknown");
  lines.push("");

  lines.push(`## 技术栈`);
  lines.push("");
  lines.push(techStack.length > 0 ? techStack.join("、") : "未识别");
  lines.push("");

  // 忽略目录（必须包含）
  lines.push(`## 忽略目录`);
  lines.push("");
  lines.push("以下目录不包含业务逻辑，浏览代码时跳过：");
  lines.push("");
  for (const dir of REQUIRED_IGNORE_DIRS) {
    lines.push(`- ${dir.path} — ${dir.reason}`);
  }
  lines.push("");

  lines.push(`## 证据`);
  lines.push("");
  const evidence = context.identificationEvidence || [];
  if (evidence.length > 0) {
    for (const ev of evidence) {
      lines.push(`- ${ev}`);
    }
  } else {
    lines.push(`- 项目目录结构`);
  }
  lines.push("");

  lines.push(`> 此架构概览为降级生成，详细信息请查看项目文档或代码结构。`);

  return lines.join("\n");
}

// ========== 证据收集辅助函数 ==========

async function collectBaseEvidence(
  repoPath: string,
  dirNameChecker: (name: string) => boolean,
): Promise<Record<string, unknown>> {
  // 获取顶层目录树（3层深度）
  const topDirTree = await getDirectoryTree(repoPath, 3, dirNameChecker);

  // 获取 src 目录详细结构（如果存在）- 增加深度以获取完整包结构
  const srcPath = path.join(repoPath, "src");
  let srcDirTree = "";
  try {
    srcDirTree = await getDirectoryTree(srcPath, 8, dirNameChecker); // 8层深度确保获取完整包结构
  } catch {
    // src 目录不存在
  }

  // 获取 Java 目录完整包结构（后端项目关键证据）
  let javaDirTree = "";
  try {
    const javaPath = path.join(repoPath, "src/main/java");
    javaDirTree = await getDirectoryTree(javaPath, 10, dirNameChecker); // 完整包结构，不限深度
  } catch {
    // Java 目录不存在
  }

  // 获取项目实际的 gitignore 规则
  const gitignorePatterns = await loadGitignorePatterns(repoPath);

  return {
    repo_name: path.basename(repoPath),
    top_dir_tree: topDirTree,
    src_dir_tree: srcDirTree,
    java_dir_tree: javaDirTree,
    gitignore_patterns: gitignorePatterns,
  };
}

/**
 * 加载 .gitignore 规则（用于 evidence）
 * 只返回项目特定的构建产物规则，不包含通用规则
 */
async function loadGitignorePatterns(repoPath: string): Promise<string[]> {
  try {
    const gitignorePath = path.join(repoPath, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf-8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));

    // 只保留构建产物相关的规则（项目特定的）
    // 过滤掉通用规则（.git/、.idea/、node_modules/ 等）
    const buildRelatedPatterns = lines.filter((line) => {
      // 保留构建产物目录规则
      const buildPatterns = [
        "dist",
        "build",
        "target",
        "out",
        "bin",
        "output",
        "*.class",
        "*.jar",
        "*.war",
      ];
      return buildPatterns.some((p) => line.includes(p));
    });

    return buildRelatedPatterns.slice(0, 10); // 最多 10 个
  } catch {
    // .gitignore 不存在
    return [];
  }
}

/**
 * 检测后端分层目录（使用适配器配置）
 */
async function detectLayerDirectories(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string[]> {
  // 使用适配器配置的分层目录名，或使用默认值
  const layers = adapter?.namingPatterns.layerNames ?? [
    "controller",
    "service",
    "repository",
    "dao",
    "domain",
    "application",
    "infrastructure",
  ];
  const found: string[] = [];

  for (const layer of layers) {
    // 检查多种可能的路径（Java: src/main/java/../layer, 其他: src/layer）
    const possiblePaths = [
      path.join(repoPath, "src", "main", "java", "com", "example", layer), // Java Spring 结构
      path.join(repoPath, "src", layer), // 通用结构
    ];

    for (const dirPath of possiblePaths) {
      try {
        await fs.access(dirPath);
        found.push(layer);
        break; // 找到后不再检查其他路径
      } catch {
        // 目录不存在
      }
    }
  }

  return found;
}

/**
 * 检测后端入口类型（使用适配器配置）
 */
async function detectBackendEntries(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string[]> {
  const entries: string[] = [];
  const entrySuffixes = adapter?.namingPatterns.entryPointSuffixes ?? [
    "Controller",
    "Handler",
    "Api",
  ];

  // 检查入口类（使用适配器配置的后缀）
  try {
    const srcPath = path.join(repoPath, "src");
    const files = await fs.readdir(srcPath, { withFileTypes: true });
    for (const f of files) {
      // 检查是否匹配任一入口后缀
      const lowerName = f.name.toLowerCase();
      for (const suffix of entrySuffixes) {
        if (lowerName.includes(suffix.toLowerCase())) {
          entries.push("HTTP: src/" + f.name);
          break;
        }
      }
    }
  } catch {
    // src 目录不存在
  }

  return entries;
}

/**
 * 检测后端编码约定证据（使用适配器配置）
 */
async function detectBackendCodingConventions(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<Record<string, unknown>> {
  const conventions: Record<string, unknown> = {};
  const entrySuffixes = adapter?.namingPatterns.entryPointSuffixes ?? [
    "Controller",
  ];
  const dataModelSuffixes = adapter?.namingPatterns.dataModelSuffixes ?? [
    "Entity",
    "DO",
  ];

  // 检查类命名模式
  try {
    const srcPath = path.join(repoPath, "src/main/java");
    const javaFiles = await findJavaFiles(srcPath);

    // 检查入口类后缀
    for (const suffix of entrySuffixes) {
      const matchingFiles = javaFiles.filter((f) => f.includes(suffix));
      if (matchingFiles.length > 0) {
        conventions[`${suffix.toLowerCase()}_suffix`] =
          `${suffix} 类以 *${suffix} 结尾`;
      }
    }

    // 检查数据模型类后缀
    for (const suffix of dataModelSuffixes) {
      const matchingFiles = javaFiles.filter((f) => f.includes(suffix));
      if (matchingFiles.length > 0) {
        conventions[`${suffix.toLowerCase()}_suffix`] =
          `${suffix} 类以 *${suffix} 结尾`;
      }
    }
  } catch {
    // Java 目录不存在
  }

  return conventions;
}

/**
 * 获取目录树字符串
 * @param dir 目录路径
 * @param depth 遍历深度
 * @param dirNameChecker 目录名检查器，返回 true 表示应该忽略
 */
async function getDirectoryTree(
  dir: string,
  depth: number,
  dirNameChecker: (name: string) => boolean,
): Promise<string> {
  const lines: string[] = [];
  await walkDirTree(dir, "", depth, lines, dirNameChecker);
  return lines.join("\n");
}

async function walkDirTree(
  dirPath: string,
  prefix: string,
  maxDepth: number,
  lines: string[],
  dirNameChecker: (name: string) => boolean,
): Promise<void> {
  if (maxDepth <= 0) return;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filtered = entries
      .filter((e) => !dirNameChecker(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      const line = prefix + entry.name + (entry.isDirectory() ? "/" : "");
      lines.push(line);

      if (entry.isDirectory() && maxDepth > 1) {
        await walkDirTree(
          path.join(dirPath, entry.name),
          prefix + "  ",
          maxDepth - 1,
          lines,
          dirNameChecker,
        );
      }
    }
  } catch {
    // 目录读取失败
  }
}

async function findJavaFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findJavaFiles(fullPath)));
      } else if (entry.name.endsWith(".java")) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在
  }
  return files;
}

/**
 * 检测前端组件目录（使用适配器配置）
 */
async function detectComponentDirs(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string[]> {
  // 使用适配器配置的组件目录名，或使用默认值
  const dirs = adapter?.namingPatterns.componentDirs ?? [
    "components",
    "pages",
    "features",
    "views",
  ];
  const found: string[] = [];

  for (const d of dirs) {
    const srcDir = path.join(repoPath, "src", d);
    try {
      await fs.access(srcDir);
      found.push("src/" + d);
    } catch {
      // 目录不存在
    }
  }

  return found;
}

/**
 * 检测前端路由文件（使用适配器配置）
 */
async function detectRoutingFile(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string | undefined> {
  // 使用适配器配置的路由文件候选路径，或使用默认值
  const candidates = adapter?.namingPatterns.routingFiles ?? [
    "src/App.tsx",
    "src/App.ts",
    "src/router.ts",
    "src/routes.ts",
  ];

  for (const c of candidates) {
    try {
      await fs.access(path.join(repoPath, c));
      return c;
    } catch {
      // 文件不存在
    }
  }

  return undefined;
}

/**
 * 检测前端状态管理目录（使用适配器配置）
 */
async function detectStateManagement(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string | undefined> {
  // 使用适配器配置的状态管理目录候选路径，或使用默认值
  const candidates = adapter?.namingPatterns.stateDirs ?? [
    "src/store",
    "src/redux",
    "src/state",
  ];

  for (const c of candidates) {
    try {
      await fs.access(path.join(repoPath, c));
      return c;
    } catch {
      // 目录不存在
    }
  }

  return undefined;
}

/**
 * 检测前端编码约定证据
 */
async function detectFrontendCodingConventions(
  repoPath: string,
): Promise<Record<string, unknown>> {
  const conventions: Record<string, unknown> = {};

  // 检查组件命名模式
  try {
    const srcPath = path.join(repoPath, "src");
    const tsxFiles = await findFilesByExt(srcPath, ".tsx");

    // PascalCase 组件命名检测
    const pascalCaseFiles = tsxFiles.filter((f) =>
      /^[A-Z]/.test(path.basename(f, ".tsx")),
    );
    if (pascalCaseFiles.length > 0) {
      conventions.component_naming = "组件文件使用 PascalCase 命名";
    }

    // 检查是否有 features 目录（feature-based 组织）
    try {
      await fs.access(path.join(srcPath, "features"));
      conventions.organization_style = "feature-based";
    } catch {
      // 没有 features 目录，可能是 type-based
      try {
        await fs.access(path.join(srcPath, "components"));
        conventions.organization_style = "type-based";
      } catch {
        // 两者都不存在
      }
    }
  } catch {
    // src 目录不存在
  }

  return conventions;
}

async function findFilesByExt(dir: string, ext: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findFilesByExt(fullPath, ext)));
      } else if (entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在
  }
  return files;
}

/**
 * 检测 CLI 命令目录（使用适配器配置）
 */
async function detectCommandDir(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string | undefined> {
  // 使用适配器配置的命令目录候选路径，或使用默认值
  const candidates = adapter?.namingPatterns.commandDirs ?? [
    "src/commands",
    "src/cmd",
    "commands",
    "cmd",
  ];

  for (const c of candidates) {
    try {
      await fs.access(path.join(repoPath, c));
      return c;
    } catch {
      // 目录不存在
    }
  }

  return undefined;
}

/**
 * 检测导出文件（使用适配器配置）
 */
async function detectExportFile(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string | undefined> {
  // 使用适配器配置的导出文件候选路径，或使用默认值
  const candidates = adapter?.namingPatterns.exportFiles ?? [
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
  ];

  for (const c of candidates) {
    try {
      await fs.access(path.join(repoPath, c));
      return c;
    } catch {
      // 文件不存在
    }
  }

  return undefined;
}

/**
 * 检测 CLI 编码约定证据（使用适配器配置）
 */
async function detectCliCodingConventions(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<Record<string, unknown>> {
  const conventions: Record<string, unknown> = {};

  try {
    const commandDir = await detectCommandDir(repoPath, adapter);
    if (commandDir) {
      conventions.command_organization = "每个命令独立文件";

      // 检查命令文件命名
      const commandFiles = await findFilesByExt(
        path.join(repoPath, commandDir),
        ".ts",
      );
      if (commandFiles.length > 0) {
        conventions.command_files = commandFiles
          .map((f) => path.basename(f, ".ts"))
          .slice(0, 5);
      }
    }

    // 检查是否有 execute 方法
    const srcPath = path.join(repoPath, "src");
    const tsFiles = await findFilesByExt(srcPath, ".ts");
    const filesWithExecute = tsFiles.filter(
      (f) => f.includes("execute") || f.includes("run"),
    );
    if (filesWithExecute.length > 0) {
      conventions.command_interface = "命令实现 execute 方法";
    }
  } catch {
    // 目录不存在
  }

  return conventions;
}

/**
 * 检测库 API 目录（使用适配器配置）
 */
async function detectApiDirs(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<string[]> {
  // 使用适配器配置的 API 目录名，或使用默认值
  const dirs = adapter?.namingPatterns.apiDirs ?? [
    "src/core",
    "src/api",
    "src/lib",
  ];
  const found: string[] = [];

  for (const d of dirs) {
    try {
      await fs.access(path.join(repoPath, d));
      found.push(d);
    } catch {
      // 目录不存在
    }
  }

  return found;
}

async function detectExportConfig(
  repoPath: string,
): Promise<string | undefined> {
  const packageJsonPath = path.join(repoPath, "package.json");
  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);
    if (pkg.exports || pkg.main) {
      return JSON.stringify(pkg.exports || { main: pkg.main });
    }
  } catch {
    // package.json 不存在
  }
  return undefined;
}

/**
 * 检测库编码约定证据
 */
async function detectLibraryCodingConventions(
  repoPath: string,
): Promise<Record<string, unknown>> {
  const conventions: Record<string, unknown> = {};

  try {
    // 检查类型定义目录
    const typesDir = path.join(repoPath, "src/types");
    try {
      await fs.access(typesDir);
      conventions.type_organization = "类型定义在 src/types/ 目录";
    } catch {
      // 类型目录不存在
    }

    // 检查导出结构
    const indexPath = path.join(repoPath, "src/index.ts");
    try {
      await fs.access(indexPath);
      conventions.export_file = "src/index.ts";
    } catch {
      // index.ts 不存在
    }

    // 检查 package.json exports
    const packageJsonPath = path.join(repoPath, "package.json");
    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      if (pkg.exports) {
        conventions.package_exports = pkg.exports;
      }
    } catch {
      // package.json 不存在
    }
  } catch {
    // 目录不存在
  }

  return conventions;
}

/**
 * 收集模块目录树
 *
 * 用于多模块架构概览生成
 */
async function collectModuleDirectoryTree(
  modulePath: string,
  depth: number,
): Promise<string> {
  const lines: string[] = [];
  await walkModuleDirectory(modulePath, "", depth, lines);
  return lines.join("\n");
}

async function walkModuleDirectory(
  dir: string,
  prefix: string,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (maxDepth <= 0) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    // 过滤并排序
    const filtered = entries
      .filter((e) => !shouldExcludeForModule(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      const line = prefix + entry.name + (entry.isDirectory() ? "/" : "");
      lines.push(line);

      if (entry.isDirectory() && maxDepth > 1) {
        await walkModuleDirectory(
          path.join(dir, entry.name),
          prefix + "  ",
          maxDepth - 1,
          lines,
        );
      }
    }
  } catch {
    // 目录读取失败，忽略
  }
}

/**
 * 判断是否应排除的目录（模块目录扫描）
 */
function shouldExcludeForModule(name: string): boolean {
  const excludePatterns = [
    "node_modules",
    ".git",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "target",
    "out",
    ".knowledge",
    "ai-knowledge",
    ".codegraph",
    ".claude",
    "test",
  ];
  return excludePatterns.includes(name) || name.startsWith(".");
}

// ========== 中间件检测辅助函数 ==========

/** 中间件目录命名模式 */
const MIDDLEWARE_DIR_PATTERNS = [
  "aop",
  "aspect",
  "config",
  "configuration",
  "filter",
  "interceptor",
  "listener",
  "common",
  "handler",
  "advisor",
  "bootstrap",
];

/** 中间件类注解模式 */
const MIDDLEWARE_ANNOTATION_PATTERNS = [
  "@Aspect",
  "@Configuration",
  "@Component",
  "@Service",
  "@Filter",
  "@Interceptor",
  "@WebFilter",
  "@WebListener",
  "@EventListener",
  "@ControllerAdvice",
  "@RestControllerAdvice",
  "@Bean",
  "@Primary",
  "@Conditional",
];

/** 切点表达式正则 */
const POINTCUT_PATTERN = /execution\s*\(\s*[\s\S]*?\s*\)/g;

/**
 * 检测中间件能力（AOP切面、配置类、过滤器等）
 *
 * 通用策略：按命名模式扫描目录，然后 AST 解析提取注解
 */
async function detectMiddlewareCapabilities(
  repoPath: string,
  adapter: LanguageAdapter | null,
): Promise<MiddlewareCapabilityItem[]> {
  const capabilities: MiddlewareCapabilityItem[] = [];

  // 只处理 Java 项目
  if (adapter?.language !== "java") {
    return capabilities;
  }

  // 扫描中间件目录
  const srcPath = path.join(repoPath, "src/main/java");
  if (!existsSync(srcPath)) {
    return capabilities;
  }

  const middlewareFiles = await scanMiddlewareDirs(srcPath);

  // 解析每个中间件文件，提取注解和切点表达式
  for (const file of middlewareFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const relativePath = path.relative(repoPath, file).replace(/\\/g, "/");

      // 提取类名
      const classMatch = content.match(/class\s+([A-Za-z0-9_]+)/);
      const className = classMatch?.[1] ?? path.basename(file, ".java");

      // 提取注解
      const annotations = extractAnnotations(content);

      // 提取切点表达式（仅 AOP）
      const scope = extractPointcutExpressions(content);

      // 判断中间件类型
      const middlewareType = determineMiddlewareType(annotations);

      if (middlewareType && annotations.length > 0) {
        // 提取简要描述（从类注释或注解推断）
        const description = extractClassDescription(content, middlewareType);

        capabilities.push({
          middleware_type: middlewareType,
          class_name: className,
          annotations,
          scope: scope || undefined,
          description,
          source_file: relativePath,
        });
      }
    } catch {
      // 文件读取失败，跳过
    }
  }

  return capabilities;
}

/**
 * 扫描中间件目录，返回所有 Java 文件路径
 */
async function scanMiddlewareDirs(srcPath: string): Promise<string[]> {
  const files: string[] = [];

  // 递归扫描目录，按命名模式匹配
  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 检查目录名是否匹配中间件模式
          const lowerName = entry.name.toLowerCase();
          if (MIDDLEWARE_DIR_PATTERNS.some((p) => lowerName.includes(p))) {
            // 匹配到中间件目录，收集所有 Java 文件
            await collectJavaFiles(fullPath, files);
          } else {
            // 继续递归扫描
            await scanDir(fullPath);
          }
        }
      }
    } catch {
      // 目录读取失败
    }
  }

  await scanDir(srcPath);
  return files;
}

/**
 * 收集目录下所有 Java 文件
 */
async function collectJavaFiles(dir: string, files: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectJavaFiles(fullPath, files);
      } else if (entry.name.endsWith(".java")) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录读取失败
  }
}

/**
 * 从 Java 文件提取注解
 */
function extractAnnotations(content: string): string[] {
  const annotations: string[] = [];

  for (const pattern of MIDDLEWARE_ANNOTATION_PATTERNS) {
    if (content.includes(pattern)) {
      annotations.push(pattern);
    }
  }

  // 检查其他常见注解
  const otherAnnotations = content.match(/@[A-Za-z]+(?:\s*\([^)]*\))?/g) ?? [];
  for (const ann of otherAnnotations) {
    const cleanAnn = ann.split("(")[0]; // 移除参数部分
    if (
      !annotations.includes(cleanAnn) &&
      !["@Override", "@Deprecated", "@SuppressWarnings"].includes(cleanAnn)
    ) {
      annotations.push(cleanAnn);
    }
  }

  return annotations;
}

/**
 * 从 AOP 类提取切点表达式
 */
function extractPointcutExpressions(content: string): string | undefined {
  const matches = content.match(POINTCUT_PATTERN);
  if (matches && matches.length > 0) {
    // 合并多个切点表达式
    return matches.map((m) => m.trim()).join("; ");
  }

  // 尝试提取 @Pointcut 注解中的表达式
  const pointcutMatch = content.match(/@Pointcut\s*\(\s*["']([^"']+)["']\s*\)/);
  if (pointcutMatch) {
    return pointcutMatch[1];
  }

  // 尝试提取 @Before/@After/@Around 注解中的表达式
  const adviceMatch = content.match(
    /@(?:Before|After|Around|AfterReturning|AfterThrowing)\s*\(\s*["']([^"']+)["']\s*\)/,
  );
  if (adviceMatch) {
    return adviceMatch[1];
  }

  return undefined;
}

/**
 * 根据注解判断中间件类型
 */
function determineMiddlewareType(annotations: string[]): string | undefined {
  if (annotations.includes("@Aspect")) {
    return "AOP";
  }
  if (annotations.includes("@Configuration") || annotations.includes("@Bean")) {
    return "Config";
  }
  if (annotations.includes("@Filter") || annotations.includes("@WebFilter")) {
    return "Filter";
  }
  if (annotations.includes("@Interceptor")) {
    return "Interceptor";
  }
  if (
    annotations.includes("@EventListener") ||
    annotations.includes("@WebListener")
  ) {
    return "Listener";
  }
  if (
    annotations.includes("@ControllerAdvice") ||
    annotations.includes("@RestControllerAdvice")
  ) {
    return "Advice";
  }
  if (annotations.includes("@Component") || annotations.includes("@Service")) {
    // 检查是否是通用组件
    return "Component";
  }
  return undefined;
}

/**
 * 提取类描述（从类注释或根据类型推断）
 */
function extractClassDescription(
  content: string,
  middlewareType: string,
): string {
  // 尝试从类注释提取
  const classCommentMatch = content.match(
    /\/\*\*[\s\S]*?\*\/\s*(?:public\s+)?class/,
  );
  if (classCommentMatch) {
    const comment = classCommentMatch[0];
    // 提取注释内容（移除 /** 和 */ 和 * 前缀）
    const lines = comment
      .replace(/\/\*\*|\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l && !l.startsWith("@"));
    if (lines.length > 0) {
      return lines.slice(0, 2).join(" ").slice(0, 100);
    }
  }

  // 根据类型推断描述
  const typeDescriptions: Record<string, string> = {
    AOP: "切面类，处理横切关注点",
    Config: "配置类，定义 Bean 和配置项",
    Filter: "过滤器，处理请求预处理和后处理",
    Interceptor: "拦截器，拦截方法调用",
    Listener: "监听器，响应事件",
    Advice: "控制器增强，处理异常和绑定数据",
    Component: "通用组件类",
  };

  return typeDescriptions[middlewareType] ?? "中间件组件";
}
