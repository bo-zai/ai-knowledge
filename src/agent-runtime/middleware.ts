/**
 * SummarizationMiddleware: 上下文压缩中间件
 *
 * 实现自动上下文压缩和智能摘要功能
 * 参考 CmbCoworkAgent 的 createSummarizationMiddleware 配置
 */

// ── 类型定义 ───────────────────────────────────────────────────────────

/**
 * Token 阈值类型
 */
export interface TokenThreshold {
  /** 阈值类型 */
  type: "tokens";
  /** token 数量 */
  value: number;
}

/**
 * 参数截断设置
 */
export interface TruncateArgsSettings {
  /** 触发阈值 */
  trigger: TokenThreshold;
  /** 保留阈值 */
  keep: TokenThreshold;
  /** 最大长度（字符） */
  maxLength: number;
}

/**
 * 摘要配置接口
 */
export interface SummarizationConfig {
  /** 模型名称 */
  model: string;
  /** 后端实例 */
  backend: unknown;
  /** 历史记录路径前缀 */
  historyPathPrefix: string;
  /** 摘要提示词（可选） */
  summaryPrompt?: string;
  /** 修剪用于摘要的 token 数（可选） */
  trimTokensToSummarize?: number;
  /** 触发阈值（可选） */
  trigger?: TokenThreshold;
  /** 保留阈值（可选） */
  keep?: TokenThreshold;
  /** 参数截断设置（可选） */
  truncateArgsSettings?: TruncateArgsSettings;
}

/**
 * Token 阈值计算结果
 */
export interface SummarizationThresholds {
  /** 触发摘要的 token 数 */
  triggerTokens: number;
  /** 摘要后保留的 token 数 */
  keepTokens: number;
  /** 工具参数驱逐限制 */
  toolEvictLimit: number;
  /** 用于摘要的输入 token 上限 */
  trimForSummary: number;
}

// ── 常量 ───────────────────────────────────────────────────────────────

/**
 * 摘要保留比例（保留原始上下文的 10%）
 */
const SUMMARY_KEEP_RATIO = 0.1;

/**
 * 摘要输入比例（使用 65% 的上下文窗口作为摘要输入）
 */
const SUMMARY_INPUT_RATIO = 0.65;

/**
 * 摘要输入 token 上限（防止超大上下文的摘要请求）
 */
const SUMMARY_INPUT_TOKEN_CAP = 700_000;

/**
 * 最小保留 token 数（确保摘要后仍有足够的上下文）
 */
const MIN_KEEP_TOKENS = 4_000;

/**
 * 工具驱逐限制的最小值
 */
const MIN_TOOL_EVICT_LIMIT = 6_000;

/**
 * 工具驱逐限制的最大值
 */
const MAX_TOOL_EVICT_LIMIT = 20_000;

/**
 * 默认触发比例（达到 75% 上下文窗口时触发摘要）
 */
const DEFAULT_TRIGGER_RATIO = 0.75;

// ── 摘要提示词 ─────────────────────────────────────────────────────────

/**
 * AI-Wiki 知识图谱生成项目的摘要提示词
 *
 * 针对知识图谱生成场景优化，保留关键的代码分析、架构推理等信息
 */
export const AIWIKI_SUMMARY_PROMPT = `你的任务是为正在进行的 ai-wiki 知识图谱生成对话创建详细的续接摘要。

下一个模型调用将使用你的摘要继续工作。请编写一个紧凑、实用的工程交接文档，保留难以或昂贵恢复的细节。不要包含私有推理或分析草稿。

涵盖以下部分：

1. 主要请求和意图
   - 捕获用户的显式请求、修正、决策和当前期望。
   - 保留确切的日期、分支名称、提交哈希、模型名称、文件路径、配置值和用户原文引用（当它们重要时）。
   - 特别关注知识图谱生成目标：模块边界、代码关系、API 签名等。

2. 当前工作状态
   - 描述压缩前正在处理的内容。
   - 区分已完成工作、进行中工作和剩余工作。
   - 说明变更是否已提交、推送、仅在 worktree 中或尚未执行。
   - 记录图谱生成进度：已解析的模块、已建立的边、待处理的符号。

3. 文件和代码部分
   - 列出检查、修改或创建的文件。
   - 对于每个重要文件，包含相关的符号、常量、函数或代码路径及其重要性。
   - 仅在精确行为否则会模糊时包含简短代码片段。
   - 记录 tree-sitter 解析结果、模块发现状态、import 解析状态。

4. 命令、测试和输出
   - 记录有意义命令的执行及其结果。
   - 包含测试/类型检查失败、已知无关失败和已完成的验证。
   - 特别记录知识图谱生成命令的输出和状态。

5. 技术决策和约束
   - 捕获假设、权衡、拒绝的方法、提供商/模型限制、路由/摘要/token 预算推理和兼容性约束。
   - 记录架构决策：模块划分策略、边类型选择、知识类型分类等。

6. 错误、修复和警告
   - 记录遇到的 bug、根本原因、修复或缓解措施，以及下一个模型应避免重复的内容。
   - 特别关注解析错误、import 解析失败、模块发现异常。

7. 待处理的下一步
   - 仅在直接跟随最新用户请求时列出具体的下一步操作。
   - 如果最新用户请求已完成，请说明，不要发明无关的下一步。
   - 明确指出知识图谱生成的下一步：待解析模块、待建立边、待生成知识。

使用简洁的要点，保持高信息密度。对技术状态要详尽，但避免通用叙述。如果用户使用中文，保留用户相关细节和回复上下文细节的中文表述。

待摘要对话：
{conversation}

摘要：`;

