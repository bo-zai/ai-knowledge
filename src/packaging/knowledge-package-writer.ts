import fs from 'node:fs/promises';
import path from 'node:path';
import type { GenerateKnowledge, GenerateTarget } from '../knowledge/generate-scope.js';
import type { KnowledgePackageContribution } from './knowledge-package-contribution.js';
import type { PackageLayout, KnowledgeDir } from '../knowledge/init-directory.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';
import { toKebabCase, getTypeFromDir } from '../knowledge/type-directory-map.js';
import type { KnowledgeType, LegacyType } from '../schemas/knowledge-type.js';
import { getTypeDir } from '../schemas/knowledge-type.js';

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

  // 收集所有生成的对象
  const objects = contributions.flatMap(c => c.objects);

  // 按类型分组
  const objectsByType: Record<KnowledgeDir, Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>> = {} as Record<KnowledgeDir, Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>>;

  // 写入各知识类型文件
  for (const contribution of contributions) {
    for (const file of contribution.files) {
      // 解析文件路径，获取类型和内容
      const { id, type, content } = parseFileData(file);
      const dirName = getTypeDir(type);
      const dir = dirName as KnowledgeDir;

      if (!objectsByType[dir]) {
        objectsByType[dir] = [];
      }

      // 转换为 kebab-case 文件名
      const fileName = toKebabCase(id) + '.md';
      const filePath = path.join(layout.knowledgeDirs[dir], fileName);

      // 写入 md 文件
      await fs.writeFile(filePath, content, 'utf-8');

      objectsByType[dir].push({ id, type, content });
    }
  }

  // 生成各目录的 _index.md
  for (const [dirName, dirObjects] of Object.entries(objectsByType)) {
    if (dirObjects.length > 0) {
      const indexPath = path.join(layout.knowledgeDirs[dirName as KnowledgeDir], '_index.md');
      const indexContent = generateTypeIndex(dirName as KnowledgeDir, dirObjects);
      await fs.writeFile(indexPath, indexContent, 'utf-8');
    }
  }

  // 生成全局 index.md
  const indexMdContent = generateGlobalIndex(layout, objectsByType);
  await fs.writeFile(layout.indexMdPath, indexMdContent, 'utf-8');

  // 写入生成报告
  const report = {
    knowledge: input.knowledge,
    target: input.target ?? null,
    stages: Object.fromEntries(contributions.map(c => [c.stage, c.report])),
    warnings: contributions.flatMap(c => c.warnings),
  };
  await fs.writeFile(
    path.join(layout.reportsDir, 'generation.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Parse file data to extract id, type and convert yaml to md content.
 */
function parseFileData(file: { path: string; content: string }): { id: string; type: KnowledgeType | LegacyType; content: string } {
  // 文件路径格式: objects/{dir}/{id}.yaml
  const parts = file.path.split('/');
  const dirName = parts[1]?.toLowerCase() || 'concepts';
  const fileName = parts[2] || '';
  const id = fileName.replace('.yaml', '');

  // 从目录名获取类型
  const type = getTypeFromDir(dirName) ?? 'CONCEPT';

  // 将 yaml 内容转换为 md 格式
  const mdContent = yamlToMd(id, type, file.content);

  return { id, type, content: mdContent };
}

/**
 * Convert yaml content to markdown format per design/03-knowledge-directory-structure.md.
 */
function yamlToMd(id: string, type: KnowledgeType | LegacyType, yamlContent: string): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 解析 yaml 字段
  const fields = parseYamlFields(yamlContent);

  // 头部格式（设计文档要求）
  const conceptName = getStringField(fields, 'concept_name') ?? id;
  lines.push(`# ${conceptName}`);
  lines.push('');
  lines.push(`> 类型：${type}`);
  lines.push(`> 生成时间：${timestamp}`);
  const codeManifestation = getArrayField<Record<string, string>>(fields, 'code_manifestation');
  if (codeManifestation) {
    const sources = extractSourceFiles(codeManifestation);
    lines.push(`> 来源文件：${sources.join(', ')}`);
  }
  const tags = getArrayField<string>(fields, 'tags');
  if (tags) {
    lines.push(`> 标签：${formatTags(tags)}`);
  }
  lines.push('');

  // 别名
  const aliases = getArrayField<string>(fields, 'aliases');
  if (aliases && aliases.length > 0) {
    lines.push(`## 别名`);
    lines.push('');
    lines.push(`代码中的英文命名和业务术语中的其他叫法：`);
    lines.push('');
    for (const alias of aliases) {
      lines.push(`- ${alias}`);
    }
    lines.push('');
  }

  // 业务含义
  const businessMeaning = getStringField(fields, 'business_meaning_zh');
  if (businessMeaning) {
    lines.push(`## 业务含义`);
    lines.push('');
    lines.push(businessMeaning);
    lines.push('');
  }

  // 关键区分
  const keyDifferentiation = getStringField(fields, 'key_differentiation');
  if (keyDifferentiation) {
    lines.push(`## 关键区分`);
    lines.push('');
    lines.push(keyDifferentiation);
    lines.push('');
  }

  // 取值说明
  const valueExplanation = getArrayField<Record<string, string>>(fields, 'value_explanation');
  if (valueExplanation && valueExplanation.length > 0) {
    lines.push(`## 取值说明`);
    lines.push('');
    for (const exp of valueExplanation) {
      if (exp.value && exp.business_meaning_zh) {
        lines.push(`- **${exp.value}**：${exp.business_meaning_zh}`);
      } else {
        lines.push(`- ${JSON.stringify(exp)}`);
      }
    }
    lines.push('');
  }

  // 关联概念
  const relatedConcepts = getArrayField<string>(fields, 'related_concepts');
  if (relatedConcepts && relatedConcepts.length > 0) {
    lines.push(`## 关联概念`);
    lines.push('');
    for (const concept of relatedConcepts) {
      lines.push(`- ${concept}`);
    }
    lines.push('');
  }

  if (codeManifestation) {
    lines.push(`## 代码体现`);
    lines.push('');
    lines.push('| 类型 | 名称 | 位置 |');
    lines.push('|------|------|------|');
    for (const m of codeManifestation) {
      lines.push(`| ${m.kind || 'class'} | ${m.name || ''} | ${m.location || ''} |`);
    }
    lines.push('');
  }

  const applicableScope = getStringField(fields, 'applicable_scope');
  if (applicableScope) {
    lines.push(`## 适用范围`);
    lines.push('');
    lines.push(applicableScope);
    lines.push('');
  }

  const confidence = getStringField(fields, 'confidence');
  if (confidence) {
    lines.push(`## 置信度`);
    lines.push('');
    lines.push(confidence);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse yaml fields from string.
 */
function parseYamlFields(yaml: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = yaml.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2];

      if (value.startsWith('[')) {
        // 数组
        try {
          fields[key] = JSON.parse(value);
        } catch {
          fields[key] = [];
        }
      } else if (value.startsWith('"') || value.startsWith("'")) {
        // 字符串
        fields[key] = value.slice(1, -1);
      } else {
        fields[key] = value;
      }
    }
  }

  return fields;
}

