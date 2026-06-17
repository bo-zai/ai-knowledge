import fs from "node:fs/promises";
import path from "node:path";
import type {
  GenerateKnowledge,
  GenerateTarget,
} from "../knowledge/generate-scope.js";
import type { KnowledgePackageContribution } from "./knowledge-package-contribution.js";
import type {
  PackageLayout,
  KnowledgeDir,
} from "../knowledge/init-directory.js";
import { DEFAULT_KNOWLEDGE_DIR } from "../config/defaults.js";
import {
  toKebabCase,
  getTypeFromDir,
} from "../knowledge/type-directory-map.js";
import type { KnowledgeType, LegacyType } from "../schemas/knowledge-type.js";
import { getTypeDir } from "../schemas/knowledge-type.js";
import type { ModuleTopology } from "../schemas/module.js";
import {
  deriveDomainKey,
  loadDomainRegistry,
  saveDomainRegistry,
  sortDomainRegistry,
  upsertCapabilityDomain,
  upsertConceptDomain,
  type DomainRegistry,
} from "./domain-registry.js";

const MANAGED_CONCEPT_SECTION = "AI-WIKI-CONCEPT-DOMAIN";
const MANAGED_CAPABILITY_SECTION = "AI-WIKI-CAPABILITY-DOMAIN";

/**
 * Write knowledge package to output directory.
 * Follows design/03-knowledge-directory-structure.md specification.
 */
export async function writeKnowledgePackage(input: {
  layout: PackageLayout;
  knowledge: GenerateKnowledge;
  target?: GenerateTarget;
  contributions: KnowledgePackageContribution[];
}): Promise<void> {
  const { layout, contributions } = input;
  await writeContributionFiles(layout, contributions);
  await rebuildPackageViews(layout);

  // 写入生成报告（放在 .internal/reports 目录下）
  const report = {
    knowledge: input.knowledge,
    target: input.target ?? null,
    stages: Object.fromEntries(contributions.map((c) => [c.stage, c.report])),
    warnings: contributions.flatMap((c) => c.warnings),
  };
  const internalDir = path.join(layout.packageRoot, ".internal");
  const reportsDir = path.join(internalDir, "reports");
  await fs.mkdir(internalDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(
    path.join(reportsDir, "generation.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );
}

export async function writeKnowledgeContributionIncremental(input: {
  layout: PackageLayout;
  knowledge: GenerateKnowledge;
  target?: GenerateTarget;
  contribution: KnowledgePackageContribution;
  capabilityDomain?: {
    domainKey: string;
    domainName: string;
    capabilityId: string;
    capabilityName: string;
    capabilityPath: string;
    summaryZh?: string;
  };
}): Promise<void> {
  await writeContributionFiles(input.layout, [input.contribution]);

  if (input.capabilityDomain) {
    const registry = await loadDomainRegistry(input.layout.packageRoot);
    upsertCapabilityDomain(registry, input.capabilityDomain);
    await saveDomainRegistry(
      input.layout.packageRoot,
      sortDomainRegistry(registry),
    );
  }

  await rebuildPackageViews(input.layout);
}

async function writeContributionFiles(
  layout: PackageLayout,
  contributions: KnowledgePackageContribution[],
): Promise<void> {
  const generatedConceptIds = await collectKnownConceptIds(
    layout,
    contributions,
  );

  for (const contribution of contributions) {
    for (const file of contribution.files) {
      if (file.path.startsWith("objects/")) {
        const rawObjectPath = path.join(
          layout.packageRoot,
          ...file.path.split("/"),
        );
        await fs.mkdir(path.dirname(rawObjectPath), { recursive: true });
        await fs.writeFile(rawObjectPath, file.content, "utf-8");

        const projected = projectRawObjectFile(
          layout,
          file,
          generatedConceptIds,
        );
        if (projected) {
          await fs.mkdir(path.dirname(projected.path), { recursive: true });
          await fs.writeFile(projected.path, projected.content, "utf-8");
        }
        continue;
      }

      const passthroughPath = getPassthroughPath(layout.packageRoot, file.path);
      if (passthroughPath) {
        await fs.mkdir(path.dirname(passthroughPath), { recursive: true });
        await fs.writeFile(passthroughPath, file.content, "utf-8");
        continue;
      }

      const { id, type, content } = parseFileData(file, generatedConceptIds);
      const dirName = getTypeDir(type);
      const dir = dirName as KnowledgeDir;
      const outputDir = layout.knowledgeDirs[dir];

      if (!outputDir) {
        const fallbackPath = path.join(
          layout.packageRoot,
          ...file.path.split("/"),
        );
        await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
        await fs.writeFile(fallbackPath, file.content, "utf-8");
        continue;
      }

      const fileName = toKebabCase(id) + ".md";
      const filePath = path.join(outputDir, fileName);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
    }
  }
}

function projectRawObjectFile(
  layout: PackageLayout,
  file: { path: string; content: string },
  generatedConceptIds: Set<string>,
): { path: string; content: string } | undefined {
  const parts = file.path.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "objects") return undefined;

  const dirName = parts[1]?.toLowerCase();
  if (!dirName) return undefined;

  const type = getTypeFromDir(dirName);
  if (!type) return undefined;

  const markdownType =
    type === "CONCEPT" || type === "CAPABILITY" ? type : undefined;
  if (!markdownType) return undefined;

  const fileName = parts[2] ?? "";
  const id = fileName.replace(/\.(md|yaml)$/, "");
  const projectedDir = layout.knowledgeDirs[dirName as KnowledgeDir];
  if (!projectedDir) return undefined;

  const content = yamlToMd(id, markdownType, file.content, generatedConceptIds);
  return {
    path: path.join(projectedDir, `${toKebabCase(id)}.md`),
    content,
  };
}

async function collectKnownConceptIds(
  layout: PackageLayout,
  contributions: KnowledgePackageContribution[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const entries = await fs.readdir(layout.knowledgeDirs.concepts, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".md") ||
        entry.name.startsWith("_")
      )
        continue;
      ids.add(entry.name.replace(/\.md$/, ""));
    }
  } catch {
    // ignore
  }

  for (const contribution of contributions) {
    for (const file of contribution.files) {
      if (getPassthroughPath(layout.packageRoot, file.path)) continue;
      const { id, type } = parseFileData(file);
      if (type === "CONCEPT" || type === "CON") {
        ids.add(toKebabCase(id));
      }
    }
  }

  return ids;
}

