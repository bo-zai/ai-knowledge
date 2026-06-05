import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
let logFilePath: string | null = null;
let logStream: fs.WriteStream | null = null;

/**
 * 格式化为北京时间（东八区 UTC+8）
 */
function formatBeijingTime(): string {
  const now = new Date();
  // 东八区偏移 8 小时
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  // 格式：2026-06-04 15:46:58
  return beijingTime.toISOString().replace('T', ' ').slice(0, 19);
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setLogFile(filePath: string): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  logFilePath = filePath;
  // 确保目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 使用 sync: true 确保实时写入（参考 GitNexus logger）
  logStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
}

export function closeLogFile(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

/**
 * 刷新日志缓冲区到磁盘（参考 GitNexus flushLoggerSync）
 */
export function flushLogFile(): void {
  if (logStream) {
    // WriteStream 没有 flush 方法，使用底层 fd 同步刷新
    try {
      const fd = (logStream as any).fd;
      if (fd !== undefined && fd !== null) {
        // 尝试 fdatasync（更快的刷新），失败则用 fsync
        try {
          fs.fdatasyncSync(fd);
        } catch {
          fs.fsyncSync(fd);
        }
      }
    } catch {
      // 忽略刷新错误
    }
  }
}

export function log(level: LogLevel, message: string, data?: unknown): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    const timestamp = formatBeijingTime();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const fullMessage = data !== undefined
      ? `${prefix} ${message} ${JSON.stringify(data)}`
      : `${prefix} ${message}`;

    // 写入 stderr（参考 GitNexus：stderr 用于日志，stdout 用于数据）
    if (data !== undefined) {
      process.stderr.write(`${prefix} ${message} ${JSON.stringify(data)}\n`);
    } else {
      process.stderr.write(`${prefix} ${message}\n`);
    }

    // 写入日志文件并立即刷新
    if (logStream) {
      logStream.write(fullMessage + '\n');
      // 关键日志（error/warn）立即刷新
      if (level === 'error' || level === 'warn') {
        flushLogFile();
      }
    }
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log('debug', message, data),
  info: (message: string, data?: unknown) => log('info', message, data),
  warn: (message: string, data?: unknown) => log('warn', message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
};