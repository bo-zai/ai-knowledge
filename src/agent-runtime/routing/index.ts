/**
 * 模型路由系统实现
 *
 * 参考 CmbCoworkAgent-main/src/main/routing/index.ts
 * 三层路由策略：
 *   Layer 1: 任务类型快速路由
 *   Layer 2: 规则匹配路由（正则表达式）
 *   Layer 3: LLM 分类器路由（可选）
 */

import { createHash } from 'node:crypto';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '../../shared/logger.js';
import type {
  RoutingContext,
  RoutingResult,
  RoutingFeedback,
  ThreadRoutingState,
  Layer2Detail,
  Layer3Result,
  RoutingLayerRecord,
  RoutingTrace,
  ModelTier,
  TaskSource,
} from './types.js';

export type { ModelTier, RoutingContext, RoutingResult, RoutingFeedback, RoutingTrace, TaskSource };

// ─── 常量 ──────────────────────────────────────────────────────────────────

/** Premium 粘性持续时间（毫秒） */
const PREMIUM_STICKY_TTL_MS = 40 * 60 * 1000; // 40 分钟

/** Force Premium 持续时间（毫秒） */
const FORCE_PREMIUM_TTL_MS = 60 * 60 * 1000; // 60 分钟

/** Failover 粘性持续时间（毫秒） */
const FAILOVER_STICKY_TTL_MS = 30 * 60 * 1000; // 30 分钟

/** Layer 3 分类器超时（毫秒） */
const LAYER3_TIMEOUT_MS = 1000;

/** 分类器缓存 TTL（毫秒） */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/** 分类器缓存最大大小 */
const CACHE_MAX_SIZE = 200;

/** 上下文容量比例阈值 */
const CONTEXT_CAPACITY_RATIO = 0.75;

// ─── Layer 2 正则规则 ─────────────────────────────────────────────────────

/**
 * 纯上下文请求模式
 *
 * 模型完全从自身知识回答，无需文件/工具访问
 */
const INCTX_ECONOMY_PATTERN =
  /^(帮(我|忙)?(写|实现|生成|创建|做)(一个|个|段|下)?|写(一个|个|段)|实现(一个|个)?|生成(一个|个)?|解释(一下|下)?|说明(一下|下)?|讲解(一下|下)?|介绍(一下|下)?|[^？?]{0,30}(和|与|vs\.?)[^？?]{0,30}的?(区别|对比|不同)|翻译)/i;

/**
 * 文件系统操作模式
 *
 * 需要 agent 执行工具的动词
 */
const FILESYSTEM_OP_PATTERN =
  /\b(read|open|inspect|look at|check|search|grep|find|run|execute|edit|patch|debug|trace|review|refactor|resume)\b|查看|检查|搜索|查找|读取|打开|运行|执行|调试|排查|重构/i;

/**
 * 文件路径或仓库路径模式
 *
 * 强信号表明需要访问文件系统
 */
