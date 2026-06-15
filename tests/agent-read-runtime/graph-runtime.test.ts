import { describe, expect, it } from 'vitest';
import { runKnowledgeReadRuntime } from '../../src/agent-read-runtime/graph-runtime.js';
import { LLM_DEFAULTS } from '../../src/config/defaults.js';
import path from 'node:path';

// 使用当前项目作为测试仓库
const REPO_PATH = process.cwd();

// 设置较长的超时时间（LLM 调用需要时间）
const TEST_TIMEOUT = 60000;

describe('knowledge-read-runtime (LangGraph + LLM)', () => {
  it('LLM 使用 read_file_window 工具读取文件', async () => {
    const result = await runKnowledgeReadRuntime({
      repoPath: REPO_PATH,
      instruction: '使用 read_file_window 工具读取 vitest.config.ts 文件的第 1-10 行。返回 JSON 格式结果，包含 answer、evidence_refs、insufficient_evidence 字段。',
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKey: LLM_DEFAULTS.apiKey,
      limits: {
        maxToolCalls: 3,
        maxToolResultChars: 5000,
      },
    });

    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toBeDefined();
    expect(result.answer.length).toBeGreaterThan(10);
    expect(result.toolCallsUsed).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);

  it('LLM 使用 search_repo_text 工具搜索代码', async () => {
    const result = await runKnowledgeReadRuntime({
      repoPath: REPO_PATH,
      instruction: '使用 search_repo_text 工具搜索 DEFAULT_KNOWLEDGE_DIR 常量。返回 JSON 格式结果。',
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKey: LLM_DEFAULTS.apiKey,
      limits: {
        maxToolCalls: 3,
        maxToolResultChars: 8000,
      },
    });

    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toBeDefined();
    expect(result.toolCallsUsed).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);

  it('预算耗尽时返回 insufficient_evidence', async () => {
    const result = await runKnowledgeReadRuntime({
      repoPath: REPO_PATH,
      instruction: '读取 src/agent-read-runtime 目录下所有文件的完整内容。',
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKey: LLM_DEFAULTS.apiKey,
      limits: {
        maxToolCalls: 1,
        maxToolResultChars: 500,
        maxTotalToolResultChars: 500,
      },
    });

    expect(result.insufficientEvidence).toBe(true);
  }, TEST_TIMEOUT);
});