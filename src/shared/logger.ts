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
  logStream = fs.createWriteStream(filePath, { flags: 'a' });
}

export function closeLogFile(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

export function log(level: LogLevel, message: string, data?: unknown): void {
  if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const fullMessage = data !== undefined
      ? `${prefix} ${message} ${JSON.stringify(data)}`
      : `${prefix} ${message}`;

    // 写入 console
    if (data !== undefined) {
      console.error(`${prefix} ${message}`, data);
    } else {
      console.error(`${prefix} ${message}`);
    }

    // 写入日志文件
    if (logStream) {
      logStream.write(fullMessage + '\n');
    }
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log('debug', message, data),
  info: (message: string, data?: unknown) => log('info', message, data),
  warn: (message: string, data?: unknown) => log('warn', message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
};