const FILE_OR_REPO_PATTERN =
  /(?:^|[\s`"'(])(src\/|app\/|lib\/|packages\/|components\/|tests?\/|[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|json|ya?ml|toml|md|sh|env))/;

/**
 * 严格 economy 允许列表
 *
 * 只有这些模式才安全发送到 economy 模型
 */
const STRICT_ECONOMY_PATTERN =
  /^(你好|hi|hello|ok|okay|好的|收到|谢谢|thanks?|明白了?|嗯+|哦+|👍|✅|翻译|总结一下|概括一下|什么意思|是什么意思|怎么读)/i;

/**
 * 技术/问题意图模式
 *
 * 匹配表明消息有深度，不应归类为 economy
 */
const TECH_QUESTION_PATTERN =
  /为什么|怎么|如何|帮(我|忙)|能不能|有没有|什么是|是什么|原理|机制|区别|对比|报错|错误|异常|问题|bug|issue|error|why|how|what|when|where|which/i;

/**
 * 模糊延续词模式
 *
 * 短但有任务意图，必须到 Layer 3
 */
const AMBIGUOUS_SHORT_PATTERN =
  /^(继续|接着|然后|下一步|next|go on|proceed|continue)$/i;

// ─── 模型配置接口 ─────────────────────────────────────────────────────────

/**
 * 模型配置
 */
export interface ModelConfig {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  tier?: ModelTier;
  maxTokens?: number;
}

/**
 * 模型存储接口（需要外部实现）
 */
export interface ModelStorage {
  /** 获取指定层级的首选模型 */
  getModelByTier(tier: ModelTier): ModelConfig | null;
  /** 获取所有自定义模型配置 */
  getCustomModelConfigs(): ModelConfig[];
  /** 获取全局路由模式 */
  getGlobalRoutingMode(): 'auto' | 'pinned';
  /** 默认最大 token 数 */
  DEFAULT_MAX_TOKENS: number;
}

/**
 * 会话存储接口（需要外部实现）
 */
export interface ThreadStorage {
  /** 获取会话信息 */
  getThread(threadId: string): { metadata?: string } | null;
  /** 更新会话信息 */
  updateThread(threadId: string, patch: { metadata?: string }): void;
}

// 默认存储实现（空实现，需要外部注入）
let modelStorage: ModelStorage = {
  getModelByTier: () => null,
  getCustomModelConfigs: () => [],
  getGlobalRoutingMode: () => 'auto',
  DEFAULT_MAX_TOKENS: 4096,
};

let threadStorage: ThreadStorage = {
  getThread: () => null,
  updateThread: () => {},
};

/**
 * 设置模型存储
 */
export function setModelStorage(storage: ModelStorage): void {
  modelStorage = storage;
}

/**
 * 设置会话存储
 */
export function setThreadStorage(storage: ThreadStorage): void {
  threadStorage = storage;
}

// ─── 分类器缓存 ───────────────────────────────────────────────────────────

const CLASSIFIER_CACHE = new Map<string, { tier: ModelTier; expiresAt: number }>();

/**
 * 清理分类器缓存
 */
function evictClassifierCache(): void {
  const now = Date.now();
  // 使用 Array.from 避免 downlevelIteration 问题
  const entries = Array.from(CLASSIFIER_CACHE.entries());
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) CLASSIFIER_CACHE.delete(key);
  }
  if (CLASSIFIER_CACHE.size > CACHE_MAX_SIZE) {
    const toDelete = Math.floor(CLASSIFIER_CACHE.size / 2);
    let deleted = 0;
    const keys = Array.from(CLASSIFIER_CACHE.keys());
    for (const key of keys) {
      if (deleted >= toDelete) break;
      CLASSIFIER_CACHE.delete(key);
      deleted += 1;
    }
  }
}

/**
 * 计算消息哈希
 */
function hashMessage(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── 会话路由状态 ─────────────────────────────────────────────────────────

/**
 * 读取会话路由状态
 */
function readThreadRoutingState(threadId: string | undefined): ThreadRoutingState | null {
  if (!threadId) return null;
  const row = threadStorage.getThread(threadId);
  if (!row?.metadata) return null;
  try {
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    return (meta.routingState as ThreadRoutingState) ?? null;
  } catch {
    return null;
  }
}

/**
 * 写入会话路由状态
 */
function writeThreadRoutingState(threadId: string, patch: Partial<ThreadRoutingState>): void {
  const row = threadStorage.getThread(threadId);
  if (!row) return;
  let meta: Record<string, unknown> = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    // 保持空对象
  }
  const prev = (meta.routingState as ThreadRoutingState | undefined) ?? {};
  meta.routingState = { ...prev, ...patch };
  threadStorage.updateThread(threadId, { metadata: JSON.stringify(meta) });
}

/**
 * 设置失败回退粘性
 */
export function setFailoverSticky(threadId: string | undefined, modelId: string): void {
  if (!threadId) return;
  try {
    writeThreadRoutingState(threadId, {
      failoverStickyModelId: modelId,
      failoverStickyUntil: Date.now() + FAILOVER_STICKY_TTL_MS,
    });
    logger.info('[ROUTING] Failover sticky 设置', {
      threadId,
      modelId,
      durationMin: FAILOVER_STICKY_TTL_MS / 60_000,
    });
  } catch (err) {
    logger.warn('[ROUTING] Failover sticky 设置失败', { threadId, error: String(err) });
  }
}

/**
 * 记录路由决策
 */
export function rememberRoutingDecision(
  threadId: string | undefined,
  result: RoutingResult,
  failoverStickyModelId?: string
): void {
  if (!threadId) return;
  try {
    const patch: Partial<ThreadRoutingState> = {
      lastResolvedTier: result.resolvedTier,
      lastResolvedModelId: result.resolvedModelId,
      lastRoutedAt: Date.now(),
    };
    if (failoverStickyModelId) {
      patch.failoverStickyModelId = failoverStickyModelId;
      patch.failoverStickyUntil = Date.now() + FAILOVER_STICKY_TTL_MS;
      logger.info('[ROUTING] Failover sticky 设置', {
        threadId,
        modelId: failoverStickyModelId,
        durationMin: FAILOVER_STICKY_TTL_MS / 60_000,
      });
    }
    writeThreadRoutingState(threadId, patch);
  } catch (err) {
    logger.warn('[ROUTING] 路由决策记录失败', { threadId, error: String(err) });
  }
}

/**
 * 记录路由反馈
 *
 * 用于后续路由决策参考 economy 错误路由情况
 */
export function rememberRoutingFeedback(threadId: string | undefined, fb: RoutingFeedback): void {
  if (!threadId) return;
  try {
    const now = Date.now();
    const prev = readThreadRoutingState(threadId) ?? {};

    const touchedTools = fb.toolCallCount > 0;
    const misroutedEconomy =
      fb.resolvedTier === 'economy' &&
      (fb.toolErrorCount > 0 || fb.outcome === 'error');

    writeThreadRoutingState(threadId, {
      lastResolvedTier: fb.resolvedTier,
      lastResolvedModelId: fb.resolvedModelId,
      lastRunOutcome: fb.outcome,
      lastToolCallCount: fb.toolCallCount,
      lastToolErrorCount: fb.toolErrorCount,
      premiumStickyUntil: touchedTools ? now + PREMIUM_STICKY_TTL_MS : prev.premiumStickyUntil,
      forcePremiumUntil: misroutedEconomy ? now + FORCE_PREMIUM_TTL_MS : prev.forcePremiumUntil,
      lastInputTokens: fb.lastInputTokens ?? prev.lastInputTokens,
    });
  } catch (err) {
    logger.warn('[ROUTING] 路由反馈记录失败', { threadId, error: String(err) });
  }
}

// ─── Layer 2 规则匹配 ─────────────────────────────────────────────────────

/**
 * 估算 token 数
 *
 * 1 token ≈ 1.5 中文字符 或 4 英文字符
 */
function estimateTokens(text: string): number {
  const chineseCount = (text.match(/[一-鿿]/g) ?? []).length;
  const nonChinese = text.length - chineseCount;
  return Math.ceil(chineseCount / 1.5 + nonChinese / 4);
}

/**
 * 计算代码块数量
 */
function countCodeBlocks(text: string): number {
  return (text.match(/```/g) ?? []).length / 2;
}