async function loadExistingMarkdownObjects(
  layout: PackageLayout,
): Promise<
  Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  >
> {
  const objectsByType: Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  > = {} as Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  >;

  for (const [dirName, dirPath] of Object.entries(
    layout.knowledgeDirs,
  ) as Array<[KnowledgeDir, string]>) {
    const objects: Array<{
      id: string;
      type: KnowledgeType | LegacyType;
      content: string;
    }> = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !entry.name.endsWith(".md") ||
          entry.name.startsWith("_")
        )
          continue;
        const id = entry.name.replace(/\.md$/, "");
        const content = await fs.readFile(
          path.join(dirPath, entry.name),
          "utf-8",
        );
        objects.push({
          id,
          type: getTypeFromDir(dirName) ?? "CONCEPT",
          content,
        });
      }
    } catch {
      // ignore
    }
    objectsByType[dirName] = objects;
  }

  return objectsByType;
}

async function rebuildPackageViews(layout: PackageLayout): Promise<void> {
  let objectsByType = await loadExistingMarkdownObjects(layout);
  let registry = await loadDomainRegistry(layout.packageRoot);
  registry = buildDomainRegistryFromObjects(objectsByType, registry);
  await saveDomainRegistry(layout.packageRoot, sortDomainRegistry(registry));

  await rewriteConceptDocuments(layout, registry);
  await rewriteCapabilityDocuments(layout, registry);

  objectsByType = await loadExistingMarkdownObjects(layout);

  for (const [dirName, dirObjects] of Object.entries(objectsByType) as Array<
    [
      KnowledgeDir,
      Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>,
    ]
  >) {
    if (dirObjects.length === 0) continue;
    const indexPath = path.join(layout.knowledgeDirs[dirName], "_index.md");
    await fs.writeFile(
      indexPath,
      generateTypeIndex(dirName, dirObjects),
      "utf-8",
    );
  }

  if (objectsByType.concepts && objectsByType.concepts.length > 0) {
    await fs.writeFile(
      path.join(layout.knowledgeDirs.concepts, "_glossary.md"),
      generateGlossary(objectsByType.concepts),
      "utf-8",
    );
  }

  let moduleTopology: ModuleTopology | undefined;
  try {
    const modulesJsonPath = path.join(layout.packageRoot, "modules.json");
    moduleTopology = JSON.parse(
      await fs.readFile(modulesJsonPath, "utf-8"),
    ) as ModuleTopology;
  } catch {
    // ignore
  }

  await fs.writeFile(
    layout.indexMdPath,
    generateGlobalIndex(layout, objectsByType, registry, moduleTopology),
    "utf-8",
  );
}

function getPassthroughPath(
  packageRoot: string,
  relativePath: string,
): string | undefined {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;

  if (parts[0] === "objects") return undefined;
  if (
    parts[0] === "views" ||
    parts[0] === "reports" ||
    parts[0] === "debug" ||
    parts[0] === "evidence" ||
    parts[0] === "functions"
  ) {
    return path.join(packageRoot, ...parts);
  }

  if (!getTypeFromDir(parts[0])) {
    return path.join(packageRoot, ...parts);
  }

  return undefined;
}

/**
 * Parse file data to extract id, type and convert yaml to md content.
 */
function parseFileData(
  file: { path: string; content: string },
  generatedConceptIds?: Set<string>,
): { id: string; type: KnowledgeType | LegacyType; content: string } {
  // 文件路径格式: {dir}/{id}.md 或 objects/{dir}/{id}.yaml
  const parts = file.path.split("/");

  // 判断是新格式还是旧格式
  const isNewFormat = parts[0] !== "objects";

  let dirName: string;
  let fileName: string;

  if (isNewFormat) {
    // 新格式: {dir}/{id}.md
    dirName = parts[0]?.toLowerCase() || "concepts";
    fileName = parts[1] || "";
  } else {
    // 旧格式: objects/{dir}/{id}.yaml
    dirName = parts[1]?.toLowerCase() || "concepts";
    fileName = parts[2] || "";
  }

  // 移除扩展名（.md 或 .yaml）
  const id = fileName.replace(/\.(md|yaml)$/, "");

  // 从目录名获取类型
  const type = getTypeFromDir(dirName) ?? "CONCEPT";

  // 如果是 markdown 格式，直接使用；否则转换 yaml
  const isMarkdown = file.content.startsWith("#") || fileName.endsWith(".md");
  const mdContent = isMarkdown
    ? file.content
    : yamlToMd(id, type, file.content, generatedConceptIds);

  return { id, type, content: mdContent };
}

