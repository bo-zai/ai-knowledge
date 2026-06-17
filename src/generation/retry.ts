import { AppError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onError?: (error: Error, attempt: number) => void,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (onError) {
        onError(lastError, attempt);
      } else {
        logger.warn(`Attempt ${attempt} failed: ${lastError.message}`);
      }
      if (attempt < config.maxRetries) {
        await sleep(config.delayMs);
      }
    }
  }
  throw new AppError(
    `Operation failed after ${config.maxRetries} retries: ${lastError?.message}`,
    "MAX_RETRIES_EXCEEDED",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
