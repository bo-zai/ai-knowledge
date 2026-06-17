/**
 * 文件系统工具中间件和系统提示词
 *
 * 集成 DeepAgents 的 createFilesystemMiddleware，提供文件操作能力
 * 不包含 execute 工具（命令执行）
 */

import { createFilesystemMiddleware } from "deepagents";
import { FileBackend } from "./file-backend.js";
import { logger } from "../shared/logger.js";

// ── 类型定义 ──────────────────────────────────────────────────────

/**
 * 文件工具配置接口
 */
export interface FileToolsConfig {
  /** 工作目录根路径（必须为绝对路径） */
  rootDir: string;
  /** 最大文件大小 MB（默认 10） */
  maxFileSizeMb?: number;
  /** 是否启用写入操作（默认 true） */
  enableWrite?: boolean;
  /** 文件编码（默认 utf-8） */
  encoding?: BufferEncoding;
  /** 自定义系统提示词 */
  customSystemPrompt?: string;
  /** 工具结果 Token 限制（超过则写入文件，默认 20000） */
  toolTokenLimitBeforeEvict?: number;
  /** HumanMessage Token 限制（超过则写入文件，默认 50000） */
  humanMessageTokenLimitBeforeEvict?: number;
}

// ── 常量 ───────────────────────────────────────────────────────────

/**
 * 默认文件大小限制（MB）
 */
const DEFAULT_MAX_FILE_SIZE_MB = 10;

/**
 * 默认编码
 */
const DEFAULT_ENCODING: BufferEncoding = "utf-8";

/**
 * 默认工具结果 Token 限制
 */
const DEFAULT_TOOL_TOKEN_LIMIT = 20000;

/**
 * 默认 HumanMessage Token 限制
 */
const DEFAULT_HUMAN_MESSAGE_TOKEN_LIMIT = 50000;

// ── 中间件创建函数 ────────────────────────────────────────────────

/**
 * 创建文件工具中间件
 *
 * 集成 DeepAgents 的 createFilesystemMiddleware，使用自定义的 FileBackend
 * 工具列表：ls、read_file、write_file、edit_file、glob、grep（不含 execute）
 *
 * @param config - 文件工具配置
 * @returns AgentMiddleware 实例
 *
 * @example
 * ```typescript
 * const middleware = createFileToolsMiddleware({
 *   rootDir: '/path/to/workspace',
 *   maxFileSizeMb: 10,
 *   enableWrite: true
 * });
 *
 * // 在 Agent 构造时使用
 * const agent = createDeepAgent({
 *   model,
 *   middlewares: [middleware]
 * });
 * ```
 */
export function createFileToolsMiddleware(config: FileToolsConfig) {
  // 创建 FileBackend 实例
  const backend = new FileBackend({
    rootDir: config.rootDir,
    maxFileSizeMb: config.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB,
    encoding: config.encoding ?? DEFAULT_ENCODING,
  });

  logger.info("创建文件系统中间件", {
    rootDir: config.rootDir,
    maxFileSizeMb: config.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB,
    enableWrite: config.enableWrite ?? true,
  });

  // 使用 DeepAgents 的 createFilesystemMiddleware
  // backend 选项接受 AnyBackendProtocol，FileBackend 实现了 BackendProtocolV2 兼容接口
  const middleware = createFilesystemMiddleware({
    backend: backend as unknown as Parameters<
      typeof createFilesystemMiddleware
    >[0]["backend"],
    systemPrompt: config.customSystemPrompt ?? null,
    toolTokenLimitBeforeEvict:
      config.toolTokenLimitBeforeEvict ?? DEFAULT_TOOL_TOKEN_LIMIT,
    humanMessageTokenLimitBeforeEvict:
      config.humanMessageTokenLimitBeforeEvict ??
      DEFAULT_HUMAN_MESSAGE_TOKEN_LIMIT,
    // 注意：execute 工具需要 SandboxBackend，这里使用普通 FileBackend，execute 不可用
  });

  return middleware;
}

// ── 系统提示词函数 ────────────────────────────────────────────────

/**
 * 获取文件工具系统提示词
 *
 * 描述文件系统工具的使用方法和限制
 *
 * @param rootDir - 工作目录根路径
 * @param enableWrite - 是否启用写入操作
 * @returns 系统提示词字符串
 */
export function getFileToolsSystemPrompt(
  rootDir: string,
  enableWrite = true,
): string {
  const basePrompt = `
你拥有文件系统访问能力。所有文件路径必须使用绝对路径。

## 系统环境
- 工作目录根路径: ${rootDir}

## 可用工具

### ls - 列出目录内容
用法: ls(path="${rootDir}/src")
返回: 目录中的文件和子目录列表

### read_file - 读取文件内容
用法: read_file(file_path="${rootDir}/src/index.ts", offset=0, limit=500)
返回: 带行号的文件内容
- offset: 行偏移（0-indexed），用于分页读取大文件
- limit: 最大读取行数（默认 500）

### glob - 文件模式搜索
用法: glob(pattern="**/*.ts", path="${rootDir}")
返回: 匹配模式的文件列表
支持模式:
- * 匹配单层任意字符
- ** 匹配多层目录
- *.ts 匹配所有 TypeScript 文件
- src/**/*.ts 匹配 src 下所有 TypeScript 文件

### grep - 文件内容搜索（literal 匹配）
用法: grep(pattern="function", path="${rootDir}/src", glob="*.ts")
返回: 包含匹配文本的文件、行号和内容
- 仅支持 literal 文本匹配，不支持正则表达式
- glob 参数可选，用于过滤搜索文件类型
`;

  const writeToolsPrompt = enableWrite
    ? `
### write_file - 写入文件
用法: write_file(file_path="${rootDir}/src/new.ts", content="文件内容")
返回: 写入结果（成功返回路径，失败返回错误）
注意: 会自动创建父目录

### edit_file - 编辑文件（精确字符串替换）
用法: edit_file(file_path="${rootDir}/src/index.ts", old_string="旧文本", new_string="新文本", replace_all=false)
返回: 编辑结果（成功返回路径，失败返回错误）
注意:
- old_string 必须与文件内容精确匹配（包括空格和缩进）
- 默认只替换第一个匹配，replace_all=true 替换所有
- 找到多个匹配时会返回错误，需要更具体的上下文
`
    : `
## 写入操作限制
当前配置禁用了写入操作（write_file、edit_file）。
`;

  const rulesPrompt = `
## 文件操作原则
1. 所有路径必须是绝对路径，相对于 ${rootDir}
2. read_file 有文件大小限制（${DEFAULT_MAX_FILE_SIZE_MB}MB），超大文件需分段读取
3. edit_file 的 old_string 必须精确匹配，包括：
   - 空格和缩进
   - 行尾字符
   - 完整的代码块
4. grep 仅支持 literal 文本匹配，不支持正则表达式
5. glob 和 grep 结果可能被截断（限制条数），需要更具体的模式
6. 符号链接会被拒绝，确保操作的是真实文件

## 最佳实践
- 读取大文件时使用 offset 和 limit 分段读取
- 使用 glob 定位文件后再用 read_file 读取具体内容
- 使用 grep 搜索文本模式，再用 read_file 查看上下文
- edit_file 前先用 read_file 确认精确内容
`;

  return basePrompt + writeToolsPrompt + rulesPrompt;
}