/**
 * Convert yaml content to markdown format per design/03-knowledge-directory-structure.md.
 */
function yamlToMd(
  id: string,
  type: KnowledgeType | LegacyType,
  yamlContent: string,
  generatedConceptIds?: Set<string>,
): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 解析 yaml 字段
  const fields = parseYamlFields(yamlContent);

  // 头部格式（设计文档要求）
  const conceptName =
    getStringField(fields, "concept_name") ??
    getStringField(fields, "domain_name") ??
    getStringField(fields, "boundary_title") ??
    getStringField(fields, "constraint_name") ??
    getStringField(fields, "workflow_name") ??
    getStringField(fields, "aggregate_name") ??
    getStringField(fields, "external_system_name") ??
    getStringField(fields, "relation_name") ??
    id;
  lines.push(`# ${conceptName}`);
  lines.push("");
  lines.push(`> 类型：${type}`);
  lines.push(`> 生成时间：${timestamp}`);
  const codeManifestation = getArrayField<Record<string, string>>(
    fields,
    "code_manifestation",
  );
  if (codeManifestation) {
    const sources = extractSourceFiles(codeManifestation);
    lines.push(`> 来源文件：${sources.join(", ")}`);
  }
  const tags = getArrayField<string>(fields, "tags");
  if (tags) {
    lines.push(`> 标签：${formatTags(tags)}`);
  }
  lines.push("");

  // 一句话定位（summary_zh）- 放在头部后，帮助 Agent 快速判断相关性
  const summaryZh = getStringField(fields, "summary_zh");
  if (summaryZh) {
    lines.push(`## 一句话定位`);
    lines.push("");
    lines.push(summaryZh);
    lines.push("");
  }

  // 别名
  const aliases = getArrayField<string>(fields, "aliases");
  if (aliases && aliases.length > 0) {
    lines.push(`## 别名`);
    lines.push("");
    lines.push(`代码中的英文命名和业务术语中的其他叫法：`);
    lines.push("");
    for (const alias of aliases) {
      lines.push(`- ${alias}`);
    }
    lines.push("");
  }

  // 业务含义
  const businessMeaning = getStringField(fields, "business_meaning_zh");
  if (businessMeaning) {
    lines.push(`## 业务含义`);
    lines.push("");
    lines.push(businessMeaning);
    lines.push("");
  }

  // 边界知识特有字段
  const boundaryType = getStringField(fields, "boundary_type");
  if (boundaryType) {
    lines.push(`## 边界类型`);
    lines.push("");
    const typeLabels: Record<string, string> = {
      limitation: "局限性",
      disabled_feature: "禁用功能",
    };
    lines.push(typeLabels[boundaryType] || boundaryType);
    lines.push("");
  }

  const detailedDescription = getStringField(fields, "detailed_description_zh");
  if (detailedDescription) {
    lines.push(`## 详细说明`);
    lines.push("");
    lines.push(detailedDescription);
    lines.push("");
  }

  const relatedCapability = getStringField(fields, "related_capability");
  if (relatedCapability) {
    lines.push(`## 关联能力`);
    lines.push("");
    lines.push(relatedCapability);
    lines.push("");
  }

  // 约束知识特有字段
  const constraintType = getStringField(fields, "constraint_type");
  if (constraintType) {
    lines.push(`## 约束类型`);
    lines.push("");
    const typeLabels: Record<string, string> = {
      business_rule: "业务规则",
      technical: "技术约束",
      data: "数据约束",
    };
    lines.push(typeLabels[constraintType] || constraintType);
    lines.push("");
  }

  const triggerCondition = getStringField(fields, "trigger_condition");
  if (triggerCondition) {
    lines.push(`## 触发条件`);
    lines.push("");
    lines.push(triggerCondition);
    lines.push("");
  }

  const violationConsequence = getStringField(fields, "violation_consequence");
  if (violationConsequence) {
    lines.push(`## 违反后果`);
    lines.push("");
    lines.push(violationConsequence);
    lines.push("");
  }

  // 关键区分
  const keyDifferentiation = getStringField(fields, "key_differentiation");
  if (keyDifferentiation) {
    lines.push(`## 关键区分`);
    lines.push("");
    lines.push(keyDifferentiation);
    lines.push("");
  }

  // 取值说明
  const valueExplanation = getArrayField<Record<string, string>>(
    fields,
    "value_explanation",
  );
  if (valueExplanation && valueExplanation.length > 0) {
    lines.push(`## 取值说明`);
    lines.push("");
    for (const exp of valueExplanation) {
      if (exp.value && exp.business_meaning_zh) {
        lines.push(`- **${exp.value}**：${exp.business_meaning_zh}`);
      } else {
        lines.push(`- ${JSON.stringify(exp)}`);
      }
    }
    lines.push("");
  }

  // 关联概念（添加链接格式，帮助 Agent 直接跳转）
  const relatedConcepts = getArrayField<string>(fields, "related_concepts");
  if (relatedConcepts && relatedConcepts.length > 0) {
    lines.push(`## 关联概念`);
    lines.push("");
    for (const concept of relatedConcepts) {
      // 检查概念是否存在于已生成集合中
      const conceptFileName = toKebabCase(concept);
      if (generatedConceptIds && generatedConceptIds.has(conceptFileName)) {
        // 存在则生成链接
        lines.push(`- [${concept}](concepts/${conceptFileName}.md)`);
      } else {
        // 不存在则只显示名称
        lines.push(`- ${concept}`);
      }
    }
    lines.push("");
  }

  if (codeManifestation) {
    lines.push(`## 代码体现`);
    lines.push("");
    lines.push("| 类型 | 名称 | 位置 |");
    lines.push("|------|------|------|");
    for (const m of codeManifestation) {
      lines.push(
        `| ${m.kind || "class"} | ${m.name || ""} | ${m.location || ""} |`,
      );
    }
    lines.push("");
  }

  const applicableScope = getStringField(fields, "applicable_scope");
  if (applicableScope) {
    lines.push(`## 适用范围`);
    lines.push("");
    lines.push(applicableScope);
    lines.push("");
  }

  const confidence = getStringField(fields, "confidence");
  if (confidence) {
    lines.push(`## 置信度`);
    lines.push("");
    lines.push(confidence);
    lines.push("");
  }

  // 证据（evidence）- 帮助 Agent 定位代码位置
  const evidence = getArrayField<string>(fields, "evidence");
  if (evidence && evidence.length > 0) {
    lines.push(`## 证据`);
    lines.push("");
    for (const ev of evidence) {
      lines.push(`- ${ev}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parse yaml fields from string.
 * Handles objectToYaml output format where values are JSON.stringify wrapped.
 */
function parseYamlFields(yaml: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let lastArrayKey: string | null = null;

  for (const line of lines) {
    // Match array items in nested format: "  - {...}" (from objectToYaml for object arrays)
    const arrayItemMatch = line.match(/^  - (.+)$/);
    if (arrayItemMatch && lastArrayKey) {
      const arr = fields[lastArrayKey] as Array<unknown>;
      if (Array.isArray(arr)) {
        try {
          arr.push(JSON.parse(arrayItemMatch[1]));
        } catch {
          arr.push(arrayItemMatch[1]);
        }
      }
      continue; // Skip further processing for this line
    }

    // Match key: value pattern (objectToYaml outputs values as JSON.stringify)
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const valueStr = match[2];
      lastArrayKey = null; // Reset for non-array lines

      // Handle different value formats from objectToYaml
      if (valueStr === "" || valueStr === undefined) {
        // Empty value - this indicates array items follow (key: followed by "  - ...")
        fields[key] = [];
        lastArrayKey = key;
      } else if (valueStr === "[]") {
        fields[key] = [];
      } else if (valueStr.startsWith("[")) {
        // JSON array format: [item1, item2, ...] or [{...}, {...}]
        try {
          fields[key] = JSON.parse(valueStr);
        } catch {
          fields[key] = [];
        }
      } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
        // JSON.stringify string: "content" - parse to get actual content
        try {
          fields[key] = JSON.parse(valueStr);
        } catch {
          // Fallback: remove quotes directly
          fields[key] = valueStr.slice(1, -1);
        }
      } else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
        // Single quoted string
        fields[key] = valueStr.slice(1, -1);
      } else if (valueStr.startsWith("{")) {
        // JSON object
        try {
          fields[key] = JSON.parse(valueStr);
        } catch {
          fields[key] = {};
        }
      } else if (valueStr === "null") {
        fields[key] = null;
      } else {
        // Plain value (boolean, number, or unquoted string)
        if (valueStr === "true") {
          fields[key] = true;
        } else if (valueStr === "false") {
          fields[key] = false;
        } else if (/^\d+$/.test(valueStr)) {
          fields[key] = parseInt(valueStr, 10);
        } else if (/^\d+\.\d+$/.test(valueStr)) {
          fields[key] = parseFloat(valueStr);
        } else {
          fields[key] = valueStr;
        }
      }
    }
  }

  return fields;
}

/**
 * Helper to get string field from parsed yaml fields.
 */
function getStringField(
  fields: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Helper to get array field from parsed yaml fields.
 */
function getArrayField<T>(
  fields: Record<string, unknown>,
  key: string,
): T[] | undefined {
  const value = fields[key];
  return Array.isArray(value) ? (value as T[]) : undefined;
}

/**
 * Extract source file paths from code_manifestation.
 */
function extractSourceFiles(manifestation: unknown): string[] {
  if (!Array.isArray(manifestation)) return [];
  return manifestation
    .map((m: Record<string, string>) => m.location)
    .filter(Boolean);
}

/**
 * Format tags array to string.
 */
function formatTags(tags: unknown): string {
  if (!Array.isArray(tags)) return "";
  return tags.filter(Boolean).join(", ");
}

/**
 * Generate type-specific _index.md per design/03-knowledge-directory-structure.md.
 */
function generateTypeIndex(
  dir: KnowledgeDir,
  objects: Array<{
    id: string;
    type: KnowledgeType | LegacyType;
    content: string;
  }>,
): string {
  const lines: string[] = [];

  const dirNames: Record<KnowledgeDir, string> = {
    capabilities: "能力目录索引",
    concepts: "概念知识索引",
    boundaries: "边界知识索引",
    "external-systems": "外部系统交互索引",
    constraints: "约束知识索引",
    relations: "能力关系索引",
    "data-model": "数据模型索引",
    workflows: "跨域业务流程索引",
  };

  lines.push(`# ${dirNames[dir]}`);
  lines.push("");

  // 根据不同类型生成不同的表格
  if (dir === "concepts") {
    lines.push("| 概念 | 简要说明 | 标签 | 文件 |");
    lines.push("|------|---------|------|------|");
    for (const obj of objects.filter(isBusinessDomainConceptRecord)) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const fileName = toKebabCase(obj.id) + ".md";
      // 使用概念名称而不是英文 ID
      const conceptName = getStringField(fields, "concept_name") ?? obj.id;
      const summaryZh =
        getStringField(fields, "summary_zh") ??
        getStringField(fields, "business_meaning_zh") ??
        "";
      const tags = getArrayField<string>(fields, "tags");
      lines.push(
        `| ${conceptName} | ${summaryZh} | ${tags ? formatTags(tags) : ""} | [${fileName}](${fileName}) |`,
      );
    }
  } else {
    lines.push("| 名称 | 类型 | 文件 |");
    lines.push("|------|------|------|");
    for (const obj of objects) {
      const fileName = toKebabCase(obj.id) + ".md";
      lines.push(`| ${obj.id} | ${obj.type} | [${fileName}](${fileName}) |`);
    }
  }

  return lines.join("\n");
}

/**
 * Parse fields from markdown content.
 */
function parseYamlFieldsFromMd(mdContent: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  // 提取概念名称（标题第一行 # xxx）
  const titleMatch = mdContent.match(/^#\s+(.+)\n/);
  if (titleMatch) {
    fields.concept_name = titleMatch[1].trim();
  }

  // 提取一句话定位（summary_zh）
  const summaryMatch = mdContent.match(/## 一句话定位\s*\n\s*(.*?)\n/);
  if (summaryMatch) {
    fields.summary_zh = summaryMatch[1];
  }

  // 提取业务含义
  const businessMatch = mdContent.match(/## 业务含义\s*\n\s*(.*?)\n/);
  if (businessMatch) {
    fields.business_meaning_zh = businessMatch[1];
  }

  // 提取别名（列表项）
  const aliasesMatch = mdContent.match(/## 别名[\s\S]*?\n(- .*\n)+/);
  if (aliasesMatch) {
    const aliasLines = aliasesMatch[0].match(/- (.*)/g);
    if (aliasLines) {
      fields.aliases = aliasLines.map((line) => line.replace(/^- /, "").trim());
    }
  }

  // 提取标签
  const tagsMatch = mdContent.match(/> 标签：(.*?)\n/);
  if (tagsMatch) {
    fields.tags = tagsMatch[1].split(", ");
  }

  const domainKeyMatch = mdContent.match(/> 业务域Key：(.*?)\n/);
  if (domainKeyMatch) {
    fields.domain_key = domainKeyMatch[1].trim();
  }

  const domainNameMatch = mdContent.match(/> 业务域名：(.*?)\n/);
  if (domainNameMatch) {
    fields.domain_name = domainNameMatch[1].trim();
  }

  const ownedDomainMatch = mdContent.match(/> 所属业务域：(.*?)\n/);
  if (ownedDomainMatch) {
    fields.domain_name = ownedDomainMatch[1].trim();
  }

  return fields;
}

function isBusinessDomainConceptRecord(obj: {
  id: string;
  content: string;
}): boolean {
  const fields = parseYamlFieldsFromMd(obj.content);
  const title = getStringField(fields, "concept_name") ?? obj.id;
  return (
    !title.toUpperCase().startsWith("TERM-") &&
    !obj.id.toLowerCase().startsWith("term-")
  );
}

function stripManagedSection(content: string, marker: string): string {
  const pattern = new RegExp(
    `\\n<!-- ${marker}:START -->[\\s\\S]*?<!-- ${marker}:END -->\\n?`,
    "g",
  );
  return content.replace(pattern, "\n").trimEnd();
}

function appendManagedSection(
  content: string,
  marker: string,
  section: string,
): string {
  const base = stripManagedSection(content, marker).trimEnd();
  return `${base}\n\n<!-- ${marker}:START -->\n${section.trim()}\n<!-- ${marker}:END -->\n`;
}

function replaceDomainHeader(content: string, metadataLines: string[]): string {
  const lines = content.split("\n");
  if (lines.length === 0 || !lines[0].startsWith("# ")) {
    return content;
  }

  const preserved = [lines[0], ""];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "" || line.startsWith("> ")) {
      index++;
      continue;
    }
    break;
  }
  while (index < lines.length && lines[index].trim() === "") {
    index++;
  }

  preserved.push(...metadataLines);
  preserved.push("");
  preserved.push(...lines.slice(index));
  return preserved.join("\n").replace(/\n{3,}/g, "\n\n");
}

function buildDomainRegistryFromObjects(
  objectsByType: Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  >,
  previous: DomainRegistry,
): DomainRegistry {
  const registry: DomainRegistry = {
    updatedAt: new Date().toISOString(),
    domains: previous.domains.map((domain) => ({
      ...domain,
      capabilityRefs: [...domain.capabilityRefs],
      concept: domain.concept ? { ...domain.concept } : undefined,
    })),
  };

  for (const obj of (objectsByType.concepts ?? []).filter(
    isBusinessDomainConceptRecord,
  )) {
    const fields = parseYamlFieldsFromMd(obj.content);
    const domainName =
      getStringField(fields, "domain_name") ??
      getStringField(fields, "concept_name") ??
      obj.id;
    const domainKey =
      getStringField(fields, "domain_key") ??
      deriveDomainKey({
        domainName,
        conceptId: obj.id,
      });
    upsertConceptDomain(registry, {
      domainKey,
      domainName,
      conceptId: obj.id,
      conceptPath: `concepts/${toKebabCase(obj.id)}.md`,
      summaryZh: getStringField(fields, "summary_zh"),
    });
  }

  const conceptPathToDomainKey = new Map<string, string>();
  for (const domain of registry.domains) {
    if (domain.concept) {
      conceptPathToDomainKey.set(
        path.normalize(domain.concept.conceptPath),
        domain.domainKey,
      );
    }
  }

  for (const obj of objectsByType.capabilities ?? []) {
    const fields = parseYamlFieldsFromMd(obj.content);
    const capabilityName =
      getStringField(fields, "capability_name") ??
      getStringField(fields, "concept_name") ??
      obj.id;
    const domainName = getStringField(fields, "domain_name");
    const domainKey = getStringField(fields, "domain_key");
    const relatedConcept = getStringField(fields, "related_concept");
    const relatedConceptKey = relatedConcept
      ? conceptPathToDomainKey.get(path.normalize(relatedConcept))
      : undefined;
    if (!domainName && !domainKey && !relatedConceptKey) continue;
    upsertCapabilityDomain(registry, {
      domainKey: domainKey ?? relatedConceptKey ?? undefined,
      domainName: domainName ?? capabilityName,
      capabilityId: obj.id,
      capabilityName,
      capabilityPath: `capabilities/${toKebabCase(obj.id)}.md`,
      summaryZh: getStringField(fields, "summary_zh"),
    });
  }

  return sortDomainRegistry(registry);
}

async function rewriteConceptDocuments(
  layout: PackageLayout,
  registry: DomainRegistry,
): Promise<void> {
  for (const domain of registry.domains) {
    if (!domain.concept) continue;
    const conceptPath = path.join(
      layout.packageRoot,
      domain.concept.conceptPath,
    );
    let content: string;
    try {
      content = await fs.readFile(conceptPath, "utf-8");
    } catch {
      continue;
    }

    const withHeader = replaceDomainHeader(content, [
      `> 业务域名：${domain.domainName}`,
      `> 业务域Key：${domain.domainKey}`,
    ]);

    const capabilityLines: string[] = ["## 业务域内能力", ""];
    if (domain.capabilityRefs.length === 0) {
      capabilityLines.push("- 当前还没有挂接到该业务域的 capability。");
    } else {
      capabilityLines.push("| 能力 | 摘要 | 文档 |");
      capabilityLines.push("|------|------|------|");
      for (const capability of domain.capabilityRefs) {
        capabilityLines.push(
          `| ${capability.capabilityName} | ${capability.summaryZh ?? "-"} | [查看](${path.relative(path.dirname(conceptPath), path.join(layout.packageRoot, capability.capabilityPath)).replace(/\\/g, "/")}) |`,
        );
      }
    }

    const rewritten = appendManagedSection(
      withHeader,
      MANAGED_CONCEPT_SECTION,
      capabilityLines.join("\n"),
    );
    await fs.writeFile(conceptPath, rewritten, "utf-8");
  }
}

async function rewriteCapabilityDocuments(
  layout: PackageLayout,
  registry: DomainRegistry,
): Promise<void> {
  for (const domain of registry.domains) {
    const conceptPath = domain.concept?.conceptPath;
    for (const capability of domain.capabilityRefs) {
      const capabilityPath = path.join(
        layout.packageRoot,
        capability.capabilityPath,
      );
      let content: string;
      try {
        content = await fs.readFile(capabilityPath, "utf-8");
      } catch {
        continue;
      }

      const metadataLines = [
        `> 所属业务域：${domain.domainName}`,
        `> 业务域Key：${domain.domainKey}`,
      ];
      if (conceptPath) {
        metadataLines.push(
          `> 业务域文档：[${domain.domainName}](${path.relative(path.dirname(capabilityPath), path.join(layout.packageRoot, conceptPath)).replace(/\\/g, "/")})`,
        );
      }

      const withHeader = replaceDomainHeader(content, metadataLines);
      const sectionLines = [
        "## 0. 业务域归属",
        "",
        `- 该 capability 属于业务域 **${domain.domainName}**。`,
        conceptPath
          ? `- 优先先阅读 [业务域主文档](${path.relative(path.dirname(capabilityPath), path.join(layout.packageRoot, conceptPath)).replace(/\\/g, "/")})，再进入当前 capability。`
          : "- 当前业务域主文档尚未生成。",
      ];
      const rewritten = appendManagedSection(
        withHeader,
        MANAGED_CAPABILITY_SECTION,
        sectionLines.join("\n"),
      );
      await fs.writeFile(capabilityPath, rewritten, "utf-8");
    }
  }
}

/**
 * Generate global index.md per design/03-knowledge-directory-structure.md.
 * 包含业务域导航表（多模块项目标注模块归属）。
 */
function generateGlobalIndex(
  layout: PackageLayout,
  objectsByType: Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  >,
  registry: DomainRegistry,
  moduleTopology?: ModuleTopology,
): string {
  const lines: string[] = [];
  const repoName = path.basename(
    layout.packageRoot
      .replace(`/${DEFAULT_KNOWLEDGE_DIR}`, "")
      .replace(`\\${DEFAULT_KNOWLEDGE_DIR}`, ""),
  );

  lines.push(`# ${repoName} - 知识库索引`);
  lines.push("");
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  if (moduleTopology && moduleTopology.moduleCount > 1) {
    lines.push(
      `> 耦合模式：${moduleTopology.couplingMode === "tightly-coupled" ? "紧耦合" : "松耦合"}`,
    );
    lines.push(`> 模块数量：${moduleTopology.moduleCount}`);
  }
  lines.push("");

  // 架构概览链接（在所有知识类型之前）
  lines.push(`## 架构概览`);
  lines.push("");
  lines.push(
    `[查看项目架构概览](architecture.md) — 了解项目整体结构、技术栈和入口导航`,
  );
  if (moduleTopology && moduleTopology.moduleCount > 1) {
    lines.push(
      `[查看模块拓扑](modules.json) — 了解模块结构、依赖关系和角色分配`,
    );
  }
  lines.push("");

  // 业务域导航表（按业务域聚合，模块仅作为证据来源展示）
  const domainNavigation = buildDomainNavigation(
    objectsByType,
    registry,
    moduleTopology,
  );
  if (domainNavigation.length > 0) {
    lines.push(`## 业务域导航`);
    lines.push("");
    lines.push(
      "按业务域聚合跨类型知识，模块只作为证据来源，不作为一级分组键。",
    );
    lines.push("");
    lines.push("| 业务域 | 业务域文档 | 能力 | 约束 | 数据聚合 | 证据模块 |");
    lines.push("|--------|------------|------|------|----------|----------|");
    for (const row of domainNavigation) {
      lines.push(
        `| ${row.domain} | ${row.concepts} | ${row.capabilities} | ${row.constraints} | ${row.dataModels} | ${row.modules} |`,
      );
    }
    lines.push("");
  }

  // 概念知识
  if (objectsByType.concepts && objectsByType.concepts.length > 0) {
    lines.push(`## 概念知识`);
    lines.push("");
    lines.push("| 概念 | 简要说明 | 文件 |");
    lines.push("|------|---------|------|");
    for (const obj of objectsByType.concepts.filter(
      isBusinessDomainConceptRecord,
    )) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const fileName = toKebabCase(obj.id) + ".md";
      // 使用概念名称而不是英文 ID
      const conceptName = getStringField(fields, "concept_name") ?? obj.id;
      // 使用一句话定位而不是业务含义（更简洁）
      const summaryZh =
        getStringField(fields, "summary_zh") ??
        getStringField(fields, "business_meaning_zh") ??
        "";
      lines.push(
        `| ${conceptName} | ${summaryZh} | [concepts/${fileName}](concepts/${fileName}) |`,
      );
    }
    lines.push("");
  }

  // 能力目录
  if (objectsByType.capabilities && objectsByType.capabilities.length > 0) {
    lines.push(`## 能力目录`);
    lines.push("");
    lines.push("| 域名 | 文件 |");
    lines.push("|------|------|");
    for (const obj of objectsByType.capabilities) {
      const fileName = toKebabCase(obj.id) + ".md";
      lines.push(
        `| ${obj.id} | [capabilities/${fileName}](capabilities/${fileName}) |`,
      );
    }
    lines.push("");
  }

  // 其他类型...
  const typeOrder: KnowledgeDir[] = [
    "boundaries",
    "external-systems",
    "constraints",
    "relations",
    "data-model",
    "workflows",
  ];
  const typeNames: Record<KnowledgeDir, string> = {
    capabilities: "能力目录",
    concepts: "概念知识",
    boundaries: "边界知识",
    "external-systems": "外部系统交互",
    constraints: "约束知识",
    relations: "能力关系",
    "data-model": "数据模型",
    workflows: "跨域业务流程",
  };

  for (const dir of typeOrder) {
    if (objectsByType[dir] && objectsByType[dir].length > 0) {
      lines.push(`## ${typeNames[dir]}`);
      lines.push("");
      lines.push("| 名称 | 文件 |");
      lines.push("|------|------|");
      for (const obj of objectsByType[dir]) {
        const fileName = toKebabCase(obj.id) + ".md";
        lines.push(`| ${obj.id} | [${dir}/${fileName}](${dir}/${fileName}) |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 构建业务域导航表
 *
 * 从已生成的知识中提取业务域，按域聚合跨类型引用。
 */
function buildDomainNavigation(
  objectsByType: Record<
    KnowledgeDir,
    Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>
  >,
  registry: DomainRegistry,
  moduleTopology?: ModuleTopology,
): Array<{
  domain: string;
  modules: string;
  capabilities: string;
  concepts: string;
  constraints: string;
  dataModels: string;
}> {
  const domainMap: Map<
    string,
    {
      capabilities: string[];
      concepts: string[];
      constraints: string[];
      dataModels: string[];
      modules: Set<string>;
    }
  > = new Map();

  for (const domain of registry.domains) {
    domainMap.set(domain.domainKey, {
      capabilities: domain.capabilityRefs.map(
        (item) => `[${item.capabilityName}](${item.capabilityPath})`,
      ),
      concepts: domain.concept
        ? [`[${domain.domainName}](${domain.concept.conceptPath})`]
        : ["-"],
      constraints: [],
      dataModels: [],
      modules: new Set(),
    });
  }

  // 从约束知识中提取业务域（通过 tags）
  if (objectsByType.constraints) {
    for (const obj of objectsByType.constraints) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const domain =
        getStringField(fields, "domain_key") ?? obj.id.split("-")[0] ?? obj.id;
      const fileName = toKebabCase(obj.id) + ".md";

      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          capabilities: [],
          concepts: [],
          constraints: [],
          dataModels: [],
          modules: new Set(),
        });
      }

      const entry = domainMap.get(domain)!;
      entry.constraints.push(`[${obj.id}](constraints/${fileName})`);
    }
  }

  // 从数据模型中提取业务域
  if (objectsByType["data-model"]) {
    for (const obj of objectsByType["data-model"]) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const domain =
        getStringField(fields, "domain_key") ?? obj.id.split("-")[0] ?? obj.id;
      const fileName = toKebabCase(obj.id) + ".md";

      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          capabilities: [],
          concepts: [],
          constraints: [],
          dataModels: [],
          modules: new Set(),
        });
      }

      const entry = domainMap.get(domain)!;
      entry.dataModels.push(`[${obj.id}](data-model/${fileName})`);
    }
  }

  // 如果是多模块项目，只记录证据覆盖的模块，不参与业务域分组
  if (moduleTopology && moduleTopology.moduleCount > 1) {
    for (const module of moduleTopology.modules) {
      for (const entry of domainMap.values()) {
        if (
          module.path &&
          entry.capabilities.some((item) => item.includes(module.path))
        ) {
          entry.modules.add(module.name);
        }
      }
    }
  }

  // 转换为表格行
  const rows: Array<{
    domain: string;
    modules: string;
    capabilities: string;
    concepts: string;
    constraints: string;
    dataModels: string;
  }> = [];

  for (const [domainKey, entry] of domainMap.entries()) {
    const registryEntry = registry.domains.find(
      (item) => item.domainKey === domainKey,
    );
    const domain = registryEntry?.domainName ?? domainKey;
    // 每个域最多显示 3 个引用
    const capLinks = entry.capabilities.slice(0, 3).join(", ") || "-";
    const conLinks = entry.concepts.slice(0, 3).join(", ") || "-";
    const constLinks = entry.constraints.slice(0, 3).join(", ") || "-";
    const dmLinks = entry.dataModels.slice(0, 3).join(", ") || "-";
    const modules =
      entry.modules.size > 0 ? Array.from(entry.modules).join(", ") : "-";

    rows.push({
      domain,
      modules,
      capabilities: capLinks,
      concepts: conLinks,
      constraints: constLinks,
      dataModels: dmLinks,
    });
  }

  // 按引用数量排序（优先显示有多个类型的域）
  rows.sort((a, b) => {
    const aCount =
      (a.capabilities !== "-" ? 1 : 0) +
      (a.concepts !== "-" ? 1 : 0) +
      (a.constraints !== "-" ? 1 : 0) +
      (a.dataModels !== "-" ? 1 : 0);
    const bCount =
      (b.capabilities !== "-" ? 1 : 0) +
      (b.concepts !== "-" ? 1 : 0) +
      (b.constraints !== "-" ? 1 : 0) +
      (b.dataModels !== "-" ? 1 : 0);
    return bCount - aCount;
  });

  return rows.slice(0, 10); // 最多显示 10 个业务域
}

/**
 * Generate _glossary.md for concepts directory.
 * Per design/03-knowledge-directory-structure.md: 术语速查表，帮助 Agent 快速匹配术语。
 */
function generateGlossary(
  objects: Array<{
    id: string;
    type: KnowledgeType | LegacyType;
    content: string;
  }>,
): string {
  const lines: string[] = [];

  lines.push("# 术语速查");
  lines.push("");
  lines.push("| 术语 | 定义 | 别名 | 详情 |");
  lines.push("|------|------|------|------|");

  for (const obj of objects.filter(isBusinessDomainConceptRecord)) {
    const fields = parseYamlFieldsFromMd(obj.content);
    const fileName = toKebabCase(obj.id) + ".md";

    // 使用概念名称作为术语显示，而不是英文 ID
    const conceptName = getStringField(fields, "concept_name") ?? obj.id;

    // 定义优先使用 summary_zh（一句话定位），其次使用 business_meaning_zh
    const definition =
      getStringField(fields, "summary_zh") ??
      getStringField(fields, "business_meaning_zh") ??
      "";

    // 别名格式化
    const aliases = getArrayField<string>(fields, "aliases");
    const aliasesStr = aliases && aliases.length > 0 ? aliases.join(", ") : "";

    lines.push(
      `| ${conceptName} | ${definition} | ${aliasesStr} | [${fileName}](${fileName}) |`,
    );
  }

  return lines.join("\n");
}