/**
 * 检查是否需要工具能力
 */
function requiresToolCapability(message: string): boolean {
  if (FILESYSTEM_OP_PATTERN.test(message)) return true;
  if (FILE_OR_REPO_PATTERN.test(message)) return true;
  if (/```/.test(message) && /(error|traceback|exception|stack trace|npm |pnpm |tsc |jest |pytest)/i.test(message)) {
    return true;
  }
  return false;
}

/**
 * 检查是否为严格 economy 消息
 */
function isStrictEconomy(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (requiresToolCapability(trimmed)) return false;
  return trimmed.length <= 80 && STRICT_ECONOMY_PATTERN.test(trimmed);
}

/**
 * 社交消息评分
 *
 * 返回 "economy" 仅当高置信度确认消息为纯社交/确认交换
 */
function scoreSocialEconomy(trimmed: string): { result: 'economy' | 'uncertain'; score: number } {
  // 硬性限制：过长消息不可能是纯社交
  if (trimmed.length > 40) return { result: 'uncertain', score: -1 };

  // 模糊延续词看起来短但有隐含任务上下文
  if (AMBIGUOUS_SHORT_PATTERN.test(trimmed)) return { result: 'uncertain', score: -1 };

  let score = 0;

  // 长度信号
  if (trimmed.length <= 10) score += 2;
  else if (trimmed.length <= 25) score += 1;

  // 无疑问/命令标点
  if (!/[?？!！:：;；]/.test(trimmed)) score += 1;

  // 无多字符英文单词（纯 CJK 问候或 emoji）
  if (!/[a-zA-Z]{2,}/.test(trimmed)) score += 1;

  // 无技术/问题关键词
  if (!TECH_QUESTION_PATTERN.test(trimmed)) score += 2;
  else score -= 2;

  // 显式惩罚
  if (/[?？]/.test(trimmed)) score -= 3;
  if (/\d{3,}/.test(trimmed)) score -= 2;

  return { result: score >= 4 ? 'economy' : 'uncertain', score };
}

/**
 * 应用 Layer 2 规则（带详情）
 */
function applyLayer2RulesWithDetail(message: string): Layer2Detail {
  const trimmed = message.trim();
  if (!trimmed) return { result: 'premium', matchedRule: 'empty-message' };

  const estimatedTokens = estimateTokens(trimmed);
  if (estimatedTokens > 3000) {
    return { result: 'premium', matchedRule: 'token-limit-exceeded', estimatedTokens };
  }

  const codeBlockCount = countCodeBlocks(trimmed);
  if (codeBlockCount >= 2) {
    return { result: 'premium', matchedRule: 'multiple-code-blocks', codeBlockCount };
  }

  // 文件系统操作动词
  const fsMatch = FILESYSTEM_OP_PATTERN.exec(trimmed);
  if (fsMatch) {
    return { result: 'premium', matchedRule: 'FILESYSTEM_OP_PATTERN', fsOpMatch: fsMatch[0] };
  }

  // 文件路径存在
  const fileMatch = FILE_OR_REPO_PATTERN.exec(trimmed);
  if (fileMatch) {
    return { result: 'premium', matchedRule: 'FILE_OR_REPO_PATTERN', filePatternMatch: fileMatch[0] };
  }

  // 粘贴的错误输出
  if (/```/.test(trimmed) && /(error|traceback|exception|stack trace|npm |pnpm |tsc |jest |pytest)/i.test(trimmed)) {
    return { result: 'premium', matchedRule: 'pasted-error-output', codeBlockCount };
  }

  // 纯上下文请求
  if (trimmed.length <= 200 && INCTX_ECONOMY_PATTERN.test(trimmed)) {
    return { result: 'economy', matchedRule: 'INCTX_ECONOMY_PATTERN', inCtxMatch: true, messageLength: trimmed.length };
  }

  // 严格 economy 允许列表
  if (isStrictEconomy(trimmed)) {
    return { result: 'economy', matchedRule: 'STRICT_ECONOMY_PATTERN' };
  }

  // 社交评分
  const scored = scoreSocialEconomy(trimmed);
  if (scored.result === 'economy') {
    return { result: 'economy', matchedRule: 'social-score→economy', socialScore: scored.score, messageLength: trimmed.length };
  }

  return { result: 'uncertain', matchedRule: 'no-rule-matched', messageLength: trimmed.length };
}