/**
 * Helper to get string field from parsed yaml fields.
 */
function getStringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Helper to get array field from parsed yaml fields.
 */
function getArrayField<T>(fields: Record<string, unknown>, key: string): T[] | undefined {
  const value = fields[key];
  return Array.isArray(value) ? value as T[] : undefined;
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
  if (!Array.isArray(tags)) return '';
  return tags.filter(Boolean).join(', ');
}

/**
 * Generate type-specific _index.md per design/03-knowledge-directory-structure.md.
 */
function generateTypeIndex(dir: KnowledgeDir, objects: Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>): string {
  const lines: string[] = [];

  const dirNames: Record<KnowledgeDir, string> = {
    capabilities: '能力目录索引',
    concepts: '概念知识索引',
    boundaries: '边界知识索引',
    'external-systems': '外部系统交互索引',
    constraints: '约束知识索引',
    relations: '能力关系索引',
    'data-model': '数据模型索引',
    workflows: '跨域业务流程索引',
  };

  lines.push(`# ${dirNames[dir]}`);
  lines.push('');

  // 根据不同类型生成不同的表格
  if (dir === 'concepts') {
    lines.push('| 概念 | 简要说明 | 标签 | 文件 |');
    lines.push('|------|---------|------|------|');
    for (const obj of objects) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const fileName = toKebabCase(obj.id) + '.md';
      const businessMeaning = getStringField(fields, 'business_meaning_zh') ?? '';
      const tags = getArrayField<string>(fields, 'tags');
      lines.push(`| ${obj.id} | ${businessMeaning} | ${tags ? formatTags(tags) : ''} | [${fileName}](${fileName}) |`);
    }
  } else {
    lines.push('| 名称 | 类型 | 文件 |');
    lines.push('|------|------|------|');
    for (const obj of objects) {
      const fileName = toKebabCase(obj.id) + '.md';
      lines.push(`| ${obj.id} | ${obj.type} | [${fileName}](${fileName}) |`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse fields from markdown content.
 */
function parseYamlFieldsFromMd(mdContent: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  // 提取业务含义
  const businessMatch = mdContent.match(/## 业务含义\s*\n\s*(.*?)\n/);
  if (businessMatch) {
    fields.business_meaning_zh = businessMatch[1];
  }

  // 提取标签
  const tagsMatch = mdContent.match(/> 标签：(.*?)\n/);
  if (tagsMatch) {
    fields.tags = tagsMatch[1].split(', ');
  }

  return fields;
}

/**
 * Generate global index.md per design/03-knowledge-directory-structure.md.
 */
function generateGlobalIndex(layout: PackageLayout, objectsByType: Record<KnowledgeDir, Array<{ id: string; type: KnowledgeType | LegacyType; content: string }>>): string {
  const lines: string[] = [];
  const repoName = path.basename(layout.packageRoot.replace(`/${DEFAULT_KNOWLEDGE_DIR}`, '').replace(`\\${DEFAULT_KNOWLEDGE_DIR}`, ''));

  lines.push(`# ${repoName} - 知识库索引`);
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push('');

  // 概念知识
  if (objectsByType.concepts && objectsByType.concepts.length > 0) {
    lines.push(`## 概念知识`);
    lines.push('');
    lines.push('| 概念 | 简要说明 | 文件 |');
    lines.push('|------|---------|------|');
    for (const obj of objectsByType.concepts) {
      const fields = parseYamlFieldsFromMd(obj.content);
      const fileName = toKebabCase(obj.id) + '.md';
      const businessMeaning = getStringField(fields, 'business_meaning_zh') ?? '';
      lines.push(`| ${obj.id} | ${businessMeaning} | [concepts/${fileName}](concepts/${fileName}) |`);
    }
    lines.push('');
  }

  // 能力目录
  if (objectsByType.capabilities && objectsByType.capabilities.length > 0) {
    lines.push(`## 能力目录`);
    lines.push('');
    lines.push('| 域名 | 文件 |');
    lines.push('|------|------|');
    for (const obj of objectsByType.capabilities) {
      const fileName = toKebabCase(obj.id) + '.md';
      lines.push(`| ${obj.id} | [capabilities/${fileName}](capabilities/${fileName}) |`);
    }
    lines.push('');
  }

  // 其他类型...
  const typeOrder: KnowledgeDir[] = ['boundaries', 'external-systems', 'constraints', 'relations', 'data-model', 'workflows'];
  const typeNames: Record<KnowledgeDir, string> = {
    capabilities: '能力目录',
    concepts: '概念知识',
    boundaries: '边界知识',
    'external-systems': '外部系统交互',
    constraints: '约束知识',
    relations: '能力关系',
    'data-model': '数据模型',
    workflows: '跨域业务流程',
  };

  for (const dir of typeOrder) {
    if (objectsByType[dir] && objectsByType[dir].length > 0) {
      lines.push(`## ${typeNames[dir]}`);
      lines.push('');
      lines.push('| 名称 | 文件 |');
      lines.push('|------|------|');
      for (const obj of objectsByType[dir]) {
        const fileName = toKebabCase(obj.id) + '.md';
        lines.push(`| ${obj.id} | [${dir}/${fileName}](${dir}/${fileName}) |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}