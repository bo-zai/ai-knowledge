/**
 * DomainCluster 工具集
 *
 * 为 DomainClusterAgent 提供代码分析工具
 * 参考 local-read-tools.ts 的封装模式
 */

import fs from 'fs/promises';
import path from 'path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { glob } from 'glob';
import { parseMapperFile, extractTablesFromSql } from '../mybatis/mapper-parser.js';
import { resolveStatementSql } from '../mybatis/include-resolver.js';
import { logger } from '../shared/logger.js';

// ========== 配置 ==========

const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
]);

const SKIPPED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.exe',
  '.dll',
  '.class',
  '.jar',
]);

// ========== 工具运行包装器 ==========

interface ToolRunOptions {
  toolName: string;
  args: Record<string, unknown>;
}

async function runTool<T extends Record<string, unknown>>(
  options: ToolRunOptions,
  handler: () => Promise<string>
): Promise<string> {
  const started = Date.now();
  logger.info(`[Tool:${options.toolName}] Called with args: ${JSON.stringify(options.args)}`);

  try {
    const result = await handler();
    const duration = Date.now() - started;
    logger.info(`[Tool:${options.toolName}] Success: ${result.length} chars in ${duration}ms`);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - started;
    logger.error(`[Tool:${options.toolName}] Failed in ${duration}ms: ${error}`);
    return `Error: ${error}`;
  }
}

// ========== 辅助函数 ==========

function resolveWorkspacePath(workspacePath: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(workspacePath, filePath);
}

async function globFiles(rootPath: string, pattern: string): Promise<string[]> {
  const matches = await glob(pattern, {
    cwd: rootPath,
    absolute: true,
    ignore: [...SKIPPED_DIRS].map(d => `${d}/**`),
  });
  return matches;
}

function containsChineseMatch(text: string, keyword: string): boolean {
  if (/[一-龥]/.test(keyword)) {
    return text.includes(keyword);
  }
  return false;
}

function extractKeywordMatches(content: string, keyword: string, maxMatches: number): string[] {
  const lines = content.split('\n');
  const matches: string[] = [];

  for (const line of lines) {
    if (line.includes(keyword) || containsChineseMatch(line, keyword)) {
      matches.push(line.trim().slice(0, 200));
      if (matches.length >= maxMatches) break;
    }
  }

  return matches;
}

// ========== 工具定义 ==========

export interface DomainClusterToolHandlers {
  readFile(args: { file_path: string; start_line?: number; end_line?: number }): Promise<string>;
  searchCode(args: { query: string; file_pattern?: string }): Promise<string>;
  searchComments(args: { keyword: string; file_pattern?: string }): Promise<string>;
  getMapperStatements(args: { mapper_xml_path: string }): Promise<string>;
  getControllerApiInfo(args: { controller_file_path: string }): Promise<string>;
  getTableForeignKeys(args: { candidate_json: string }): Promise<string>;
  searchDocs(args: { keyword: string }): Promise<string>;
}

