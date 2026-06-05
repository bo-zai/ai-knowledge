/**
 * 概念知识分层过滤模块
 *
 * 实现设计文档 02-knowledge-type-spec.md 定义的五层过滤策略：
 * 第一层：硬过滤（排除明显无价值的候选）
 * 第二层：软标记（识别可疑候选）
 * 第三层：LLM 筛选（语义判断）
 * 第四层：概念分组（合并）
 * 第五层：LLM 生成
 */

import { execSync } from 'child_process';
import type { KnowledgeType } from '../schemas/knowledge-type.js';
import { PromptLoader } from '../shared/prompt-loader.js';

/**
 * 原始候选（从 AST 图谱查询得到）
 */
export interface ConceptCandidate {
  className: string;
  filePath: string;
  codeSnippet?: string; // 字段定义或枚举值
  enumValues?: string[]; // 枚举值列表（如果是枚举类）
}

/**
 * 软标记类型
 */
export type SuspiciousMark = 'transmission_class' | 'config_class' | 'simple_enum';

/**
 * 经过第一、二层过滤的候选
 */
export interface FilteredCandidate extends ConceptCandidate {
  suspiciousMark?: SuspiciousMark; // 软标记（如有）
}

/**
 * LLM 筛选结果
 */
export interface LlmFilterResult {
  keep: boolean;
  reason: string;
  businessConcept?: string; // 建议的业务概念名称
}

/**
 * 分组后的概念候选
 */
export interface ConceptGroup {
  conceptName: string; // 业务概念名称
  candidates: FilteredCandidate[];
  shouldMerge: boolean;
}

// ============================================================================
// 第一层：硬过滤规则
// ============================================================================

/**
 * 硬过滤规则：排除绝对无价值的候选
 */
export const HARD_FILTER_RULES = {
  // 测试类模式
  testPatterns: [
    /test\//i,
    /Test\.java$/i,
    /Tests\.java$/i,
    /_test\./i,
    /\.spec\./i,
  ],

  // 工具/基础设施类模式
  utilPatterns: [
    /Util$/i,
    /Helper$/i,
    /Common$/i,
    /Base$/i,
    /Abstract$/i,
    /Factory$/i,
    /Builder$/i,
    /Adapter$/i,
    /Wrapper$/i,
    /Proxy$/i,
  ],

  // 框架层包路径模式
  frameworkPaths: [
    /framework\//i,
    /infrastructure\//i,
    /util\//i,
    /common\//i,
    /config\//i, // 纯技术配置包
  ],

  // 启动/入口类模式
  entryPatterns: [
    /Application$/i,
    /Main$/i,
    /Bootstrap$/i,
    /Launcher$/i,
  ],

  // 简单异常类模式（无业务错误码）
  simpleExceptionPatterns: [
    /Exception$/i,
    /Error$/i,
  ],
};

/**
 * 检查文件是否被 gitignore
 */
