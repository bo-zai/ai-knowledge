import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isRetryableStatus,
  computeBackoffDelay,
  sleep,
  createRetryingFetch,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  PER_ATTEMPT_TIMEOUT_MS,
} from '../../../src/shared/retrying-fetch.js';

describe('retrying-fetch', () => {
  // ── isRetryableStatus 测试 ────────────────────────────────────────────

  describe('isRetryableStatus', () => {
    it('5xx 状态码可重试', () => {
      expect(isRetryableStatus(500)).toBe(true);
      expect(isRetryableStatus(502)).toBe(true);
      expect(isRetryableStatus(503)).toBe(true);
      expect(isRetryableStatus(504)).toBe(true);
      expect(isRetryableStatus(599)).toBe(true);
    });

    it('特定的 4xx 状态码可重试', () => {
      expect(isRetryableStatus(408)).toBe(true); // Request Timeout
      expect(isRetryableStatus(409)).toBe(true); // Conflict
      expect(isRetryableStatus(429)).toBe(true); // Too Many Requests
      expect(isRetryableStatus(432)).toBe(true); // 特定业务错误码
      expect(isRetryableStatus(433)).toBe(true); // 特定业务错误码
    });

    it('其他 4xx 状态码不可重试', () => {
      expect(isRetryableStatus(400)).toBe(false); // Bad Request
      expect(isRetryableStatus(401)).toBe(false); // Unauthorized
      expect(isRetryableStatus(403)).toBe(false); // Forbidden
      expect(isRetryableStatus(404)).toBe(false); // Not Found
      expect(isRetryableStatus(422)).toBe(false); // Unprocessable Entity
    });

    it('2xx 状态码不可重试', () => {
      expect(isRetryableStatus(200)).toBe(false);
      expect(isRetryableStatus(201)).toBe(false);
      expect(isRetryableStatus(204)).toBe(false);
    });

    it('3xx 状态码不可重试', () => {
      expect(isRetryableStatus(301)).toBe(false);
      expect(isRetryableStatus(302)).toBe(false);
      expect(isRetryableStatus(304)).toBe(false);
    });
  });

  // ── computeBackoffDelay 测试 ──────────────────────────────────────────

  describe('computeBackoffDelay', () => {
    it('计算指数退避延迟', () => {
      // attempt 1: 1000 * 2^0 = 1000, with jitter 1x-2x
      const delay1 = computeBackoffDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(2000);

      // attempt 2: 1000 * 2^1 = 2000, with jitter 1x-2x
      const delay2 = computeBackoffDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeLessThanOrEqual(4000);

      // attempt 3: 1000 * 2^2 = 4000, with jitter 1x-2x
      const delay3 = computeBackoffDelay(3);
      expect(delay3).toBeGreaterThanOrEqual(4000);
      expect(delay3).toBeLessThanOrEqual(8000);
    });

    it('每次调用返回带 jitter 的不同值', () => {
      // 由于有随机 jitter，多次调用同一 attempt 可能返回不同值
      // 但都在合理范围内
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        delays.add(computeBackoffDelay(1));
      }

      // 应该有多种不同的值（因为 jitter）
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  // ── sleep 测试 ────────────────────────────────────────────────────────

  describe('sleep', () => {
    it('等待指定时间后 resolve', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // 允许一些误差
    });

    it('可以被 AbortSignal 取消', async () => {
      const controller = new AbortController();

      const promise = sleep(5000, controller.signal);

      // 立即取消
      controller.abort();

      await expect(promise).rejects.toThrow('Aborted');
    });

    it('已取消的信号立即拒绝', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(sleep(100, controller.signal)).rejects.toThrow('Aborted');
    });
  });

  // ── createRetryingFetch 测试 ──────────────────────────────────────────

  describe('createRetryingFetch', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      global.fetch = originalFetch;
    });

    it('成功请求直接返回', async () => {
      const mockResponse = new Response('ok', { status: 200 });
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const retryingFetch = createRetryingFetch();
      const result = await retryingFetch('https://example.com');

      expect(result.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('不可重试的错误直接返回', async () => {
      const mockResponse = new Response('not found', { status: 404 });
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const retryingFetch = createRetryingFetch();
      const result = await retryingFetch('https://example.com');

      expect(result.status).toBe(404);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('5xx 错误触发重试', async () => {
      const errorResponse = new Response('error', { status: 503 });
      const successResponse = new Response('ok', { status: 200 });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);

      const retryingFetch = createRetryingFetch(undefined, 3);
      const promise = retryingFetch('https://example.com');

      // 推进时间以完成退避
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('网络错误触发重试', async () => {
      const successResponse = new Response('ok', { status: 200 });

      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(successResponse);

      const retryingFetch = createRetryingFetch(undefined, 3);
      const promise = retryingFetch('https://example.com');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('达到最大重试次数后返回最后的响应', async () => {
      const errorResponse = new Response('error', { status: 503 });

      global.fetch = vi.fn().mockResolvedValue(errorResponse);

      const retryingFetch = createRetryingFetch(undefined, 2);
      const promise = retryingFetch('https://example.com');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.status).toBe(503);
      // 1 初始 + 1 重试 = 2 次调用
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('达到最大重试次数后抛出最后的错误', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const retryingFetch = createRetryingFetch(undefined, 2);
      const promise = retryingFetch('https://example.com');

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Network error');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('用户取消信号立即传播', async () => {
      // 设置 mock fetch，但不应被调用
      global.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

      const controller = new AbortController();
      // 先取消信号
      controller.abort();

      const retryingFetch = createRetryingFetch(undefined, 3);

      // 信号已取消，应该立即抛出错误，不会调用 fetch
      await expect(
        retryingFetch('https://example.com', { signal: controller.signal })
      ).rejects.toThrow('Aborted');

      // fetch 不应该被调用，因为信号在调用前已取消
      expect(global.fetch).toHaveBeenCalledTimes(0);
    });

    it('调用 onRetry 钩子', async () => {
      const errorResponse = new Response('error', { status: 503 });
      const successResponse = new Response('ok', { status: 200 });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);

      const onRetry = vi.fn();
      const retryingFetch = createRetryingFetch({ onRetry }, 3);

      const promise = retryingFetch('https://example.com');
      await vi.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxRetries: 2,
          reason: 'HTTP 503',
        })
      );
    });

    it('成功重试后调用 onRetrySuccess 钩子', async () => {
      const errorResponse = new Response('error', { status: 503 });
      const successResponse = new Response('ok', { status: 200 });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);

      const onRetrySuccess = vi.fn();
      const retryingFetch = createRetryingFetch({ onRetrySuccess }, 3);

      const promise = retryingFetch('https://example.com');
      await vi.runAllTimersAsync();
      await promise;

      expect(onRetrySuccess).toHaveBeenCalledTimes(1);
    });

    it('首次成功不调用 onRetrySuccess', async () => {
      const successResponse = new Response('ok', { status: 200 });

      global.fetch = vi.fn().mockResolvedValue(successResponse);

      const onRetrySuccess = vi.fn();
      const retryingFetch = createRetryingFetch({ onRetrySuccess }, 3);

      await retryingFetch('https://example.com');

      expect(onRetrySuccess).not.toHaveBeenCalled();
    });

    it('传递请求选项', async () => {
      const mockResponse = new Response('ok', { status: 200 });
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

      const retryingFetch = createRetryingFetch();
      await retryingFetch('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Object),
          body: expect.any(String),
        })
      );
    });
  });

  // ── 常量验证 ──────────────────────────────────────────────────────────

  describe('常量', () => {
    it('DEFAULT_RETRY_MAX_ATTEMPTS 默认值正确', () => {
      expect(DEFAULT_RETRY_MAX_ATTEMPTS).toBe(6);
    });

    it('RETRY_BASE_DELAY_MS 默认值正确', () => {
      expect(RETRY_BASE_DELAY_MS).toBe(1000);
    });

    it('PER_ATTEMPT_TIMEOUT_MS 默认值正确', () => {
      expect(PER_ATTEMPT_TIMEOUT_MS).toBe(60000);
    });
  });
});