export function createDomainClusterToolHandlers(workspacePath: string): DomainClusterToolHandlers {
  // 文件读取
  const readFileRaw = async (
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<string> => {
    const absolutePath = resolveWorkspacePath(workspacePath, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');

    if (startLine !== undefined && endLine !== undefined) {
      if (startLine < 1 || endLine < startLine) {
        throw new Error(`Invalid line window: ${startLine}-${endLine}`);
      }
      const selectedLines = lines.slice(startLine - 1, endLine);
      return selectedLines.map((line, idx) => `${startLine + idx}\t${line}`).join('\n');
    }

    return lines.map((line, idx) => `${idx + 1}\t${line}`).join('\n');
  };

  // 代码搜索
  const searchCodeRaw = async (query: string, filePattern?: string): Promise<string> => {
    const pattern = filePattern ?? '*.java';
    const files = await globFiles(workspacePath, pattern);

    const results: { filePath: string; line: number; match: string }[] = [];
    for (const file of files.slice(0, 50)) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            results.push({
              filePath: file,
              line: i + 1,
              match: lines[i].trim().slice(0, 100),
            });
          }
        }
      } catch {
        continue;
      }
    }

    return JSON.stringify(results.slice(0, 20), null, 2);
  };

  // 注释搜索
  const searchCommentsRaw = async (keyword: string, filePattern?: string): Promise<string> => {
    const pattern = filePattern ?? '*.java';
    const files = await globFiles(workspacePath, pattern);

    const results: { filePath: string; line: number; comment: string }[] = [];
    for (const file of files.slice(0, 50)) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('//') || line.includes('*') || line.includes('/*')) {
            if (line.includes(keyword) || containsChineseMatch(line, keyword)) {
              results.push({
                filePath: file,
                line: i + 1,
                comment: line.trim().slice(0, 150),
              });
            }
          }
        }
      } catch {
        continue;
      }
    }

    return JSON.stringify(results.slice(0, 30), null, 2);
  };

  // Mapper SQL 获取
  const getMapperStatementsRaw = async (mapperXmlPath: string): Promise<string> => {
    const absolutePath = resolveWorkspacePath(workspacePath, mapperXmlPath);

    const mapperDoc = await parseMapperFile(absolutePath);
    if (!mapperDoc) {
      throw new Error(`Cannot parse Mapper XML: ${mapperXmlPath}`);
    }

    const statements: {
      id: string;
      type: string;
      sql: string;
      tables: string[];
    }[] = [];

    for (const stmt of mapperDoc.statements) {
      const resolved = resolveStatementSql(stmt, mapperDoc);
      const tables = extractTablesFromSql(resolved.sql);
      statements.push({
        id: stmt.id,
        type: stmt.type,
        sql: resolved.sql.slice(0, 500),
        tables,
      });
    }

    return JSON.stringify({
      namespace: mapperDoc.namespace,
      statements,
    }, null, 2);
  };

  // Controller API 信息获取
  const getControllerApiInfoRaw = async (controllerFilePath: string): Promise<string> => {
    const absolutePath = resolveWorkspacePath(workspacePath, controllerFilePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');

    const endpoints: { method: string; path: string; methodName: string }[] = [];
    let basePath = '';
    let className = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 提取类名
      const classMatch = line.match(/class\s+(\w+Controller)/);
      if (classMatch) {
        className = classMatch[1];
      }

      // 提取 RequestMapping 基路径
      const baseMappingMatch = line.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/);
      if (baseMappingMatch) {
        basePath = baseMappingMatch[1];
      }

      // 提取方法级映射
      const methodMappings = [
        ['GetMapping', 'GET'],
        ['PostMapping', 'POST'],
        ['PutMapping', 'PUT'],
        ['DeleteMapping', 'DELETE'],
        ['PatchMapping', 'PATCH'],
      ];

      for (const [annotation, httpMethod] of methodMappings) {
        if (line.includes(`@${annotation}`)) {
          const pathMatch = line.match(new RegExp(`@${annotation}\\s*\\(\\s*(?:value\\s*=\\s*)?"([^"]+)"`));
          const methodPath = pathMatch ? pathMatch[1] : '';

          // 找下一行的方法名
          let methodName = '';
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const methodMatch = lines[j].match(/public\s+\w+\s+(\w+)\s*\(/);
            if (methodMatch) {
              methodName = methodMatch[1];
              break;
            }
          }

          endpoints.push({
            method: httpMethod,
            path: basePath + methodPath,
            methodName,
          });
        }
      }
    }

    return JSON.stringify({
      className,
      basePath,
      endpoints,
    }, null, 2);
  };

  // 外键关系获取（从候选 JSON 解析）
  const getTableForeignKeysRaw = async (candidateJson: string): Promise<string> => {
    interface CandidateTable {
      tableName: string;
      foreignKeys?: { columnName: string; referencesTable: string }[];
    }

    interface Candidate {
      candidateId: string;
      tables: CandidateTable[];
    }

    const candidate = JSON.parse(candidateJson) as Candidate;
    const foreignKeys: {
      tableName: string;
      columnName: string;
      referencesTable: string;
    }[] = [];

    for (const table of candidate.tables) {
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys) {
          foreignKeys.push({
            tableName: table.tableName,
            columnName: fk.columnName,
            referencesTable: fk.referencesTable,
          });
        }
      }
    }

    return JSON.stringify(foreignKeys, null, 2);
  };

  // 文档搜索
  const searchDocsRaw = async (keyword: string): Promise<string> => {
    const docPatterns = ['README*', 'docs/**/*.md', '*.md'];
    const results: { filePath: string; matches: string[] }[] = [];

    for (const pattern of docPatterns) {
      const files = await globFiles(workspacePath, pattern);
      for (const file of files.slice(0, 20)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes(keyword) || containsChineseMatch(content, keyword)) {
            const matches = extractKeywordMatches(content, keyword, 3);
            results.push({
              filePath: file,
              matches,
            });
          }
        } catch {
          continue;
        }
      }
    }

    return JSON.stringify(results.slice(0, 10), null, 2);
  };

  // 返回带包装器的 handlers
  return {
    readFile(args) {
      return runTool({ toolName: 'read_file', args }, () =>
        readFileRaw(args.file_path, args.start_line, args.end_line)
      );
    },

    searchCode(args) {
      return runTool({ toolName: 'search_code', args }, () =>
        searchCodeRaw(args.query, args.file_pattern)
      );
    },

    searchComments(args) {
      return runTool({ toolName: 'search_comments', args }, () =>
        searchCommentsRaw(args.keyword, args.file_pattern)
      );
    },

    getMapperStatements(args) {
      return runTool({ toolName: 'get_mapper_statements', args }, () =>
        getMapperStatementsRaw(args.mapper_xml_path)
      );
    },

    getControllerApiInfo(args) {
      return runTool({ toolName: 'get_controller_api_info', args }, () =>
        getControllerApiInfoRaw(args.controller_file_path)
      );
    },

    getTableForeignKeys(args) {
      return runTool({ toolName: 'get_table_foreign_keys', args }, () =>
        getTableForeignKeysRaw(args.candidate_json)
      );
    },

    searchDocs(args) {
      return runTool({ toolName: 'search_docs', args }, () =>
        searchDocsRaw(args.keyword)
      );
    },
  };
}

