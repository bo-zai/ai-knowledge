/**
 * 项目类型识别模块
 *
 * 通过 LLM 从项目证据中识别项目类型，结果存储在 project-context.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger.js';
import { PromptLoader } from '../shared/prompt-loader.js';
import { LLM_DEFAULTS } from '../config/defaults.js';
import { callLlmForJson } from '../generation/llm-json-client.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';
import {
  type ProjectTypeIdentificationResult,
  type ProjectContext,
  type ProjectTypeEvidence,
} from './project-context.js';

/** 默认知识库目录名 */
const DEFAULT_KNOWLEDGE_DIR = 'ai-knowledge';

/**
 * 收集项目类型识别证据
 */
export async function collectProjectTypeEvidence(repoPath: string): Promise<ProjectTypeEvidence> {
  // 收集目录树（顶层 2 层）
  const directoryTree = await collectDirectoryTree(repoPath, 2);

  // 收集配置文件
  const configFiles = await collectConfigFiles(repoPath);

  // 收集入口文件候选
  const entryCandidates = await collectEntryCandidates(repoPath);

  // 收集 README 片段
  const readmeSnippet = await collectReadmeSnippet(repoPath);

  // 收集依赖列表
  const dependencies = await collectDependencies(repoPath);

  return {
    directoryTree,
    configFiles,
    entryCandidates,
    readmeSnippet,
    dependencies,
  };
}

/**
 * 使用 LLM 识别项目类型
 */
export async function identifyProjectType(
  evidence: ProjectTypeEvidence,
  claimsProvider: LlmClaimsProvider,
): Promise<ProjectTypeIdentificationResult> {
  // 加载识别提示词
  const promptTemplate = PromptLoader.load('project-type-identifier');

  // 构建用户提示词
  const userPrompt = JSON.stringify({
    directory_tree: evidence.directoryTree,
    config_files: evidence.configFiles,
    entry_candidates: evidence.entryCandidates,
    readme_snippet: evidence.readmeSnippet || '',
    dependencies: evidence.dependencies.slice(0, 30), // 限制依赖数量
  }, null, 2);

  logger.debug('Identifying project type with LLM...');

  // 调用 LLM
  const result = await callLlmForJson<ProjectTypeIdentificationResult>({
    systemPrompt: promptTemplate.raw,
    userPrompt,
    claimsProvider,
    maxRetries: LLM_DEFAULTS.maxRetries,
    logLabel: 'Project type identification',
  });

  if (!result.success || !result.data) {
    logger.warn(`Project type identification failed, using fallback`);
    // 降级：从证据中简单推断
    return inferProjectTypeFromEvidence(evidence);
  }

  // 使用 buildProjectContext 处理 snake_case/camelCase 字段名转换
  const context = buildProjectContext(result.data);

  logger.info(`Project type identified: ${context.projectType} (confidence: ${context.confidence})`);

  // 返回转换后的结果
  return {
    projectType: context.projectType,
    primaryLanguage: context.primaryLanguage,
    framework: context.framework,
    techStack: context.techStack,
    confidence: context.confidence,
    identificationEvidence: context.identificationEvidence,
  };
}

/**
 * 保存项目上下文到文件
 */
export async function saveProjectContext(
  context: ProjectContext,
  outputRoot: string,
): Promise<void> {
  const knowledgeDir = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR);
  const filePath = path.join(knowledgeDir, 'project-context.json');

  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(context, null, 2) + '\n', 'utf-8');

  logger.debug(`Project context saved to ${filePath}`);
}

/**
 * 读取已有的项目上下文
 */
export async function loadProjectContext(outputRoot: string): Promise<ProjectContext | null> {
  const filePath = path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR, 'project-context.json');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ProjectContext;
  } catch {
    return null;
  }
}

/**
 * 从识别结果构建项目上下文
 * 支持 snake_case 和 camelCase 字段名
 */
export function buildProjectContext(result: ProjectTypeIdentificationResult | Record<string, unknown>): ProjectContext {
  // 转换为通用对象处理
  const raw = result as Record<string, unknown>;

  // 处理 snake_case 字段名转换
  const projectType = (raw.projectType ?? raw.project_type) as ProjectContext['projectType'] ?? 'unknown';
  const primaryLanguage = (raw.primaryLanguage ?? raw.primary_language) as ProjectContext['primaryLanguage'] ?? 'other';
  const framework = raw.framework as string | undefined;
  const techStack = (raw.techStack ?? raw.tech_stack) as string[] ?? [];
  const confidence = raw.confidence as number ?? 0.5;
  const identificationEvidence = (raw.identificationEvidence ?? raw.identification_evidence) as string[] ?? [];

  return {
    projectType,
    primaryLanguage,
    framework,
    techStack,
    confidence,
    identifiedAt: new Date().toISOString(),
    identificationEvidence,
  };
}

/**
 * 从证据简单推断项目类型（降级方案）
 */
