import fs from 'fs/promises';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BudgetState } from './context-budget.js';
import { recordToolCall, recordToolResult, truncateToolResult } from './context-budget.js';
import type { TraceCollector } from './trace.js';

interface LocalReadToolInput {
  repoPath: string;
  budget: BudgetState;
  trace: TraceCollector;
}

export interface LocalReadToolHandlers {
  readFileWindow(input: { path: string; startLine: number; endLine: number }): Promise<string>;
  searchRepoText(input: { query: string; limit?: number }): Promise<string>;
  readSymbolDefinition(input: { symbol: string; limit?: number }): Promise<string>;
  readSymbolReferences(input: { symbol: string; limit?: number }): Promise<string>;
  readRelatedTests(input: { path?: string; symbol?: string; limit?: number }): Promise<string>;
}

export function createLocalReadToolHandlers(input: LocalReadToolInput): LocalReadToolHandlers {
  const runTool = async <T extends Record<string, unknown>>(
    toolName: string,
    args: T,
    handler: () => Promise<string>,
  ): Promise<string> => {
    const started = new Date();
    const callBudget = recordToolCall(input.budget);
    if (!callBudget.allowed) {
      return callBudget.message ?? 'tool call budget exceeded';
    }

    let output = '';
    let error: string | undefined;
    try {
      const raw = await handler();
      const truncated = truncateToolResult(raw, input.budget.limits.maxToolResultChars);
      const totalBudget = recordToolResult(input.budget, truncated.text);
      output = totalBudget.allowed ? truncated.text : totalBudget.message ?? 'total tool result budget exceeded';
      return output;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      output = `tool error: ${error}`;
      return output;
    } finally {
      const finished = new Date();
      input.trace.recordToolCall({
        toolName,
        args,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        returnedChars: output.length,
        truncated: output.endsWith('[truncated]'),
        ...(error ? { error } : {}),
      });
    }
  };

  const resolveRepoFile = async (relativePath: string): Promise<string> => {
    const root = path.resolve(input.repoPath);
    const target = path.resolve(root, relativePath);
    // 检查路径是否在仓库内
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`path is outside repo: ${relativePath}`);
    }
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new Error(`path is not a file: ${relativePath}`);
    }
    return target;
  };

  const readFileWindowRaw = async (relativePath: string, startLine: number, endLine: number): Promise<string> => {
    if (startLine < 1 || endLine < startLine) {
      throw new Error(`invalid line window: ${startLine}-${endLine}`);
    }
    const lineCount = endLine - startLine + 1;
    if (lineCount > input.budget.limits.maxFileWindowLines) {
      throw new Error(`line window exceeds limit: ${input.budget.limits.maxFileWindowLines}`);
    }
    const target = await resolveRepoFile(relativePath);
    const text = await fs.readFile(target, 'utf8');
    const lines = text.split(/\r?\n/);
    return lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index} | ${line}`)
      .join('\n');
  };

  const walkFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const searchRaw = async (query: string, limit?: number, onlyTests = false): Promise<string> => {
    const normalized = query.trim();
    if (!normalized) {
      throw new Error('query is required');
    }
    const max = Math.min(limit ?? input.budget.limits.searchResultLimit, input.budget.limits.searchResultLimit);
    const root = path.resolve(input.repoPath);
    const files = await walkFiles(root);
    const matches: string[] = [];
    for (const file of files) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (onlyTests && !relative.includes('test') && !relative.includes('spec')) {
        continue;
      }
      let text = '';
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (line.includes(normalized)) {
          matches.push(`${relative}:${index + 1}: ${line.trim()}`);
          if (matches.length >= max) {
            return matches.join('\n');
          }
        }
      }
    }
    if (matches.length > 0) {
      return matches.join('\n');
    }
    return `no matches for "${normalized}"`;
  };

  return {
    readFileWindow(args) {
      return runTool('read_file_window', args, () => readFileWindowRaw(args.path, args.startLine, args.endLine));
    },
    searchRepoText(args) {
      return runTool('search_repo_text', args, () => searchRaw(args.query, args.limit));
    },
    readSymbolDefinition(args) {
      return runTool('read_symbol_definition', args, () => searchRaw(`function ${args.symbol}`, args.limit));
    },
    readSymbolReferences(args) {
      return runTool('read_symbol_references', args, () => searchRaw(args.symbol, args.limit));
    },
    readRelatedTests(args) {
      const query = args.symbol ?? args.path ?? '';
      return runTool('read_related_tests', args, () => searchRaw(query, args.limit, true));
    },
  };
}

export function createLocalReadTools(input: LocalReadToolInput) {
  const handlers = createLocalReadToolHandlers(input);

  return [
    tool(handlers.readFileWindow, {
      name: 'read_file_window',
      description: 'Read a bounded line window from a file under the target repository.',
      schema: z.object({
        path: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      }),
    }),
    tool(handlers.searchRepoText, {
      name: 'search_repo_text',
      description: 'Search literal text in the repository and return matching file lines.',
      schema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readSymbolDefinition, {
      name: 'read_symbol_definition',
      description: 'Find likely definition lines for a symbol by literal search.',
      schema: z.object({
        symbol: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readSymbolReferences, {
      name: 'read_symbol_references',
      description: 'Find likely references for a symbol by literal search.',
      schema: z.object({
        symbol: z.string(),
        limit: z.number().int().positive().optional(),
      }),
    }),
    tool(handlers.readRelatedTests, {
      name: 'read_related_tests',
      description: 'Find likely test anchors related to a path or symbol.',
      schema: z.object({
        path: z.string().optional(),
        symbol: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
    }),
  ];
}