// ========== 创建 LangChain 工具 ==========

export function createDomainClusterTools(workspacePath: string): DynamicStructuredTool[] {
  const handlers = createDomainClusterToolHandlers(workspacePath);

  return [
    new DynamicStructuredTool({
      name: 'domain_read_file',
      description: '读取任意文件内容。使用绝对路径。',
      schema: z.object({
        file_path: z.string().describe('文件的绝对路径'),
        start_line: z.number().optional().describe('起始行号（可选，用于分段读取）'),
        end_line: z.number().optional().describe('结束行号（可选，用于分段读取）'),
      }),
      func: handlers.readFile,
    }),

    new DynamicStructuredTool({
      name: 'domain_search_code',
      description: '搜索代码中的类名、方法名。返回匹配的文件路径和行号。',
      schema: z.object({
        query: z.string().describe('要搜索的类名或方法名'),
        file_pattern: z.string().optional().describe('文件模式过滤（如 *.java）'),
      }),
      func: handlers.searchCode,
    }),

    new DynamicStructuredTool({
      name: 'domain_search_comments',
      description: '搜索代码注释（中文注释、JavaDoc）。用于理解业务语义。',
      schema: z.object({
        keyword: z.string().describe('要搜索的关键词（如 "订单"、"支付"）'),
        file_pattern: z.string().optional().describe('文件模式过滤'),
      }),
      func: handlers.searchComments,
    }),

    new DynamicStructuredTool({
      name: 'domain_get_mapper_sql',
      description: '获取 Mapper XML 文件的 SQL 语句详情。分析业务操作语义。',
      schema: z.object({
        mapper_xml_path: z.string().describe('Mapper XML 文件的绝对路径'),
      }),
      func: handlers.getMapperStatements,
    }),

    new DynamicStructuredTool({
      name: 'domain_get_controller_api',
      description: '获取 Controller 的 REST API 信息。分析 API 路径和业务意图。',
      schema: z.object({
        controller_file_path: z.string().describe('Controller Java 文件的绝对路径'),
      }),
      func: handlers.getControllerApiInfo,
    }),

    new DynamicStructuredTool({
      name: 'domain_get_foreign_keys',
      description: '从候选信息中获取表的外键关系。用于判断表之间的关联。',
      schema: z.object({
        candidate_json: z.string().describe('候选的 JSON 字符串（包含 tables 信息）'),
      }),
      func: handlers.getTableForeignKeys,
    }),

    new DynamicStructuredTool({
      name: 'domain_search_docs',
      description: '搜索项目文档（README、docs 目录）。查找业务域描述。',
      schema: z.object({
        keyword: z.string().describe('要搜索的关键词'),
      }),
      func: handlers.searchDocs,
    }),
  ];
}