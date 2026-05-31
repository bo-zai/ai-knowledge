import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

async function createGitRepo(repo: string): Promise<void> {
  await execa('git', ['init'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: repo });
}

describe('generate end-to-end', () => {
  it('writes bootstrap-knowledge package to target repo', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-e2e-'));
    await writeFile(join(repo, 'README.md'), '# test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // 检查 catalog.yaml 存在且包含统计信息
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('version');
    expect(catalog).toContain('retrieval_order');
    expect(catalog).toContain('objects');

    // 检查 generation.json 存在且包含 stage 报告
    const reportRaw = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf8');
    const report = JSON.parse(reportRaw);
    expect(report).toHaveProperty('knowledge');
    expect(report).toHaveProperty('stages');
    expect(report).toHaveProperty('warnings');
  });

  it('keeps package generation alive when no objects are generated', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-empty-'));
    await writeFile(join(repo, 'README.md'), '# empty repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // 读取 generation.json 报告
    const reportRaw = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf8');
    const report = JSON.parse(reportRaw);

    // 验证报告结构完整
    expect(report).toHaveProperty('knowledge');
    expect(report).toHaveProperty('stages');

    // 空仓库应该产生 0 个对象
    const stages = report.stages as Record<string, { ran: boolean; succeeded: number; failed: number }>;
    const totalSucceeded = Object.values(stages)
      .filter((s) => s.ran)
      .reduce((sum, s) => sum + s.succeeded, 0);
    expect(totalSucceeded).toBe(0);
  });

  it('writes generation.json with stage details', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-coverage-'));
    await writeFile(join(repo, 'README.md'), '# coverage test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // generation.json 包含每个 stage 的 ran/succeeded/failed 信息
    const reportRaw = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf8');
    const report = JSON.parse(reportRaw);

    expect(report).toHaveProperty('stages');
    const stages = report.stages as Record<string, { ran: boolean; succeeded: number; failed: number }>;
    for (const [stageName, stage] of Object.entries(stages)) {
      expect(stage).toHaveProperty('ran');
      expect(stage).toHaveProperty('succeeded');
      expect(stage).toHaveProperty('failed');
      expect(typeof stage.ran).toBe('boolean');
      expect(typeof stage.succeeded).toBe('number');
      expect(typeof stage.failed).toBe('number');
    }
  });

  it('writes catalog.yaml with object type grouping', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-stats-'));
    await writeFile(join(repo, 'README.md'), '# stats test repo');
    await createGitRepo(repo);

    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);

    // catalog.yaml 包含对象信息和检索顺序
    const catalog = await readFile(join(repo, 'bootstrap-knowledge', 'catalog.yaml'), 'utf8');
    expect(catalog).toContain('objects:');
    expect(catalog).toContain('retrieval_order:');
    expect(catalog).toContain('unknown_escalation_rules:');
    expect(catalog).toContain('db_context:');
    expect(catalog).toContain('capability_context:');
  });
});
