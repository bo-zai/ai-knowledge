/**
 * FileBackend: 文件系统后端实现
 *
 * 提供文件系统操作能力：ls、read、write、edit、glob、grep
 * 参考 deepagents 的 FilesystemBackend 接口实现
 */

import { constants as fsConstants, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { logger } from '../shared/logger';

// ── 类型定义 ──────────────────────────────────────────────────────

/**
 * 文件信息结构
 */
export interface FileInfo {
  /** 文件路径 */
  path: string;
  /** 是否为目录 */
  is_dir?: boolean;
  /** 文件大小（字节） */
  size?: number;
  /** 最后修改时间 */
  modified_at?: string;
}

/**
 * Grep 匹配结果
 */
export interface GrepMatch {
  /** 匹配文件路径 */
  path: string;
  /** 行号（1-indexed） */
  line: number;
  /** 匹配行文本 */
  text: string;
}

/**
 * 写入结果
 */
export interface WriteResult {
  /** 错误信息（失败时） */
  error?: string;
  /** 文件路径（成功时） */
  path?: string;
}

/**
 * 编辑结果
 */
export interface EditResult {
  /** 错误信息（失败时） */
  error?: string;
  /** 文件路径（成功时） */
  path?: string;
}

/**
 * FileBackend 配置接口
 */
export interface FileBackendConfig {
  /** 根目录（默认 process.cwd()） */
  rootDir?: string;
  /** 最大文件大小 MB（默认 10） */
  maxFileSizeMb?: number;
  /** 文件编码（默认 utf-8） */
  encoding?: BufferEncoding;
  /** 虚拟路径模式：将 "/" 映射到 rootDir */
  virtualMode?: boolean;
}

// ── 常量 ───────────────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';
const LINE_NUMBER_WIDTH = 6;
const MAX_LINE_LENGTH = 10_000;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_CHARS = 24_000;
const MAX_GLOB_ENTRIES = 400;
const MAX_LS_ENTRIES = 300;

/**
 * 是否支持 O_NOFOLLOW（防止符号链接攻击）
 */
const SUPPORTS_NOFOLLOW = typeof fsConstants.O_NOFOLLOW === 'number';

// ── FileBackend 类 ─────────────────────────────────────────────────

/**
 * 文件系统后端
 *
 * 提供安全的文件操作能力，包括：
 * - 路径安全检查（防止目录遍历）
 * - 文件大小限制
 * - 符号链接保护
 */
export class FileBackend {
  /** 工作目录（绝对路径） */
  protected cwd: string;
  /** 虚拟路径模式 */
  protected virtualMode: boolean;
  /** 最大文件大小（字节） */
  protected maxFileSizeBytes: number;
  /** 默认编码 */
  protected encoding: BufferEncoding;

  constructor(config: FileBackendConfig = {}) {
    this.cwd = config.rootDir ? path.resolve(config.rootDir) : process.cwd();
    this.virtualMode = config.virtualMode ?? false;
    this.maxFileSizeBytes = (config.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024;
    this.encoding = config.encoding ?? DEFAULT_ENCODING;

    logger.debug('FileBackend 初始化', { cwd: this.cwd, virtualMode: this.virtualMode });
  }

  // ── 路径安全 ─────────────────────────────────────────────────────

  /**
   * 检查路径是否在根目录内
   */
  protected isWithinRoot(resolvedPath: string): boolean {
    const normalizedRoot = this.cwd.replace(/\\/g, '/').toLowerCase();
    const normalizedPath = resolvedPath.replace(/\\/g, '/').toLowerCase();
    return normalizedPath.startsWith(normalizedRoot + '/') || normalizedPath === normalizedRoot;
  }

  /**
   * 解析路径并进行安全检查
   *
   * @param key - 文件路径（绝对、相对或虚拟路径）
   * @returns 解析后的绝对路径
   * @throws Error 如果路径遍历检测或路径超出根目录
   */
  protected resolvePath(key: string): string {
    // 虚拟模式：将 "/" 开头的路径映射到 cwd
    if (this.virtualMode && key.startsWith('/')) {
      const virtualPath = key.slice(1);
      // 禁止遍历（..、~）
      if (virtualPath.includes('..') || virtualPath.startsWith('~')) {
        throw new Error(`路径遍历检测: ${key}`);
      }
      const resolved = path.resolve(this.cwd, virtualPath);
      if (!this.isWithinRoot(resolved)) {
        throw new Error(`路径超出根目录: ${key}`);
      }
      return resolved;
    }

    // 非虚拟模式：允许绝对路径，相对路径解析到 cwd
    const resolved = path.resolve(this.cwd, key);

    // 检查路径遍历
    const normalizedKey = key.replace(/\\/g, '/');
    if (normalizedKey.includes('..')) {
      // 允许合法的 .. 使用（只要结果在 cwd 内）
      if (!this.isWithinRoot(resolved)) {
        throw new Error(`路径遍历超出根目录: ${key}`);
      }
    }

    return resolved;
  }

  // ── ls：列出目录内容 ─────────────────────────────────────────────

  /**
   * 列出目录内容（非递归）
   *
   * @param dirPath - 目录路径
   * @returns FileInfo 数组
   */
  async ls(dirPath: string = '/'): Promise<FileInfo[]> {
    const resolved = this.resolvePath(dirPath === '/' ? '.' : dirPath);

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const infos: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        const relativePath = this.virtualMode
          ? '/' + path.relative(this.cwd, fullPath).split(path.sep).join('/')
          : fullPath;

        if (entry.isDirectory()) {
          infos.push({
            path: relativePath,
            is_dir: true,
          });
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            infos.push({
              path: relativePath,
              is_dir: false,
              size: stat.size,
              modified_at: stat.mtime.toISOString(),
            });
          } catch {
            // 无法获取 stat，只返回路径
            infos.push({
              path: relativePath,
              is_dir: false,
            });
          }
        }
      }

      // 结果数量限制
      if (infos.length > MAX_LS_ENTRIES) {
        const capped = infos.slice(0, MAX_LS_ENTRIES);
        capped.push({
          path: `(截断) 共 ${infos.length} 条，显示前 ${MAX_LS_ENTRIES} 条`,
          is_dir: false,
        });
        logger.debug('ls 结果截断', { total: infos.length, capped: MAX_LS_ENTRIES });
        return capped;
      }

      logger.debug('ls 完成', { path: dirPath, count: infos.length });
      return infos;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('ls 失败', { path: dirPath, error: msg });
      return [{ path: `错误: 无法读取目录 '${dirPath}': ${msg}`, is_dir: false }];
    }
  }

  // ── read_file：读取文件 ───────────────────────────────────────────

  /**
   * 格式化带行号的内容
   */
  private formatLines(lines: string[], startLine: number): string {
    const result: string[] = [];
    const w = LINE_NUMBER_WIDTH;
    const maxLen = MAX_LINE_LENGTH;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + startLine;

      if (line.length <= maxLen) {
        result.push(`${lineNum.toString().padStart(w)}\t${line}`);
      } else {
        // 长行分块
        const numChunks = Math.ceil(line.length / maxLen);
        for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
          const start = chunkIdx * maxLen;
          const chunk = line.slice(start, start + maxLen);
          if (chunkIdx === 0) {
            result.push(`${lineNum.toString().padStart(w)}\t${chunk}`);
          } else {
            result.push(`${`${lineNum}.${chunkIdx}`.padStart(w)}\t${chunk}`);
          }
        }
      }
    }

    return result.join('\n');
  }

  /**
   * 读取文件内容（带行号）
   *
   * @param filePath - 文件路径
   * @param offset - 行偏移（0-indexed）
   * @param limit - 最大行数
   * @returns 格式化的文件内容
   */
  async read_file(filePath: string, offset = 0, limit = 500): Promise<string> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      // 符号链接保护
      let buffer: Buffer;
      if (SUPPORTS_NOFOLLOW) {
        const stat = await fs.lstat(resolvedPath);
        if (!stat.isFile()) {
          throw new Error(`'${filePath}' 不是文件`);
        }
        const fd = await fs.open(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          buffer = await fd.readFile();
        } finally {
          await fd.close();
        }
      } else {
        const stat = await fs.lstat(resolvedPath);
        if (stat.isSymbolicLink()) {
          throw new Error(`符号链接不允许: ${filePath}`);
        }
        if (!stat.isFile()) {
          throw new Error(`'${filePath}' 不是文件`);
        }
        buffer = await fs.readFile(resolvedPath);
      }

      // 文件大小检查
      if (buffer.length > this.maxFileSizeBytes) {
        throw new Error(
          `文件过大 (${Math.round(buffer.length / 1024 / 1024)}MB)，超过限制 ${Math.round(this.maxFileSizeBytes / 1024 / 1024)}MB`
        );
      }

      const content = buffer.toString(this.encoding);

      if (!content || content.trim() === '') {
        return '系统提醒: 文件存在但内容为空';
      }

      const lines = content.split('\n');
      if (offset >= lines.length) {
        return `错误: 行偏移 ${offset} 超出文件长度 (${lines.length} 行)`;
      }

      const total = lines.length;
      const hasMore = offset + limit < total;
      const end = Math.min(offset + (hasMore ? limit - 1 : limit), total);
      const formatted = this.formatLines(lines.slice(offset, end), offset + 1);

      if (hasMore) {
        const header = `[行 ${offset + 1}-${end} / 共 ${total} 行。使用 offset=${end} 继续读取]\n`;
        return header + formatted;
      }

      logger.debug('read_file 完成', { path: filePath, lines: total, offset, limit });
      return formatted;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('read_file 失败', { path: filePath, error: msg });
      return `错误: 读取文件 '${filePath}' 失败: ${msg}`;
    }
  }

  // ── write_file：写入文件 ──────────────────────────────────────────

  /**
   * 写入文件（自动创建目录）
   *
   * @param filePath - 文件路径
   * @param content - 文件内容
   * @returns WriteResult
   */
  async write_file(filePath: string, content: string): Promise<WriteResult> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      // 检查文件大小
      const contentSize = Buffer.byteLength(content, this.encoding);
      if (contentSize > this.maxFileSizeBytes) {
        return {
          error: `内容过大 (${Math.round(contentSize / 1024 / 1024)}MB)，超过限制 ${Math.round(this.maxFileSizeBytes / 1024 / 1024)}MB`,
        };
      }

      // 自动创建父目录
      const parentDir = path.dirname(resolvedPath);
      await fs.mkdir(parentDir, { recursive: true });

      // 符号链接保护写入
      if (SUPPORTS_NOFOLLOW) {
        // 检查是否已存在符号链接
        try {
          const stat = await fs.lstat(resolvedPath);
          if (stat.isSymbolicLink()) {
            return { error: `符号链接不允许: ${filePath}` };
          }
        } catch {
          // 文件不存在，继续写入
        }

        const fd = await fs.open(
          resolvedPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
        );
        try {
          await fd.writeFile(content, this.encoding);
        } finally {
          await fd.close();
        }
      } else {
        await fs.writeFile(resolvedPath, content, this.encoding);
      }

      logger.info('write_file 完成', { path: filePath, size: contentSize });
      return { path: filePath };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('write_file 失败', { path: filePath, error: msg });
      return { error: `写入文件 '${filePath}' 失败: ${msg}` };
    }
  }

  // ── edit_file：编辑文件 ───────────────────────────────────────────

  /**
   * 编辑文件（精确字符串替换）
   *
   * @param filePath - 文件路径
   * @param oldString - 要替换的字符串
   * @param newString - 替换后的字符串
   * @param replaceAll - 是否替换所有匹配
   * @returns EditResult
   */
  async edit_file(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      // 读取原文件
      let content: string;
      if (SUPPORTS_NOFOLLOW) {
        const stat = await fs.lstat(resolvedPath);
        if (!stat.isFile()) {
          throw new Error(`'${filePath}' 不是文件`);
        }
        const fd = await fs.open(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          const buffer = await fd.readFile();
          content = buffer.toString(this.encoding);
        } finally {
          await fd.close();
        }
      } else {
        const stat = await fs.lstat(resolvedPath);
        if (stat.isSymbolicLink()) {
          throw new Error(`符号链接不允许: ${filePath}`);
        }
        if (!stat.isFile()) {
          throw new Error(`'${filePath}' 不是文件`);
        }
        content = await fs.readFile(resolvedPath, this.encoding);
      }

      // 检查 oldString 是否存在
      if (!content.includes(oldString)) {
        return {
          error: `未找到要替换的字符串。请确保 oldString 与文件中的内容精确匹配（包括空格和缩进）。`,
        };
      }

      // 执行替换
      let newContent: string;
      if (replaceAll) {
        newContent = content.replace(new RegExp(this.escapeRegExp(oldString), 'g'), newString);
      } else {
        // 单次替换，检查唯一性
        const count = this.countOccurrences(content, oldString);
        if (count > 1) {
          return {
            error: `找到 ${count} 个匹配。请使用更具体的上下文确保唯一匹配，或设置 replaceAll=true 替换所有匹配。`,
          };
        }
        newContent = content.replace(oldString, newString);
      }

      // 写入文件
      if (SUPPORTS_NOFOLLOW) {
        const fd = await fs.open(
          resolvedPath,
          fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
        );
        try {
          await fd.writeFile(newContent, this.encoding);
        } finally {
          await fd.close();
        }
      } else {
        await fs.writeFile(resolvedPath, newContent, this.encoding);
      }

      logger.info('edit_file 完成', { path: filePath, replaceAll });
      return { path: filePath };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('edit_file 失败', { path: filePath, error: msg });
      return { error: `编辑文件 '${filePath}' 失败: ${msg}` };
    }
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 计算字符串出现次数
   */
  private countOccurrences(content: string, search: string): number {
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = content.indexOf(search, pos);
      if (idx === -1) break;
      count++;
      pos = idx + search.length;
    }
    return count;
  }

  // ── glob：文件模式搜索 ────────────────────────────────────────────

  /**
   * 文件模式搜索
   *
   * @param pattern - glob 模式
   * @param searchPath - 搜索路径（默认根目录）
   * @returns FileInfo 数组
   */
  async glob(pattern: string, searchPath = '/'): Promise<FileInfo[]> {
    const resolved = this.resolvePath(searchPath === '/' ? '.' : searchPath);

    try {
      const matches = await fg(pattern, {
        cwd: resolved,
        absolute: true,
        onlyFiles: false,
        suppressErrors: true,
      });

      const infos: FileInfo[] = [];
      for (const match of matches) {
        try {
          const stat = await fs.stat(match);
          const relativePath = this.virtualMode
            ? '/' + path.relative(this.cwd, match).split(path.sep).join('/')
            : match;

          infos.push({
            path: relativePath,
            is_dir: stat.isDirectory(),
            size: stat.size,
            modified_at: stat.mtime.toISOString(),
          });
        } catch {
          // 无法获取 stat
          const relativePath = this.virtualMode
            ? '/' + path.relative(this.cwd, match).split(path.sep).join('/')
            : match;
          infos.push({ path: relativePath });
        }
      }

      // 结果限制
      if (infos.length > MAX_GLOB_ENTRIES) {
        const capped = infos.slice(0, MAX_GLOB_ENTRIES);
        capped.push({
          path: `(截断) 共 ${infos.length} 条，显示前 ${MAX_GLOB_ENTRIES} 条。使用更具体的模式或路径。`,
          is_dir: false,
        });
        logger.debug('glob 结果截断', { pattern, total: infos.length });
        return capped;
      }

      logger.debug('glob 完成', { pattern, path: searchPath, count: infos.length });
      return infos;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('glob 失败', { pattern, error: msg });
      return [{ path: `错误: glob 搜索失败: ${msg}`, is_dir: false }];
    }
  }

  // ── grep：文件内容搜索 ────────────────────────────────────────────

  /**
   * 文件内容搜索（literal 匹配）
   *
   * @param pattern - 搜索字符串（非正则）
   * @param dirPath - 目录/文件路径
   * @param globPattern - 文件过滤模式
   * @returns GrepMatch 数组
   */
  async grep(
    pattern: string,
    dirPath = '/',
    globPattern?: string
  ): Promise<GrepMatch[]> {
    const resolved = this.resolvePath(dirPath === '/' ? '.' : dirPath);

    try {
      // 检查路径是否存在
      let baseStat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        baseStat = await fs.stat(resolved);
      } catch {
        return [];
      }

      const isFile = baseStat.isFile();

      // 确定搜索文件列表
      let searchFiles: string[];
      if (isFile) {
        searchFiles = [resolved];
      } else {
        // 目录搜索
        const globPatternToUse = globPattern ?? '**/*';
        searchFiles = await fg(globPatternToUse, {
          cwd: resolved,
          absolute: true,
          onlyFiles: true,
          suppressErrors: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        });
      }

      // 执行搜索
      const results: GrepMatch[] = [];

      for (const filePath of searchFiles) {
        try {
          const stat = await fs.stat(filePath);
          if (stat.size > this.maxFileSizeBytes) continue;

          const content = await fs.readFile(filePath, this.encoding);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              const relativePath = this.virtualMode
                ? '/' + path.relative(this.cwd, filePath).split(path.sep).join('/')
                : filePath;

              // 截断过长行
              const text =
                lines[i].length > 1000
                  ? lines[i].slice(0, 1000) + '...(截断)'
                  : lines[i];

              results.push({
                path: relativePath,
                line: i + 1,
                text,
              });

              // 达到限制则停止
              if (results.length >= MAX_GREP_MATCHES) break;
            }
          }

          if (results.length >= MAX_GREP_MATCHES) break;
        } catch {
          // 忽略单个文件错误
        }
      }

      // 字符数限制
      const capped: GrepMatch[] = [];
      let charCount = 0;

      for (const match of results) {
        const estChars = match.path.length + match.text.length + 16;
        if (charCount + estChars > MAX_GREP_CHARS) break;
        capped.push(match);
        charCount += estChars;
      }

      if (capped.length < results.length) {
        capped.push({
          path: '(截断)',
          line: 0,
          text: `共 ${results.length} 个匹配，显示前 ${capped.length} 个。使用更具体的模式或路径。`,
        });
        logger.debug('grep 结果截断', { pattern, total: results.length });
      }

      logger.debug('grep 完成', { pattern, path: dirPath, count: capped.length });
      return capped;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('grep 失败', { pattern, error: msg });
      return [{ path: `错误: grep 搜索失败: ${msg}`, line: 0, text: '' }];
    }
  }

  // ── 辅助方法 ──────────────────────────────────────────────────────

  /**
   * 获取当前工作目录
   */
  getWorkingDir(): string {
    return this.cwd;
  }

  /**
   * 获取配置信息
   */
  getConfig(): FileBackendConfig {
    return {
      rootDir: this.cwd,
      maxFileSizeMb: this.maxFileSizeBytes / 1024 / 1024,
      encoding: this.encoding,
      virtualMode: this.virtualMode,
    };
  }
}