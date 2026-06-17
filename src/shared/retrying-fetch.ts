/**
 * 统一重试机制
 *
 * 支持指数退避、per-attempt timeout 和状态码识别。
 * 参考 CmbCoworkAgent 的 runtime.ts 实现。
 */

/**
 * 可重试的非 5xx 状态码
 * - 408: Request Timeout
 * - 409: Conflict
 * - 429: Too Many Requests
 * - 432: 特定业务错误码
 * - 433: 特定业务错误码
 */
const RETRYABLE_NON_5XX_STATUS = new Set([408, 409, 429, 432, 433]);

/**
 * 判断 HTTP 状态码是否可重试
 * @param status - HTTP 状态码
 * @returns 是否可重试
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || RETRYABLE_NON_5XX_STATUS.has(status);
}

/**
 * 默认最大重试次数（1 次初始 + 5 次重试）
 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 6;

/**
 * 重试基础延迟（毫秒）
 * 指数退避：1s, 2s, 4s, 8s...
 */
export const RETRY_BASE_DELAY_MS = 1000;

/**
 * 单次请求超时（毫秒）
 * 防止半开连接/停滞连接（TCP 保持但无数据流的情况）
 */
export const PER_ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * Promise sleep 函数，支持 AbortSignal
 * @param ms - 等待毫秒数
 * @param signal - 可选的 AbortSignal，用于取消等待
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 计算退避延迟时间（带 jitter）
 * @param attempt - 当前尝试次数（1-based，1 = 第一次重试前）
 * @returns 延迟毫秒数
 */
export function computeBackoffDelay(attempt: number): number {
  // attempt is 1-based (1 = before first retry). 1s,2s,4s,8s with jitter 1x-2x.
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.round(base * (1 + Math.random()));
}

/**
 * 重试信息，用于通知 UI
 */
export interface RetryInfo {
  /** 1-based 尝试计数器，即将重试（1 = 第一次重试） */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 人类可读的原因（HTTP 状态码或网络错误消息） */
  reason: string;
  /** 下次尝试前的等待时间（毫秒） */
  delayMs: number;
}

/**
 * 重试钩子，用于 UI 显示/清除状态
 */
export interface RetryHooks {
  /** 重试前调用，传递重试信息 */
  onRetry?: (info: RetryInfo) => void;
  /** 重试成功时调用（fetch 返回非可重试响应）
   * UI 应立即清除重试指示器 */
  onRetrySuccess?: () => void;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大尝试次数（1 初始 + N-1 次重试） */
  maxAttempts: number;
  /** 重试钩子 */
  hooks?: RetryHooks;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: DEFAULT_RETRY_MAX_ATTEMPTS,
  hooks: undefined,
};

/**
 * 构建带重试的 fetch 封装
 *
 * 重试条件：
 *   - fetch 抛出的网络错误
 *   - HTTP 状态码在 RETRYABLE_NON_5XX_STATUS（或 >= 500）
 *   - 单次请求超时（半开/停滞连接保护）
 *
 * 不重试：
 *   - 父信号中断（用户取消）— 立即传播
 *   - 2xx（包括流式 200）— 立即返回
 *   - 不可重试的 4xx（400/401/403/404/...）— 冒泡到故障转移层
 *
 * 每次尝试创建独立的 AbortController，避免一次尝试的超时
 * 污染下一次（避免 SDK 级别超时导致共享信号永久阻塞的问题）。
 *
 * @param hooks - 可选的重试钩子
 * @param maxAttempts - 最大尝试次数，默认 6
 * @returns 封装后的 fetch 函数
 */
export function createRetryingFetch(
  hooks?: RetryHooks,
  maxAttempts: number = DEFAULT_RETRY_MAX_ATTEMPTS,
): typeof fetch {
  const totalAttempts = Math.max(1, maxAttempts);
  const maxRetries = totalAttempts - 1;

  return async (input, init) => {
    const parentSignal = (init?.signal ?? undefined) as AbortSignal | undefined;
    let lastError: unknown = undefined;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      if (parentSignal?.aborted)
        throw new DOMException("Aborted", "AbortError");

      // 单次尝试的控制器：每次迭代都新建，避免第 N 次的超时
      // 影响第 N+1 次。父信号（用户取消）单向转发：parent -> attempt
      // attempt 的中断永不影响父信号。
      const attemptCtrl = new AbortController();
      const onParentAbort = (): void => {
        attemptCtrl.abort(
          parentSignal?.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      parentSignal?.addEventListener("abort", onParentAbort, { once: true });

      const timeoutHandle = setTimeout(() => {
        attemptCtrl.abort(
          new DOMException("Per-attempt timeout", "TimeoutError"),
        );
      }, PER_ATTEMPT_TIMEOUT_MS);

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
        parentSignal?.removeEventListener("abort", onParentAbort);
      };

      try {
        const res = await fetch(input, { ...init, signal: attemptCtrl.signal });

        // 重要：对于流式响应，暂不取消单次超时计时器 — 我们希望超时
        // 只覆盖到第一个字节的时间。响应头到达后，取消计时器，
        // 因为下游（SDK / LangChain）拥有流的声明周期，
        // 不应被我们的计时器在流中途中断。
        cleanup();

        // 成功或不可重试错误 — 原样返回
        if (!isRetryableStatus(res.status)) {
          // 如果这是成功的重试（非首次尝试），通知 UI
          // 以便立即清除重试指示器
          if (attempt > 1) hooks?.onRetrySuccess?.();
          return res;
        }

        // 可重试 HTTP 状态码
        if (attempt >= totalAttempts) return res; // 已耗尽 — 返回让调用方看到真实状态

        // 清空响应体以释放连接，然后再重试
        try {
          await res.arrayBuffer();
        } catch {
          /* ignore */
        }

        const delay = computeBackoffDelay(attempt);
        console.warn(
          `[RetryingFetch] HTTP ${res.status}, retry ${attempt}/${maxRetries} after ${delay}ms`,
        );
        hooks?.onRetry?.({
          attempt,
          maxRetries,
          reason: `HTTP ${res.status}`,
          delayMs: delay,
        });
        await sleep(delay, parentSignal);
        continue;
      } catch (err) {
        cleanup();

        // 父信号中断（用户取消）— 立即传播，不重试
        if (parentSignal?.aborted) throw err;

        // 区分单次超时和通用网络错误，用于日志
        // 两者都是可重试的
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        const rawMsg = err instanceof Error ? err.message : String(err);
        const reason = isTimeout
          ? `timeout after ${PER_ATTEMPT_TIMEOUT_MS}ms`
          : rawMsg;

        lastError = err;
        if (attempt >= totalAttempts) throw err;

        const delay = computeBackoffDelay(attempt);
        console.warn(
          `[RetryingFetch] ${isTimeout ? "timeout" : "network error"} "${reason}", retry ${attempt}/${maxRetries} after ${delay}ms`,
        );
        hooks?.onRetry?.({
          attempt,
          maxRetries,
          reason: reason || "network error",
          delayMs: delay,
        });
        await sleep(delay, parentSignal);
        continue;
      }
    }

    // 不可达 — 循环总是返回或抛出
    throw lastError ?? new Error("retryingFetch: unexpected loop exit");
  };
}

/**
 * 默认带重试的 fetch（无 UI 钩子）
 * 用于没有 UI 上下文的模型实例（如技能生成）
 */
export const defaultRetryingFetch = createRetryingFetch();