export function isGitIgnored(filePath: string, repoPath: string): boolean {
  try {
    execSync(
      `git -C "${repoPath}" check-ignore --quiet "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return true; // 文件被 ignore，命令成功返回
  } catch {
    return false; // 文件未被 ignore 或 git 命令失败
  }
}

/**
 * 检查是否匹配任意模式
 */
function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

/**
 * 第一层硬过滤：排除明显无价值的候选
 *
 * 返回 true 表示应该过滤掉（排除）
 */
export function hardFilter(candidate: ConceptCandidate, repoPath: string): boolean {
  const { className, filePath } = candidate;

  // gitignore 检查
  if (isGitIgnored(filePath, repoPath)) {
    return true;
  }

  // 测试类过滤
  if (matchesAnyPattern(filePath, HARD_FILTER_RULES.testPatterns)) {
    return true;
  }

  // 工具/基础设施类过滤
  if (matchesAnyPattern(className, HARD_FILTER_RULES.utilPatterns)) {
    return true;
  }

  // 框架层包路径过滤
  if (matchesAnyPattern(filePath, HARD_FILTER_RULES.frameworkPaths)) {
    return true;
  }

  // 启动/入口类过滤
  if (matchesAnyPattern(className, HARD_FILTER_RULES.entryPatterns)) {
    return true;
  }

  // 简单异常类过滤（无业务错误码的异常）
  if (matchesAnyPattern(className, HARD_FILTER_RULES.simpleExceptionPatterns)) {
    // 注意：这里不检查是否有业务错误码，简单异常类一律过滤
    // 如果有业务错误码的异常需要保留，需要在第三层 LLM 筛选判断
    return true;
  }

  return false; // 通过硬过滤，保留候选
}

/**
 * 批量硬过滤
 */
export function hardFilterBatch(
  candidates: ConceptCandidate[],
  repoPath: string
): ConceptCandidate[] {
  return candidates.filter(c => !hardFilter(c, repoPath));
}

// ============================================================================
// 第二层：软标记规则
// ============================================================================

/**
 * 软标记规则：识别可能不值得生成但需要 LLM 确认的候选
 */
export const SOFT_MARK_RULES = {
  // 传输类模式
  transmissionPatterns: [
    /VO$/i,
    /DTO$/i,
    /Request$/i,
    /Response$/i,
    /Param$/i,
    /Query$/i,
    /Form$/i,
    /Data$/i,
  ],

  // 配置类模式
  configPatterns: [
    /Config$/i,
    /Configuration$/i,
    /Properties$/i,
    /Settings$/i,
  ],
};

/**
 * 第二层软标记：识别可疑候选
 */
export function softMark(candidate: ConceptCandidate): SuspiciousMark | null {
  const { className, enumValues } = candidate;

  // 简单枚举标记（值数量 < 3）
  if (enumValues && enumValues.length < 3) {
    // 检查是否命名自解释（如 MALE/FEMALE）
    const values = enumValues.map(v => v.toUpperCase());
    const selfExplainingPatterns = [
      ['MALE', 'FEMALE'],
      ['TRUE', 'FALSE'],
      ['YES', 'NO'],
      ['ON', 'OFF'],
      ['ENABLE', 'DISABLE'],
    ];

    const isSelfExplaining = selfExplainingPatterns.some(pattern => {
      const upperValues = values.map(v => v.toUpperCase());
      return pattern.every(v => upperValues.includes(v));
    });

    if (isSelfExplaining) {
      return 'simple_enum';
    }
  }

  // 传输类标记
  if (matchesAnyPattern(className, SOFT_MARK_RULES.transmissionPatterns)) {
    return 'transmission_class';
  }

  // 配置类标记
  if (matchesAnyPattern(className, SOFT_MARK_RULES.configPatterns)) {
    return 'config_class';
  }

  return null; // 不需要标记，直接进入下一层
}

/**
 * 批量软标记
 */
export function softMarkBatch(candidates: ConceptCandidate[]): FilteredCandidate[] {
  return candidates.map(c => ({
    ...c,
    suspiciousMark: softMark(c) ?? undefined,
  }));
}

// ============================================================================
// 第三层：LLM 筛选（语义判断）
// ============================================================================

/**
 * 构建第三层 LLM 筛选提示词
 *
 * 使用 src/prompts/concept-filter.md 模板文件
 */
export function buildLlmFilterPrompt(candidate: FilteredCandidate): string {
  const { className, filePath, suspiciousMark, codeSnippet, enumValues } = candidate;

  // 加载提示词模板并填充参数
  const template = PromptLoader.load('concept-filter');

  return template.fill({
    className,
    filePath,
    suspiciousMark: suspiciousMark || undefined,
    codeSnippet: codeSnippet || undefined,
    enumValues: enumValues ? enumValues.join(', ') : undefined,
  });
}

// ============================================================================
// 第四层：概念分组（合并）
// ============================================================================

/**
 * 字符串相似度计算（Jaccard 相似度）
 */
export function stringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;

  const set1 = new Set(s1.toLowerCase().split(''));
  const set2 = new Set(s2.toLowerCase().split(''));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * 提取文件路径的包路径部分
 */
function extractPackagePath(filePath: string): string {
  const parts = filePath.split('/');
  // 排除常见的非业务路径前缀
  const significantParts = parts.filter(p =>
    !['src', 'main', 'java', 'kotlin', 'com', 'org', 'app'].includes(p.toLowerCase())
  );
  return significantParts.slice(-2).join('/');
}

/**
 * 第四层概念分组：合并同一业务概念的多个候选
 *
 * 分组优先级：
 * 1. 同一文件中的多个候选 → 直接合并
 * 2. 同一包路径 + 名称相似度 > 0.7 → 直接合并
 * 3. 跨包路径 + 名称高度相似 → 需要 LLM 确认
 * 4. 名称明显不同 → 不合并
 */
export function groupCandidates(
  candidates: FilteredCandidate[],
  llmResults: Map<string, LlmFilterResult>
): ConceptGroup[] {
  // 只处理 keep=true 的候选
  const keptCandidates = candidates.filter(c => {
    const result = llmResults.get(c.className);
    return result?.keep === true;
  });

  if (keptCandidates.length === 0) {
    return [];
  }

  // 按文件路径分组（第一优先级）
  const fileGroups = new Map<string, FilteredCandidate[]>();
  for (const c of keptCandidates) {
    const key = c.filePath;
    if (!fileGroups.has(key)) {
      fileGroups.set(key, []);
    }
    fileGroups.get(key)!.push(c);
  }

  // 同一文件的候选直接合并
  const groups: ConceptGroup[] = [];
  const processedCandidates = new Set<string>();

  for (const [filePath, fileCandidates] of fileGroups) {
    if (fileCandidates.length > 1) {
      // 同一文件多个候选 → 合并为一个概念
      const conceptNames = fileCandidates.map(c => {
        const result = llmResults.get(c.className);
        return result?.businessConcept || c.className;
      });

      // 选择最短的概念名称作为最终名称
      const finalConceptName = conceptNames.sort((a, b) => a.length - b.length)[0];

      groups.push({
        conceptName: finalConceptName,
        candidates: fileCandidates,
        shouldMerge: true,
      });

      fileCandidates.forEach(c => processedCandidates.add(c.className));
    }
  }

  // 处理单文件候选（按包路径 + 名称相似度分组）
  const remainingCandidates = keptCandidates.filter(c => !processedCandidates.has(c.className));

  // 按包路径分组
  const packageGroups = new Map<string, FilteredCandidate[]>();
  for (const c of remainingCandidates) {
    const packagePath = extractPackagePath(c.filePath);
    if (!packageGroups.has(packagePath)) {
      packageGroups.set(packagePath, []);
    }
    packageGroups.get(packagePath)!.push(c);
  }

  // 同一包路径内按名称相似度合并
  for (const [packagePath, packageCandidates] of packageGroups) {
    const subGroups = groupBySimilarity(packageCandidates, llmResults, 0.7);
    groups.push(...subGroups);
  }

  return groups;
}

/**
 * 按名称相似度分组
 */
function groupBySimilarity(
  candidates: FilteredCandidate[],
  llmResults: Map<string, LlmFilterResult>,
  threshold: number
): ConceptGroup[] {
  const groups: ConceptGroup[] = [];
  const processed = new Set<string>();

  for (const c1 of candidates) {
    if (processed.has(c1.className)) continue;

    const result1 = llmResults.get(c1.className);
    const name1 = result1?.businessConcept || c1.className;

    const groupCandidates: FilteredCandidate[] = [c1];
    processed.add(c1.className);

    for (const c2 of candidates) {
      if (processed.has(c2.className)) continue;

      const result2 = llmResults.get(c2.className);
      const name2 = result2?.businessConcept || c2.className;

      const similarity = stringSimilarity(name1, name2);
      if (similarity > threshold) {
        groupCandidates.push(c2);
        processed.add(c2.className);
      }
    }

    // 选择最短的概念名称
    const conceptNames = groupCandidates.map(c => {
      const result = llmResults.get(c.className);
      return result?.businessConcept || c.className;
    });
    const finalConceptName = conceptNames.sort((a, b) => a.length - b.length)[0];

    groups.push({
      conceptName: finalConceptName,
      candidates: groupCandidates,
      shouldMerge: groupCandidates.length > 1,
    });
  }

  return groups;
}

/**
 * 构建 LLM 分组确认提示词（用于跨包路径 + 名称相似的候选）
 */
export function buildLlmGroupPrompt(group: ConceptGroup): string {
  const candidatesList = group.candidates.map(c => {
    const result = c.suspiciousMark ? `[标记:${c.suspiciousMark}]` : '';
    return `- ${c.className}（${c.filePath}）${result}`;
  }).join('\n');

  const prompt = `以下多个代码元素被识别为可能属于同一业务概念，请判断是否应该合并：

## 候选列表
${candidatesList}

## 输出格式

{
  "shouldMerge": true/false,
  "reason": "说明是否属于同一业务概念",
  "finalConceptName": "如果合并，统一的业务概念名称"
}

只输出 JSON，不要其他解释。`;

  return prompt;
}

// ============================================================================
// 完整分层过滤流程
// ============================================================================

/**
 * 执行第一、二层过滤（不调用 LLM）
 */
export function executeLayer1And2(
  candidates: ConceptCandidate[],
  repoPath: string
): FilteredCandidate[] {
  // 第一层：硬过滤
  const afterHardFilter = hardFilterBatch(candidates, repoPath);

  // 第二层：软标记
  const afterSoftMark = softMarkBatch(afterHardFilter);

  return afterSoftMark;
}

/**
 * 获取候选的简要代码片段（用于 LLM 筛选）
 * 注意：这个函数需要在 AST 查询时填充 codeSnippet 和 enumValues
 */
export function prepareCodeSnippet(candidate: ConceptCandidate): string {
  // 如果已有 codeSnippet，直接返回
  if (candidate.codeSnippet) {
    return candidate.codeSnippet.slice(0, 500); // 限制长度
  }

  // 否则返回类名和文件路径
  return `class ${candidate.className} at ${candidate.filePath}`;
}