// ─── Layer 3 LLM 分类器 ───────────────────────────────────────────────────

/**
 * 选择分类器模型
 *
 * 优先级：
 * 1. 用户配置的 Qwen economy 模型
 * 2. 用户配置的非 Qwen economy 模型
 * 3. null → 默认 premium
 */
function pickClassifierModel(): ModelConfig | null {
  const configs = modelStorage.getCustomModelConfigs();
  const economyConfigs = configs.filter((c) => (c.tier ?? 'premium') === 'economy' && c.apiKey);

  // 用户配置的 Qwen economy 模型
  const userQwen = economyConfigs.find((c) => /qwen/i.test(c.model));

  // 用户配置的非 Qwen economy 模型
  const userNonQwen = economyConfigs.find((c) => !/qwen/i.test(c.model));

  const selected = userQwen ?? userNonQwen ?? null;

  logger.debug('[ROUTING] Layer3 分类器模型选择', {
    selected: selected ? { id: selected.id, model: selected.model } : null,
    candidates: economyConfigs.map((c) => ({ id: c.id, model: c.model })),
  });

  return selected;
}

/**
 * LLM 分类器调用
 */
async function classifyWithLlm(message: string): Promise<Layer3Result> {
  const key = hashMessage(message);
  const cached = CLASSIFIER_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug('[ROUTING] Layer3 缓存命中', { cacheKey: key, tier: cached.tier });
    return { tier: cached.tier, cacheHit: true };
  }

  const classifierModel = pickClassifierModel();
  if (!classifierModel) {
    return { tier: 'premium', cacheHit: false };
  }

  try {
    // 禁用思考的参数
    const noThinkParams: Record<string, unknown> = {
      reasoning_effort: 'none',
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    };

    logger.debug('[ROUTING] Layer3 分类器调用开始', {
      cacheKey: key,
      model: classifierModel.model,
      messageLength: message.length,
      timeoutMs: LAYER3_TIMEOUT_MS,
    });

    const llm = new ChatOpenAI({
      model: classifierModel.model,
      apiKey: classifierModel.apiKey,
      configuration: { baseURL: classifierModel.baseUrl },
      maxTokens: 1000,
      temperature: 0,
      ...noThinkParams,
    });

    const systemPrompt = `You are a routing classifier for an AI coding agent that can read/write files, run commands, and execute code.

Reply with exactly one word: "premium" or "economy".
Default to "premium" if uncertain — task quality and agent stability come first.

Evaluate the request on TWO dimensions:

[1] Agentic need — Does answering require the agent to use tools? (read/write files, run commands, search codebase, debug real errors)
[2] Cognitive depth — Does answering require deep reasoning, multi-step planning, or understanding of a specific codebase?

Route "premium" if EITHER dimension is YES.
Route "economy" only if BOTH dimensions are clearly NO.

--- economy examples (no tools needed, answerable from knowledge) ---
• "好兄弟" / "辛苦了" / "lgtm" → pure social, zero task
• "帮我写一个快排" / "实现 debounce" → generic code gen, in-context
• "解释一下 useEffect 的原理" → concept explanation
• "== 和 === 的区别是什么" → factual comparison
• "把这句话翻译成英文" → translation

--- premium examples (need tools or deep codebase reasoning) ---
• "帮我看看 src/main/index.ts" → must read a specific file
• "查一下哪里调用了 parseDate" → must search the codebase
• "运行 npm install 然后告诉我报错" → must execute a command
• "调试这个报错" / "帮我修复这个 bug" → needs real execution context
• "重构 components/ 目录下的组件" → multi-file, agentic task`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('layer3-timeout')), LAYER3_TIMEOUT_MS)
    );

    const response = await Promise.race([
      llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Classify this request (reply only "premium" or "economy"):\n\n${message.slice(0, 600)}`),
      ]),
      timeoutPromise,
    ]);

    const raw = (typeof response.content === 'string' ? response.content : '').toLowerCase();
    const containsThink = /<think>[\s\S]*?<\/think>/.test(raw) || raw.includes('<think>');
    const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    const lastEconomy = text.lastIndexOf('economy');
    const lastPremium = text.lastIndexOf('premium');
    const tier: ModelTier =
      lastEconomy > lastPremium && lastEconomy !== -1 ? 'economy' : 'premium';

    logger.debug('[ROUTING] Layer3 分类器调用完成', {
      cacheKey: key,
      containsThink,
      derivedTier: tier,
      rawPreview: raw.slice(0, 200),
    });

    evictClassifierCache();
    CLASSIFIER_CACHE.set(key, { tier, expiresAt: Date.now() + CACHE_TTL_MS });

    return {
      tier,
      classifierModel: classifierModel.model,
      cacheHit: false,
      containsThink,
      rawPreview: raw.slice(0, 200),
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'layer3-timeout';
    const reason = isTimeout ? `timeout >${LAYER3_TIMEOUT_MS}ms` : String(err);

    logger.warn('[ROUTING] Layer3 分类器失败', {
      reason,
      model: classifierModel.model,
      defaultTo: 'premium',
    });

    return {
      tier: 'premium',
      classifierModel: classifierModel.model,
      cacheHit: false,
      timedOut: isTimeout,
    };
  }
}

// ─── 失败回退链构建 ───────────────────────────────────────────────────────

/**
 * 构建失败回退链
 */
function buildFallbackChain(primaryTier: ModelTier): string[] {
  const configs = modelStorage.getCustomModelConfigs();
  const fallbackTier: ModelTier = primaryTier === 'economy' ? 'premium' : 'economy';

  const primary = configs.filter((c) => (c.tier ?? 'premium') === primaryTier).map((c) => `custom:${c.id}`);
  const fallback = configs.filter((c) => (c.tier ?? 'premium') === fallbackTier).map((c) => `custom:${c.id}`);
  const all = configs.map((c) => `custom:${c.id}`);

  const seen = new Set<string>();
  const chain: string[] = [];
  for (const id of [...primary, ...fallback, ...all]) {
    if (!seen.has(id)) {
      seen.add(id);
      chain.push(id);
    }
  }
  return chain;
}

// ─── 上下文容量保护 ───────────────────────────────────────────────────────

/**
 * 上下文容量保护
 *
 * 确保 economy 模型的上下文窗口足够大
 */
function guardContextCapacity(
  result: RoutingResult,
  threadId: string | undefined,
  layerRecords: RoutingLayerRecord[]
): RoutingResult {
  if (result.resolvedTier !== 'economy') return result;

  const state = readThreadRoutingState(threadId);
  const lastInputTokens = state?.lastInputTokens;
  if (!lastInputTokens || lastInputTokens <= 0) return result;

  const configs = modelStorage.getCustomModelConfigs();
  const currentCfgId = result.resolvedModelId.startsWith('custom:')
    ? result.resolvedModelId.slice('custom:'.length)
    : result.resolvedModelId;
  const currentCfg = configs.find((c) => c.id === currentCfgId);
  const currentMax = currentCfg?.maxTokens ?? modelStorage.DEFAULT_MAX_TOKENS;
  const threshold = Math.floor(currentMax * CONTEXT_CAPACITY_RATIO);

  if (lastInputTokens < threshold) {
    return result;
  }

  // 尝试其他更大的 economy 模型
  const otherEconomy = configs
    .filter((c) => (c.tier ?? 'premium') === 'economy' && c.id !== currentCfgId)
    .sort((a, b) => (b.maxTokens ?? modelStorage.DEFAULT_MAX_TOKENS) - (a.maxTokens ?? modelStorage.DEFAULT_MAX_TOKENS));

  for (const candidate of otherEconomy) {
    const candidateMax = candidate.maxTokens ?? modelStorage.DEFAULT_MAX_TOKENS;
    if (lastInputTokens < Math.floor(candidateMax * CONTEXT_CAPACITY_RATIO)) {
      const guardReason = `context-guard:switch-economy(${lastInputTokens}/${candidateMax})`;
      logger.info('[ROUTING] 上下文容量保护', {
        action: 'switch-economy',
        lastInputTokens,
        originalMax: currentMax,
        newModelId: candidate.id,
        newMax: candidateMax,
      });

      layerRecords.push({
        layer: 'layer2',
        durationMs: 0,
        result: 'economy',
        reason: guardReason,
        detail: { lastInputTokens, originalMax: currentMax, switchedTo: candidate.id, switchedMax: candidateMax },
      });

      return {
        ...result,
        resolvedModelId: `custom:${candidate.id}`,
        routeReason: `${result.routeReason}→${guardReason}`,
        fallbackChain: [
          `custom:${candidate.id}`,
          ...result.fallbackChain.filter((id) => id !== `custom:${candidate.id}`),
        ],
      };
    }
  }

  // 没有 economy 模型能处理 → 升级到 premium
  const guardReason = `context-guard:escalate-premium(${lastInputTokens}/${currentMax})`;
  logger.info('[ROUTING] 上下文容量保护', {
    action: 'escalate-premium',
    lastInputTokens,
    economyMax: currentMax,
    candidatesChecked: otherEconomy.length,
  });

  layerRecords.push({
    layer: 'layer2',
    durationMs: 0,
    result: 'premium',
    reason: guardReason,
    detail: { lastInputTokens, economyMax: currentMax, candidatesChecked: otherEconomy.length },
  });

  const safeLayer = (result.layer === 'pinned' ? 'layer2' : result.layer) as 'layer1' | 'thread' | 'layer2' | 'layer3';
  return resolveFromTier('premium', `${result.routeReason}→${guardReason}`, safeLayer);
}

// ─── 从层级解析模型 ───────────────────────────────────────────────────────

/**
 * 从层级解析模型
 */
function resolveFromTier(
  tier: ModelTier,
  reason: string,
  layer: 'layer1' | 'thread' | 'layer2' | 'layer3'
): RoutingResult {
  const model = modelStorage.getModelByTier(tier);
  const configs = modelStorage.getCustomModelConfigs();
  const fallbackId = model ? `custom:${model.id}` : (configs[0] ? `custom:${configs[0].id}` : '');
  const fallbackChain = buildFallbackChain(tier);

  const result: RoutingResult = {
    resolvedModelId: fallbackId,
    resolvedTier: tier,
    routeReason: reason,
    fallbackChain,
    layer,
  };

  logger.info('[ROUTING] 路由完成', {
    layer,
    resolvedModelId: result.resolvedModelId,
    resolvedTier: result.resolvedTier,
    routeReason: result.routeReason,
  });

  return result;
}

/**
 * 从精确模型 ID 解析
 */
function resolveFromExactModel(
  modelId: string,
  tier: ModelTier,
  reason: string
): RoutingResult {
  const fallbackChain = [modelId, ...buildFallbackChain(tier).filter((id) => id !== modelId)];

  const result: RoutingResult = {
    resolvedModelId: modelId,
    resolvedTier: tier,
    routeReason: reason,
    fallbackChain,
    layer: 'thread',
  };

  logger.info('[ROUTING] 路由完成', {
    layer: 'thread',
    resolvedModelId: modelId,
    resolvedTier: tier,
    routeReason: reason,
  });

  return result;
}

// ─── 路由追踪构建 ───────────────────────────────────────────────────────────

/**
 * 解析模型名称
 */
function resolveModelName(resolvedModelId: string): string {
  const cfgId = resolvedModelId.startsWith('custom:')
    ? resolvedModelId.slice('custom:'.length)
    : resolvedModelId;
  const cfg = modelStorage.getCustomModelConfigs().find((c) => c.id === cfgId);
  return cfg?.model ?? cfg?.name ?? cfgId;
}

/**
 * 构建路由追踪（永不抛出异常）
 */
function buildRoutingTrace(
  ctx: RoutingContext,
  layers: RoutingLayerRecord[],
  finalResult: RoutingResult
): RoutingTrace | undefined {
  try {
    const message = ctx.message ?? '';
    return {
      messageSnippet: message.slice(0, 100),
      taskSource: ctx.taskSource,
      ...(ctx.continuation ? { continuation: ctx.continuation } : {}),
      routingMode: ctx.routingMode,
      resolvedTier: finalResult.resolvedTier,
      resolvedModelId: finalResult.resolvedModelId,
      resolvedModelName: resolveModelName(finalResult.resolvedModelId),
      decidedByLayer: finalResult.layer,
      routingTotalDurationMs: layers.reduce((sum, l) => sum + l.durationMs, 0),
      layers,
    };
  } catch {
    return undefined;
  }
}

// ─── 公共 API ───────────────────────────────────────────────────────────────

/**
 * 解析模型
 *
 * 三层路由策略：
 *   Layer 1: 任务类型快速路由
 *   Layer 2: 规则匹配路由
 *   Layer 3: LLM 分类器路由
 */
export async function resolveModel(ctx: RoutingContext): Promise<RoutingResult> {
  const layerRecords: RoutingLayerRecord[] = [];

  function recordLayer(rec: RoutingLayerRecord): void {
    try {
      layerRecords.push(rec);
    } catch {
      // 忽略
    }
  }

  function withTrace(result: RoutingResult): RoutingResult {
    try {
      result.routingTrace = buildRoutingTrace(ctx, layerRecords, result);
    } catch {
      // 忽略
    }
    return result;
  }

  // ── Pinned 模式 ───────────────────────────────────────────────────────────
  if (ctx.routingMode === 'pinned') {
    const t0 = Date.now();
    const configs = modelStorage.getCustomModelConfigs();
    const requestedId = ctx.requestedModelId;
    let modelId: string;
    let tier: ModelTier = 'premium';

    if (requestedId) {
      modelId = requestedId;
      const cfgId = requestedId.startsWith('custom:') ? requestedId.slice('custom:'.length) : requestedId;
      const cfg = configs.find((c) => c.id === cfgId);
      tier = cfg?.tier ?? 'premium';
    } else {
      const first = configs[0];
      modelId = first ? `custom:${first.id}` : '';
      tier = first?.tier ?? 'premium';
    }

    recordLayer({
      layer: 'pinned',
      durationMs: Date.now() - t0,
      result: tier,
      reason: requestedId ? 'user-pinned-model' : 'fallback-to-first-config',
      detail: { requestedModelId: requestedId, resolvedModelId: modelId },
    });

    const result: RoutingResult = {
      resolvedModelId: modelId,
      resolvedTier: tier,
      routeReason: 'pinned',
      fallbackChain: buildFallbackChain(tier),
      layer: 'pinned',
    };

    logger.info('[ROUTING] Pinned 路由', {
      taskSource: ctx.taskSource,
      resolvedModelId: result.resolvedModelId,
      resolvedTier: result.resolvedTier,
    });

    return withTrace(result);
  }

  // ── Auto 模式 ─────────────────────────────────────────────────────────────

  // Layer 1: 任务类型快速路由
  {
    const t0 = Date.now();
    switch (ctx.taskSource) {
      case 'heartbeat':
      case 'memory_summarize':
      case 'scheduler_reminder': {
        recordLayer({
          layer: 'layer1',
          durationMs: Date.now() - t0,
          result: 'economy',
          reason: `taskSource=${ctx.taskSource}→economy`,
        });
        const r = resolveFromTier('economy', `layer1:${ctx.taskSource}→economy`, 'layer1');
        return withTrace(r);
      }
      case 'optimizer': {
        recordLayer({
          layer: 'layer1',
          durationMs: Date.now() - t0,
          result: 'premium',
          reason: 'taskSource=optimizer→premium',
        });
        const r = resolveFromTier('premium', 'layer1:optimizer→premium', 'layer1');
        return withTrace(r);
      }
      default:
        // chat / scheduler_action / knowledge_read / knowledge_generate
        recordLayer({
          layer: 'layer1',
          durationMs: Date.now() - t0,
          result: 'uncertain',
          reason: `taskSource=${ctx.taskSource}→pass-through`,
        });
    }
  }

  // ── 会话连续性（仅 chat） ─────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const threadState = readThreadRoutingState(ctx.threadId);
    const now = Date.now();

    if (ctx.taskSource === 'chat' && threadState) {
      // resume/interrupt 复用上次模型
      if (ctx.continuation && threadState.lastResolvedModelId) {
        recordLayer({
          layer: 'thread',
          durationMs: Date.now() - t0,
          result: 'reuse',
          reason: `${ctx.continuation}→reuse-last-model`,
          detail: {
            lastResolvedModelId: threadState.lastResolvedModelId,
            lastResolvedTier: threadState.lastResolvedTier,
          },
        });
        const r = resolveFromExactModel(
          threadState.lastResolvedModelId,
          threadState.lastResolvedTier ?? 'premium',
          `thread:${ctx.continuation}→reuse-last-model`
        );
        return withTrace(r);
      }

      // Failover 粘性
      if (threadState.failoverStickyModelId && (threadState.failoverStickyUntil ?? 0) > now) {
        const foCfgId = threadState.failoverStickyModelId.startsWith('custom:')
          ? threadState.failoverStickyModelId.slice('custom:'.length)
          : threadState.failoverStickyModelId;
        const foCfg = modelStorage.getCustomModelConfigs().find((c) => c.id === foCfgId);
        if (foCfg?.apiKey) {
          const remainingMs = (threadState.failoverStickyUntil ?? 0) - now;
          recordLayer({
            layer: 'thread',
            durationMs: Date.now() - t0,
            result: foCfg.tier ?? 'premium',
            reason: 'failover-sticky',
            detail: { failoverStickyModelId: threadState.failoverStickyModelId, remainingMs },
          });
          const r = resolveFromExactModel(
            threadState.failoverStickyModelId,
            foCfg.tier ?? 'premium',
            'thread:failover-sticky'
          );
          return withTrace(r);
        }
        logger.warn('[ROUTING] Failover sticky 模型不可用', {
          modelId: threadState.failoverStickyModelId,
        });
      }

      // Force premium
      if ((threadState.forcePremiumUntil ?? 0) > now) {
        const remainingMs = (threadState.forcePremiumUntil ?? 0) - now;
        recordLayer({
          layer: 'thread',
          durationMs: Date.now() - t0,
          result: 'premium',
          reason: 'force-premium-after-economy-failure',
          detail: { forcePremiumUntil: threadState.forcePremiumUntil, remainingMs },
        });
        const r = resolveFromTier('premium', 'thread:force-premium-after-economy-failure', 'thread');
        return withTrace(r);
      }

      // Sticky premium
      if ((threadState.premiumStickyUntil ?? 0) > now && !isStrictEconomy(ctx.message ?? '')) {
        const remainingMs = (threadState.premiumStickyUntil ?? 0) - now;
        recordLayer({
          layer: 'thread',
          durationMs: Date.now() - t0,
          result: 'premium',
          reason: 'sticky-premium-after-tool-work',
          detail: { premiumStickyUntil: threadState.premiumStickyUntil, remainingMs },
        });
        const r = resolveFromTier('premium', 'thread:sticky-premium-after-tool-work', 'thread');
        return withTrace(r);
      }

      recordLayer({
        layer: 'thread',
        durationMs: Date.now() - t0,
        result: 'uncertain',
        reason: 'thread-state-no-override',
        detail: {
          hasForcePremium: (threadState.forcePremiumUntil ?? 0) > now,
          hasStickyPremium: (threadState.premiumStickyUntil ?? 0) > now,
          continuation: ctx.continuation ?? null,
        },
      });
    } else {
      recordLayer({
        layer: 'thread',
        durationMs: Date.now() - t0,
        result: 'uncertain',
        reason: threadState ? 'non-chat-taskSource' : 'no-thread-state',
      });
    }
  }

  // ── Layer 2: 规则匹配 ─────────────────────────────────────────────────────
  const message = ctx.message ?? '';
  {
    const t0 = Date.now();
    const l2Detail = applyLayer2RulesWithDetail(message);

    if (l2Detail.result !== 'uncertain') {
      recordLayer({
        layer: 'layer2',
        durationMs: Date.now() - t0,
        result: l2Detail.result,
        reason: l2Detail.matchedRule,
        detail: {
          estimatedTokens: l2Detail.estimatedTokens,
          codeBlockCount: l2Detail.codeBlockCount,
          fsOpMatch: l2Detail.fsOpMatch,
          filePatternMatch: l2Detail.filePatternMatch,
          inCtxMatch: l2Detail.inCtxMatch,
          socialScore: l2Detail.socialScore,
          messageLength: l2Detail.messageLength,
        },
      });
      let r = resolveFromTier(l2Detail.result, `layer2:rules→${l2Detail.result}`, 'layer2');
      r = guardContextCapacity(r, ctx.threadId, layerRecords);
      return withTrace(r);
    }

    recordLayer({
      layer: 'layer2',
      durationMs: Date.now() - t0,
      result: 'uncertain',
      reason: l2Detail.matchedRule,
      detail: { estimatedTokens: l2Detail.estimatedTokens, messageLength: l2Detail.messageLength },
    });
  }

  // ── Layer 3: LLM 分类器 ───────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const l3 = await classifyWithLlm(message);
    const durationMs = Date.now() - t0;

    recordLayer({
      layer: 'layer3',
      durationMs,
      result: l3.tier,
      reason: l3.cacheHit
        ? `cache-hit→${l3.tier}`
        : l3.timedOut
          ? `timeout→premium`
          : `llm-classifier→${l3.tier}`,
      detail: {
        messageLength: message.length,
        classifierModel: l3.classifierModel,
        cacheHit: l3.cacheHit,
        timedOut: l3.timedOut,
        containsThink: l3.containsThink,
        rawPreview: l3.rawPreview,
        timeoutMs: LAYER3_TIMEOUT_MS,
      },
    });

    let r = resolveFromTier(l3.tier, `layer3:llm→${l3.tier}`, 'layer3');
    r = guardContextCapacity(r, ctx.threadId, layerRecords);
    return withTrace(r);
  }
}

/**
 * 获取全局路由模式
 */
export function getGlobalRoutingMode(): 'auto' | 'pinned' {
  return modelStorage.getGlobalRoutingMode();
}