function inferProjectTypeFromEvidence(evidence: ProjectTypeEvidence): ProjectTypeIdentificationResult {
  const tree = evidence.directoryTree.toLowerCase();
  const deps = evidence.dependencies.join(',').toLowerCase();

  // 简单规则推断
  let projectType: ProjectTypeIdentificationResult['projectType'] = 'unknown';
  let primaryLanguage: ProjectTypeIdentificationResult['primaryLanguage'] = 'other';
  let framework: string | undefined;
  const techStack: string[] = [];
  const identificationEvidence: string[] = [];

  // 检测语言
  if (deps.includes('spring') || evidence.configFiles.some(f => f.endsWith('pom.xml'))) {
    primaryLanguage = 'java';
    framework = 'spring-boot';
    techStack.push('Spring Boot');
  }
  if (deps.includes('react') || deps.includes('vue') || deps.includes('angular')) {
    primaryLanguage = 'typescript';
    techStack.push('React/Vue/Angular');
  }
  if (deps.includes('commander') || deps.includes('yargs')) {
    primaryLanguage = 'typescript';
    projectType = 'cli-tool';
    identificationEvidence.push('CLI 依赖：commander/yargs');
  }

  // 检测项目类型
  if (tree.includes('packages/') || tree.includes('apps/')) {
    projectType = 'monorepo';
    identificationEvidence.push('存在 packages/ 或 apps/ 目录');
  } else if (tree.includes('controller') && tree.includes('service')) {
    projectType = 'backend-service';
    identificationEvidence.push('存在 controller/service 分层');
  } else if (tree.includes('components') && (deps.includes('react') || deps.includes('vue'))) {
    projectType = 'frontend-app';
    identificationEvidence.push('存在 components 目录 + UI 框架依赖');
  } else if (tree.includes('bin/') || tree.includes('cli')) {
    projectType = 'cli-tool';
    identificationEvidence.push('存在 bin/ 或 cli 目录');
  }

  return {
    projectType,
    primaryLanguage,
    framework,
    techStack,
    confidence: 0.5, // 降级方案置信度较低
    identificationEvidence,
  };
}

// ========== 证据收集辅助函数 ==========

async function collectDirectoryTree(repoPath: string, depth: number): Promise<string> {
  const lines: string[] = [];
  await walkDirectory(repoPath, '', depth, lines);
  return lines.join('\n');
}

async function walkDirectory(dir: string, prefix: string, maxDepth: number, lines: string[]): Promise<void> {
  if (maxDepth <= 0) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    // 排序并过滤无关目录
    const filtered = entries
      .filter(e => !shouldExclude(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      const line = prefix + entry.name + (entry.isDirectory() ? '/' : '');
      lines.push(line);

      if (entry.isDirectory() && maxDepth > 1) {
        await walkDirectory(path.join(dir, entry.name), prefix + '  ', maxDepth - 1, lines);
      }
    }
  } catch {
    // 目录读取失败，忽略
  }
}

function shouldExclude(name: string): boolean {
  const excludePatterns = [
    'node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'target',
    'out', '.knowledge', 'ai-knowledge', '.codegraph', '.claude',
  ];
  return excludePatterns.includes(name) || name.startsWith('.');
}

async function collectConfigFiles(repoPath: string): Promise<string[]> {
  const patterns = ['pom.xml', 'build.gradle', 'package.json', 'go.mod', 'Cargo.toml', 'requirements.txt'];
  const files: string[] = [];

  for (const pattern of patterns) {
    const filePath = path.join(repoPath, pattern);
    try {
      await fs.access(filePath);
      files.push(pattern);
    } catch {
      // 文件不存在
    }
  }

  return files;
}

async function collectEntryCandidates(repoPath: string): Promise<string[]> {
  // 扫描常见入口文件
  const candidates: string[] = [];

  const patterns = [
    // Java
    '**/*Application.java',
    // TypeScript/JavaScript
    'src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx',
    'src/cli.ts', 'bin/cli.js', 'src/app.ts',
    // Go
    'main.go', 'cmd/*/main.go',
  ];

  // 简化：只检查顶层目录
  const checkPaths = [
    'src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/cli.ts',
    'main.go', 'Application.java',
  ];

  for (const p of checkPaths) {
    try {
      await fs.access(path.join(repoPath, p));
      candidates.push(p);
    } catch {
      // 文件不存在
    }
  }

  return candidates;
}

async function collectReadmeSnippet(repoPath: string): Promise<string | undefined> {
  const readmePath = path.join(repoPath, 'README.md');
  try {
    const content = await fs.readFile(readmePath, 'utf-8');
    // 提取前 500 字符
    const snippet = content.slice(0, 500).split('\n').slice(0, 10).join('\n');
    return snippet;
  } catch {
    return undefined;
  }
}

async function collectDependencies(repoPath: string): Promise<string[]> {
  const deps: string[] = [];

  // 从 package.json 提取
  const packageJsonPath = path.join(repoPath, 'package.json');
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.dependencies) deps.push(...Object.keys(pkg.dependencies));
    if (pkg.devDependencies) deps.push(...Object.keys(pkg.devDependencies));
  } catch {
    // package.json 不存在或解析失败
  }

  // 从 pom.xml 提取（简化：只提取 groupId）
  const pomPath = path.join(repoPath, 'pom.xml');
  try {
    const content = await fs.readFile(pomPath, 'utf-8');
    // 简化提取：匹配 <groupId>
    const matches = content.match(/<groupId>([^<]+)</g);
    if (matches) {
      deps.push(...matches.map(m => m.replace('<groupId>', '').replace('</', '')));
    }
  } catch {
    // pom.xml 不存在
  }

  return deps.slice(0, 50); // 限制数量
}