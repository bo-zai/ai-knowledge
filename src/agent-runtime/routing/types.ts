/**
 * 模型路由系统类型定义
 *
 * 参考 CmbCoworkAgent-main/src/main/routing/index.ts
 * 支持三层路由策略：Layer 1（任务类型）→ Layer 2（规则匹配）→ Layer 3（LLM分类）
 */

/**
 * 模型层级
 */
export type ModelTier = "premium" | "economy";

/**
 * 任务来源类型
 */
export type TaskSource =
  | "chat"
  | "heartbeat"
  | "scheduler_reminder"
  | "scheduler_action"
  | "memory_summarize"
  | "optimizer"
  | "knowledge_read"
  | "knowledge_generate";

/**
 * 路由模式
 */
export type RoutingMode = "auto" | "pinned";

/**
 * 继续类型（用于恢复/中断继续）
 */
export type ContinuationType = "resume" | "interrupt";

/**
 * 路由上下文
 */
export interface RoutingContext {
  /** 任务来源 */
  taskSource: TaskSource;
  /** 用户消息内容 */
  message?: string;
  /** 会话 ID */
  threadId?: string;
  /** 用户请求的模型 ID */
  requestedModelId?: string;
  /** 路由模式 */
  routingMode: RoutingMode;
  /** 继续类型（用于恢复/中断继续，复用上次模型） */
  continuation?: ContinuationType;
}

/**
 * 路由结果层级
 */
export type RoutingLayer = "pinned" | "layer1" | "thread" | "layer2" | "layer3";

/**
 * 路由结果
 */
export interface RoutingResult {
  /** 解析后的模型 ID */
  resolvedModelId: string;
  /** 解析后的模型层级 */
  resolvedTier: ModelTier;
  /** 路由原因说明 */
  routeReason: string;
  /** 失败回退链 */
  fallbackChain: string[];
  /** 决定路由的层级 */
  layer: RoutingLayer;
  /** 完整三层漏斗记录（用于离线分析，永不抛出异常） */
  routingTrace?: RoutingTrace;
}

/**
 * 路由反馈
 *
 * 用于记录运行结果，供后续路由决策参考
 */
export interface RoutingFeedback {
  /** 使用的模型层级 */
  resolvedTier: ModelTier;
  /** 使用的模型 ID */
  resolvedModelId: string;
  /** 运行结果 */
  outcome: "success" | "error" | "cancelled";
  /** 工具调用次数 */
  toolCallCount: number;
  /** 工具错误次数 */
  toolErrorCount: number;
  /** 输入 token 高水位标记 */
  lastInputTokens?: number;
}

/**
 * 会话路由状态
 *
 * 存储在会话 metadata 中，用于跨轮次路由决策
 */
export interface ThreadRoutingState {
  /** 上次使用的模型层级 */
  lastResolvedTier?: ModelTier;
  /** 上次使用的模型 ID */
  lastResolvedModelId?: string;
  /** 上次路由时间 */
  lastRoutedAt?: number;
  /** 上次运行结果 */
  lastRunOutcome?: "success" | "error" | "cancelled";
  /** 上次工具调用次数 */
  lastToolCallCount?: number;
  /** 上次工具错误次数 */
  lastToolErrorCount?: number;
  /** 粘性 premium：工具调用激活后持续 40 分钟 */
  premiumStickyUntil?: number;
  /** 强制 premium：economy 错误路由激活后持续 60 分钟 */
  forcePremiumUntil?: number;
  /** 失败回退粘性：API 回退成功后持续 30 分钟 */
  failoverStickyModelId?: string;
  failoverStickyUntil?: number;
  /** 上次输入 token 数 */
  lastInputTokens?: number;
}

/**
 * Layer 2 规则匹配结果
 */
export type Layer2Result = "premium" | "economy" | "uncertain";

/**
 * Layer 2 规则详情
 */
export interface Layer2Detail {
  /** 路由结果 */
  result: Layer2Result;
  /** 匹配的规则名称 */
  matchedRule: string;
  /** 估算的 token 数 */
  estimatedTokens?: number;
  /** 代码块数量 */
  codeBlockCount?: number;
  /** 文件系统操作匹配 */
  fsOpMatch?: string;
  /** 文件路径匹配 */
  filePatternMatch?: string;
  /** 上下文生成匹配 */
  inCtxMatch?: boolean;
  /** 社交评分 */
  socialScore?: number;
  /** 消息长度 */
  messageLength?: number;
}

/**
 * Layer 3 LLM 分类结果
 */
export interface Layer3Result {
  /** 分类结果 */
  tier: ModelTier;
  /** 分类使用的模型 */
  classifierModel?: string;
  /** 是否命中缓存 */
  cacheHit: boolean;
  /** 是否超时 */
  timedOut?: boolean;
  /** 是否包含思考块 */
  containsThink?: boolean;
  /** 原始输出预览 */
  rawPreview?: string;
}

/**
 * 路由层级记录（用于追踪）
 */
export interface RoutingLayerRecord {
  /** 层级名称 */
  layer: RoutingLayer | "thread";
  /** 持续时间（毫秒） */
  durationMs: number;
  /** 路由结果 */
  result: ModelTier | "uncertain" | "reuse";
  /** 路由原因 */
  reason: string;
  /** 详细信息 */
  detail?: Record<string, unknown>;
}

/**
 * 路由追踪（用于离线分析）
 */
export interface RoutingTrace {
  /** 消息片段 */
  messageSnippet: string;
  /** 任务来源 */
  taskSource: TaskSource;
  /** 继续类型 */
  continuation?: ContinuationType;
  /** 路由模式 */
  routingMode: RoutingMode;
  /** 最终层级 */
  resolvedTier: ModelTier;
  /** 最终模型 ID */
  resolvedModelId: string;
  /** 最终模型名称 */
  resolvedModelName: string;
  /** 决定层级 */
  decidedByLayer: RoutingLayer;
  /** 总耗时 */
  routingTotalDurationMs: number;
  /** 各层级记录 */
  layers: RoutingLayerRecord[];
}
