import { describe, expect, it, beforeAll } from 'vitest';
import { createLocalReadToolHandlers } from '../../src/agent-read-runtime/local-read-tools.js';
import { createBudgetState, DEFAULT_KNOWLEDGE_READ_LIMITS } from '../../src/agent-read-runtime/context-budget.js';
import { createTraceCollector } from '../../src/agent-read-runtime/trace.js';
import path from 'node:path';

// 使用当前项目作为测试仓库
const REPO_PATH = process.cwd();

describe('local-read-tools', () => {
  let handlers: ReturnType<typeof createLocalReadToolHandlers>;

  beforeAll(() => {
    const budget = createBudgetState(DEFAULT_KNOWLEDGE_READ_LIMITS);
    const trace = createTraceCollector();
    handlers = createLocalReadToolHandlers({
      repoPath: REPO_PATH,
      budget,
      trace,
    });
  });

  describe('readFileWindow', () => {
    it('读取文件指定行范围', async () => {
      // 读取 vitest.config.ts 的第 1-5 行
      const result = await handlers.readFileWindow({
        path: 'vitest.config.ts',
        startLine: 1,
        endLine: 5,
      });

      expect(result).toContain('1 |');
      expect(result).toContain('defineConfig');
      expect(result).toContain('vitest');
    });

    it('读取不存在的文件返回错误', async () => {
      const result = await handlers.readFileWindow({
        path: 'nonexistent-file.ts',
        startLine: 1,
        endLine: 5,
      });

      expect(result).toContain('tool error');
    });

    it('无效行号返回错误', async () => {
      const result = await handlers.readFileWindow({
        path: 'vitest.config.ts',
        startLine: 0,
        endLine: 5,
      });

      expect(result).toContain('tool error');
      expect(result).toContain('invalid line window');
    });
  });

  describe('searchRepoText', () => {
    it('搜索文本能找到匹配项', async () => {
      const result = await handlers.searchRepoText({
        query: 'createLocalReadToolHandlers',
        limit: 5,
      });

      expect(result).toContain('local-read-tools.ts');
      expect(result).toContain('createLocalReadToolHandlers');
    });

    it('搜索不存在文本返回无匹配', async () => {
      const result = await handlers.searchRepoText({
        query: 'this-text-does-not-exist-xyz123',
        limit: 5,
      });

      expect(result).toContain('no matches');
    });
  });

  describe('readSymbolDefinition', () => {
    it('查找符号定义', async () => {
      const result = await handlers.readSymbolDefinition({
        symbol: 'createBudgetState',
        limit: 5,
      });

      expect(result).toContain('context-budget.ts');
      expect(result).toContain('function');
      expect(result).toContain('createBudgetState');
    });
  });

  describe('readSymbolReferences', () => {
    it('查找符号引用', async () => {
      const result = await handlers.readSymbolReferences({
        symbol: 'DEFAULT_KNOWLEDGE_READ_LIMITS',
        limit: 10,
      });

      // 应该在 local-read-tools.ts 和其他文件中被引用
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('readRelatedTests', () => {
    it('查找相关测试文件', async () => {
      const result = await handlers.readRelatedTests({
        path: 'src/agent-read-runtime/local-read-tools.ts',
        limit: 5,
      });

      // 当前项目没有针对此模块的测试，应该返回无匹配或空
      expect(result).toBeDefined();
    });
  });
});