// ── 核心函数 ───────────────────────────────────────────────────────────

/**
 * 计算 token 阈值
 *
 * 参考 CmbCoworkAgent 的阈值计算逻辑：
 * - triggerTokens: 触发摘要的阈值（达到 75% 上下文窗口）
 * - keepTokens: 摘要后保留的阈值（保留 10%，至少 4000）
 * - toolEvictLimit: 工具参数驱逐限制（8%上下文，最小6000，最大20000）
 * - trimForSummary: 摘要输入上限（65%上下文，上限700000）
 *
 * @param maxTokens - 模型的最大上下文窗口大小
 * @returns 计算后的阈值配置
 */
export function computeSummarizationThresholds(
  maxTokens: number,
): SummarizationThresholds {
  // 触发阈值：达到 75% 上下文窗口时触发
  const triggerTokens = Math.floor(maxTokens * DEFAULT_TRIGGER_RATIO);

  // 保留阈值：保留 10%，至少 4000 tokens
  const keepTokens = Math.max(
    Math.floor(maxTokens * SUMMARY_KEEP_RATIO),
    MIN_KEEP_TOKENS,
  );

  // 工具驱逐限制：8% 上下文，范围 6000-20000
  const toolEvictLimit = Math.min(
    MAX_TOOL_EVICT_LIMIT,
    Math.max(Math.floor(maxTokens * 0.08), MIN_TOOL_EVICT_LIMIT),
  );

  // 摘要输入上限：65% 上下文，上限 700000
  const trimForSummary = Math.min(
    SUMMARY_INPUT_TOKEN_CAP,
    Math.floor(maxTokens * SUMMARY_INPUT_RATIO),
  );

  return {
    triggerTokens,
    keepTokens,
    toolEvictLimit,
    trimForSummary,
  };
}

/**
 * 创建摘要中间件选项
 *
 * 根据配置参数构建 createSummarizationMiddleware 所需的选项对象
 *
 * @param config - 摘要配置
 * @param thresholds - token 阈值（可选，自动计算）
 * @returns 摘要中间件选项对象
 */
export function createSummarizationMiddlewareOptions(
  config: SummarizationConfig,
  thresholds?: SummarizationThresholds,
): Record<string, unknown> {
  // 如果未提供阈值，从模型上下文窗口计算
  // 注意：实际实现中需要从模型配置获取 maxTokens
  const defaultMaxTokens = 128_000; // 默认上下文窗口大小
  const computedThresholds =
    thresholds ?? computeSummarizationThresholds(defaultMaxTokens);

  return {
    model: config.model,
    backend: config.backend,
    historyPathPrefix: config.historyPathPrefix,
    ...(config.summaryPrompt && { summaryPrompt: config.summaryPrompt }),
    ...(config.trimTokensToSummarize !== undefined && {
      trimTokensToSummarize: config.trimTokensToSummarize,
    }),
    ...(config.trigger && { trigger: config.trigger }),
    ...(config.keep && { keep: config.keep }),
    ...(config.truncateArgsSettings && {
      truncateArgsSettings: config.truncateArgsSettings,
    }),
    // 如果配置中未指定，使用计算值
    ...(!config.trigger && {
      trigger: { type: "tokens", value: computedThresholds.triggerTokens },
    }),
    ...(!config.keep && {
      keep: { type: "tokens", value: computedThresholds.keepTokens },
    }),
  };
}

/**
 * 创建摘要中间件封装
 *
 * 提供便捷的中间件创建接口，自动处理阈值计算和提示词配置
 *
 * @param model - 模型实例或模型名称
 * @param backend - 后端实例
 * @param maxTokens - 最大上下文窗口（可选）
 * @param customPrompt - 自定义摘要提示词（可选）
 * @returns 摘要中间件配置对象
 */
export function createSummarizationMiddlewareWrapper(
  model: string,
  backend: unknown,
  maxTokens?: number,
  customPrompt?: string,
): {
  options: Record<string, unknown>;
  thresholds: SummarizationThresholds;
} {
  // 确定上下文窗口大小
  const contextWindow = maxTokens ?? 128_000;

  // 计算阈值
  const thresholds = computeSummarizationThresholds(contextWindow);

  // 构建配置
  const config: SummarizationConfig = {
    model,
    backend,
    historyPathPrefix: ".aiwiki/conversation_history",
    summaryPrompt: customPrompt ?? AIWIKI_SUMMARY_PROMPT,
  };

  // 构建参数截断设置
  const truncateArgsSettings: TruncateArgsSettings = {
    trigger: { type: "tokens", value: thresholds.triggerTokens },
    keep: { type: "tokens", value: thresholds.keepTokens },
    maxLength: 2000,
  };

  // 创建选项
  const options = createSummarizationMiddlewareOptions(config, thresholds);

  // 添加参数截断设置
  (options as Record<string, unknown>).truncateArgsSettings =
    truncateArgsSettings;

  return {
    options,
    thresholds,
  };
}

// ── 导出常量供外部使用 ────────────────────────────────────────────────

export {
  SUMMARY_KEEP_RATIO,
  SUMMARY_INPUT_RATIO,
  SUMMARY_INPUT_TOKEN_CAP,
  MIN_KEEP_TOKENS,
  MIN_TOOL_EVICT_LIMIT,
  MAX_TOOL_EVICT_LIMIT,
  DEFAULT_TRIGGER_RATIO,
};
