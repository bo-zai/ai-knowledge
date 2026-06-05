/**
 * 提示词模板加载与参数替换工具类
 *
 * 功能：
 * 1. 从 src/prompts/ 目录加载 .md 模板文件
 * 2. 模板缓存（首次加载后复用）
 * 3. 条件块处理 {{#key}}...{{/key}}
 * 4. 参数替换 {{key}}
 *
 * 使用方式：
 * ```typescript
 * const prompt = PromptLoader.load('concept-filter')
 *   .fill({ className: 'UserVO', filePath: 'entity/UserVO.java', codeSnippet: '...' });
 * ```
 */

import { readFile as readFileAsync } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists } from './fs.js';

/**
 * 提示词模板目录 - 基于脚本所在目录而非运行时 cwd
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

/**
 * 提示词模板类
 */
export class PromptTemplate {
  private readonly rawTemplate: string;

  constructor(template: string) {
    this.rawTemplate = template;
  }

  /**
   * 获取原始模板内容
   */
  get raw(): string {
    return this.rawTemplate;
  }

  /**
   * 填充模板参数
   *
   * 支持的占位符格式：
   * - {{key}}: 简单替换
   * - {{#key}}content{{/key}}: 正向条件块（key 有值时显示 content）
   * - {{^key}}content{{/key}}: 反向条件块（key 无值时显示 content）
   *
   * @param params 参数字典
   * @returns 填充后的文本
   */
  fill(params: Record<string, string | string[] | undefined>): string {
    let result = this.rawTemplate;

    // 1. 处理正向条件块 {{#key}}...{{/key}}
    result = result.replace(
      /\{\{#(\w+)\}\}(.*?)\{\{\/(\w+)\}\}/gs,
      (_, key: string, content: string) => {
        const value = params[key];
        if (value === undefined || value === null || value === '') {
          return ''; // 无值，移除整个条件块
        }
        // 有值，保留内容（内容内可能还有 {{key}} 需替换）
        return content;
      },
    );

    // 2. 处理反向条件块 {{^key}}...{{/key}}
    result = result.replace(
      /\{\{\^(\w+)\}\}(.*?)\{\{\/(\w+)\}\}/gs,
      (_, key: string, content: string) => {
        const value = params[key];
        if (value === undefined || value === null || value === '') {
          // 无值，保留内容
          return content;
        }
        // 有值，移除整个条件块
        return '';
      },
    );

    // 3. 替换简单占位符 {{key}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = params[key];
      if (value === undefined || value === null) {
        return ''; // 无值替换为空
      }
      if (Array.isArray(value)) {
        return value.join('\n'); // 数组转为换行分隔
      }
      return value;
    });

    return result;
  }

  /**
   * 填充并打印（用于调试）
   *
   * 输出原始模板和填充结果对比
   */
  fillWithDebug(params: Record<string, string | string[] | undefined>): {
    template: string;
    filled: string;
    params: Record<string, string | string[] | undefined>;
  } {
    return {
      template: this.rawTemplate,
      filled: this.fill(params),
      params,
    };
  }
}

/**
 * 提示词加载器
 */
export class PromptLoader {
  /** 模板缓存 */
  private static cache = new Map<string, PromptTemplate>();

  /** 自定义目录（可覆盖默认目录） */
  private static customDir: string | null = null;

  /**
   * 设置自定义提示词目录
   */
  static setDirectory(dir: string): void {
    this.customDir = dir;
    this.cache.clear(); // 清空缓存，重新加载
  }

  /**
   * 获取提示词目录路径
   */
  static getDirectory(): string {
    return this.customDir ?? PROMPTS_DIR;
  }

  /**
   * 加载提示词模板
   *
   * @param name 模板名称（不含 .md 后缀）
   * @returns 模板对象
   */
  static load(name: string): PromptTemplate {
    // 检查缓存
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    // 加载模板文件
    const filePath = join(this.getDirectory(), `${name}.md`);

    // 同步加载（首次）
    let content: string;
    try {
      // 使用同步读取避免异步问题
      content = readFileSync(filePath, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to load prompt template "${name}" from ${filePath}: ${error.message}`);
    }

    // 创建模板对象并缓存
    const template = new PromptTemplate(content);
    this.cache.set(name, template);

    return template;
  }

  /**
   * 异步加载提示词模板
   *
   * @param name 模板名称
   * @returns 模板对象
   */
  static async loadAsync(name: string): Promise<PromptTemplate> {
    // 检查缓存
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    // 加载模板文件
    const filePath = join(this.getDirectory(), `${name}.md`);

    if (!(await fileExists(filePath))) {
      throw new Error(`Prompt template "${name}" not found at ${filePath}`);
    }

    const content = await readFileAsync(filePath, 'utf-8');

    // 创建模板对象并缓存
    const template = new PromptTemplate(content);
    this.cache.set(name, template);

    return template;
  }

  /**
   * 预加载所有模板（可选，用于启动时预热）
   */
  static async preloadAll(): Promise<void> {
    const dir = this.getDirectory();

    try {
      const files = readdirSync(dir);
      const mdFiles = files.filter((f: string) => f.endsWith('.md'));

      for (const file of mdFiles) {
        const name = file.replace('.md', '');
        await this.loadAsync(name);
      }
    } catch {
      // 目录不存在或读取失败，忽略
    }
  }

  /**
   * 清空缓存
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * 列出已缓存的模板
   */
  static listCached(): string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * 快捷方法：加载并填充
 */
export function fillPrompt(
  name: string,
  params: Record<string, string | string[] | undefined>,
): string {
  return PromptLoader.load(name).fill(params);
}

/**
 * 快捷方法：异步加载并填充
 */
export async function fillPromptAsync(
  name: string,
  params: Record<string, string | string[] | undefined>,
): Promise<string> {
  const template = await PromptLoader.loadAsync(name);
  return template.fill(params);
}