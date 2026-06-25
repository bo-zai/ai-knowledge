import { logger } from "./logger.js";

const DEFAULT_HEARTBEAT_MS = 60_000;

export interface LongTaskLoggerOptions {
  taskName: string;
  heartbeatMs?: number;
  buildMessage?: () => string;
}

export async function withLongTaskLogging<T>(
  options: LongTaskLoggerOptions,
  handler: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  let isCompleted = false;

  const timer = setInterval(() => {
    if (isCompleted) {
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const extraMessage = options.buildMessage?.();
    logger.info(
      `[LongTask] ${options.taskName} still running after ${formatElapsed(elapsedMs)}${extraMessage ? `, ${extraMessage}` : ""}`,
    );
  }, heartbeatMs);

  try {
    const result = await handler();
    isCompleted = true;
    clearInterval(timer);
    logger.info(
      `[LongTask] ${options.taskName} completed in ${formatElapsed(Date.now() - startedAt)}`,
    );
    return result;
  } catch (error) {
    isCompleted = true;
    clearInterval(timer);
    logger.warn(
      `[LongTask] ${options.taskName} failed after ${formatElapsed(Date.now() - startedAt)}: ${error}`,
    );
    throw error;
  }
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m${seconds}s`;
}
