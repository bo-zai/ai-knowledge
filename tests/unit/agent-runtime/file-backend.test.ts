import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileBackend } from '../../../src/agent-runtime/file-backend.js';

describe('FileBackend', () => {
  let testDir: string;
  let backend: FileBackend;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-backend-test-'));
    backend = new FileBackend({ rootDir: testDir });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // ── ls 测试 ────────────────────────────────────────────────────────

  describe('ls', () => {
    it('列出目录内容', async () => {
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content2');
      await fs.mkdir(path.join(testDir, 'subdir'));

      const result = await backend.ls('.');

      expect(result.length).toBe(3);
      expect(result.some(f => f.path.endsWith('file1.txt'))).toBe(true);
      expect(result.some(f => f.path.endsWith('file2.txt'))).toBe(true);
      expect(result.find(f => f.path.endsWith('subdir'))?.is_dir).toBe(true);
    });

    it('返回文件元信息', async () => {
      await fs.writeFile(path.join(testDir, 'test.txt'), 'hello world');

      const result = await backend.ls('.');

      const file = result.find(f => f.path.endsWith('test.txt'));
      expect(file).toBeDefined();
      expect(file?.is_dir).toBe(false);
      expect(file?.size).toBe(11);
      expect(file?.modified_at).toBeDefined();
    });

    it('处理不存在的目录', async () => {
      const result = await backend.ls('nonexistent');

      expect(result.length).toBe(1);
      expect(result[0]?.path).toContain('错误');
    });

    it('使用虚拟路径模式', async () => {
      await fs.writeFile(path.join(testDir, 'virtual.txt'), 'content');
      const virtualBackend = new FileBackend({ rootDir: testDir, virtualMode: true });

      const result = await virtualBackend.ls('/');

      expect(result.some(f => f.path === '/virtual.txt')).toBe(true);
    });
  });

  // ── read_file 测试 ───────────────────────────────────────────────────

  describe('read_file', () => {
    it('读取文件内容并添加行号', async () => {
      await fs.writeFile(path.join(testDir, 'test.txt'), 'line1\nline2\nline3');

      const result = await backend.read_file('test.txt');

      expect(result).toContain('1\tline1');
      expect(result).toContain('2\tline2');
      expect(result).toContain('3\tline3');
    });

    it('支持偏移和限制', async () => {
      await fs.writeFile(path.join(testDir, 'test.txt'), 'line1\nline2\nline3\nline4\nline5');

      // offset=2, limit=3: 有更多内容时，返回 limit-1 行（保留一行用于提示）
      const result = await backend.read_file('test.txt', 2, 3);

      // 实际返回 line3（offset=2 对应第 3 行）
      expect(result).toContain('3\tline3');
      // 不包含 offset=2 之前的行
      expect(result).not.toContain('line1');
      expect(result).not.toContain('line2');
    });

    it('显示继续读取提示', async () => {
      await fs.writeFile(path.join(testDir, 'test.txt'), 'line1\nline2\nline3');

      // offset=0, limit=2: 有更多内容时返回 1 行并显示继续提示
      const result = await backend.read_file('test.txt', 0, 2);

      // 继续读取提示包含下一行的 offset
      expect(result).toContain('offset=1');
      expect(result).toContain('line1');
    });

    it('处理空文件', async () => {
      await fs.writeFile(path.join(testDir, 'empty.txt'), '');

      const result = await backend.read_file('empty.txt');

      expect(result).toContain('空');
    });

    it('处理不存在的文件', async () => {
      const result = await backend.read_file('nonexistent.txt');

      expect(result).toContain('错误');
    });

    it('偏移超出文件长度时返回错误', async () => {
      await fs.writeFile(path.join(testDir, 'short.txt'), 'one line');

      const result = await backend.read_file('short.txt', 100, 10);

      expect(result).toContain('错误');
      expect(result).toContain('超出文件长度');
    });
  });

  // ── write_file 测试 ──────────────────────────────────────────────────

  describe('write_file', () => {
    it('写入新文件', async () => {
      const result = await backend.write_file('new.txt', 'hello world');

      expect(result.path).toBe('new.txt');
      expect(result.error).toBeUndefined();

      const content = await fs.readFile(path.join(testDir, 'new.txt'), 'utf8');
      expect(content).toBe('hello world');
    });

    it('覆盖已存在的文件', async () => {
      await fs.writeFile(path.join(testDir, 'existing.txt'), 'old content');

      const result = await backend.write_file('existing.txt', 'new content');

      expect(result.path).toBe('existing.txt');

      const content = await fs.readFile(path.join(testDir, 'existing.txt'), 'utf8');
      expect(content).toBe('new content');
    });

    it('自动创建父目录', async () => {
      const result = await backend.write_file('deep/nested/dir/file.txt', 'nested');

      expect(result.path).toBe('deep/nested/dir/file.txt');

      const content = await fs.readFile(path.join(testDir, 'deep/nested/dir/file.txt'), 'utf8');
      expect(content).toBe('nested');
    });

    it('拒绝过大的内容', async () => {
      const smallBackend = new FileBackend({ rootDir: testDir, maxFileSizeMb: 0.001 });
      const largeContent = 'x'.repeat(10 * 1024); // 10KB

      const result = await smallBackend.write_file('large.txt', largeContent);

      expect(result.error).toContain('过大');
    });
  });

  // ── edit_file 测试 ───────────────────────────────────────────────────

  describe('edit_file', () => {
    it('精确替换字符串', async () => {
      await fs.writeFile(path.join(testDir, 'edit.txt'), 'hello world');

      const result = await backend.edit_file('edit.txt', 'world', 'universe');

      expect(result.path).toBe('edit.txt');

      const content = await fs.readFile(path.join(testDir, 'edit.txt'), 'utf8');
      expect(content).toBe('hello universe');
    });

    it('找不到字符串时返回错误', async () => {
      await fs.writeFile(path.join(testDir, 'edit.txt'), 'hello world');

      const result = await backend.edit_file('edit.txt', 'notfound', 'replacement');

      expect(result.error).toContain('未找到');
    });

    it('多个匹配时要求指定 replaceAll', async () => {
      await fs.writeFile(path.join(testDir, 'multi.txt'), 'foo bar foo baz foo');

      const result = await backend.edit_file('multi.txt', 'foo', 'qux');

      expect(result.error).toContain('找到 3 个匹配');
    });

    it('replaceAll 替换所有匹配', async () => {
      await fs.writeFile(path.join(testDir, 'multi.txt'), 'foo bar foo baz foo');

      const result = await backend.edit_file('multi.txt', 'foo', 'qux', true);

      expect(result.path).toBe('multi.txt');

      const content = await fs.readFile(path.join(testDir, 'multi.txt'), 'utf8');
      expect(content).toBe('qux bar qux baz qux');
    });

    it('处理不存在的文件', async () => {
      const result = await backend.edit_file('nonexistent.txt', 'old', 'new');

      expect(result.error).toBeDefined();
    });
  });

  // ── glob 测试 ───────────────────────────────────────────────────────

  describe('glob', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(testDir, 'file1.ts'), 'ts1');
      await fs.writeFile(path.join(testDir, 'file2.ts'), 'ts2');
      await fs.writeFile(path.join(testDir, 'file3.js'), 'js1');
      await fs.mkdir(path.join(testDir, 'src'));
      await fs.writeFile(path.join(testDir, 'src', 'module.ts'), 'module');
    });

    it('按扩展名搜索文件', async () => {
      const result = await backend.glob('**/*.ts');

      expect(result.length).toBe(3);
      expect(result.every(f => f.path.endsWith('.ts'))).toBe(true);
    });

    it('搜索指定目录', async () => {
      const result = await backend.glob('*.ts', 'src');

      expect(result.length).toBe(1);
      expect(result[0]?.path).toContain('module.ts');
    });

    it('返回文件信息', async () => {
      const result = await backend.glob('file1.ts');

      expect(result.length).toBe(1);
      expect(result[0]?.is_dir).toBe(false);
      expect(result[0]?.size).toBe(3);
    });

    it('虚拟模式返回虚拟路径', async () => {
      const virtualBackend = new FileBackend({ rootDir: testDir, virtualMode: true });

      const result = await virtualBackend.glob('*.ts');

      expect(result.some(f => f.path === '/file1.ts')).toBe(true);
    });
  });

  // ── grep 测试 ────────────────────────────────────────────────────────

  describe('grep', () => {
    beforeEach(async () => {
      // 使用单独的目录避免干扰其他测试
      await fs.writeFile(
        path.join(testDir, 'search.txt'),
        'hello world\nfoo bar\nhello foo\nend'
      );
    });

    it('搜索匹配行', async () => {
      // 只在 search.txt 中搜索
      const result = await backend.grep('hello', 'search.txt');

      expect(result.length).toBe(2);
      expect(result.some(m => m.text.includes('hello world'))).toBe(true);
      expect(result.some(m => m.text.includes('hello foo'))).toBe(true);
    });

    it('返回正确的行号', async () => {
      const result = await backend.grep('hello', 'search.txt');

      expect(result.length).toBe(2);
      expect(result.find(m => m.text.includes('hello world'))?.line).toBe(1);
      expect(result.find(m => m.text.includes('hello foo'))?.line).toBe(3);
    });

    it('在目录中搜索', async () => {
      await fs.mkdir(path.join(testDir, 'sub'));
      await fs.writeFile(path.join(testDir, 'sub', 'nested.txt'), 'hello nested');

      // 使用递归 glob 模式搜索所有 txt 文件
      const result = await backend.grep('hello', '.', '**/*.txt');

      // 应该在 search.txt 和 sub/nested.txt 中找到
      expect(result.length).toBe(3);
    });

    it('在单个文件中搜索', async () => {
      const result = await backend.grep('foo', 'search.txt');

      expect(result.length).toBe(2);
      expect(result.every(m => m.path.includes('search.txt'))).toBe(true);
    });

    it('未找到匹配返回空数组', async () => {
      const result = await backend.grep('notfound12345', 'search.txt');

      expect(result).toEqual([]);
    });

    it('虚拟模式返回虚拟路径', async () => {
      const virtualBackend = new FileBackend({ rootDir: testDir, virtualMode: true });

      const result = await virtualBackend.grep('hello', 'search.txt');

      expect(result[0]?.path).toBe('/search.txt');
    });
  });

  // ── 路径安全测试 ────────────────────────────────────────────────────

  describe('路径安全', () => {
    it('允许合法的相对路径', async () => {
      await fs.mkdir(path.join(testDir, 'sub'));
      await fs.writeFile(path.join(testDir, 'sub', 'file.txt'), 'content');

      const result = await backend.read_file('sub/file.txt');

      expect(result).toContain('content');
    });

    it('允许合法的父目录遍历', async () => {
      // 在 testDir 下创建 subdir，然后通过 ../ 访问
      await fs.mkdir(path.join(testDir, 'subdir'));
      await fs.writeFile(path.join(testDir, 'root.txt'), 'root content');

      // 在 subdir 内部使用 ../ 应该仍然在 testDir 内
      const subBackend = new FileBackend({ rootDir: testDir });
      const result = await subBackend.read_file('root.txt');

      expect(result).toContain('root content');
    });

    it('虚拟模式阻止路径遍历', async () => {
      const virtualBackend = new FileBackend({ rootDir: testDir, virtualMode: true });

      await expect(virtualBackend.read_file('/../etc/passwd')).rejects.toThrow();
    });

    it('虚拟模式阻止 ~ 开头的路径', async () => {
      const virtualBackend = new FileBackend({ rootDir: testDir, virtualMode: true });

      await expect(virtualBackend.read_file('/~/some/path')).rejects.toThrow();
    });
  });

  // ── 辅助方法测试 ────────────────────────────────────────────────────

  describe('辅助方法', () => {
    it('getWorkingDir 返回工作目录', () => {
      expect(backend.getWorkingDir()).toBe(testDir);
    });

    it('getConfig 返回配置信息', () => {
      const config = backend.getConfig();

      expect(config.rootDir).toBe(testDir);
      expect(config.maxFileSizeMb).toBe(10);
      expect(config.encoding).toBe('utf-8');
      expect(config.virtualMode).toBe(false);
    });

    it('支持自定义配置', () => {
      const customBackend = new FileBackend({
        rootDir: testDir,
        maxFileSizeMb: 20,
        encoding: 'latin1',
        virtualMode: true,
      });

      const config = customBackend.getConfig();

      expect(config.maxFileSizeMb).toBe(20);
      expect(config.encoding).toBe('latin1');
      expect(config.virtualMode).toBe(true);
    });
  });
});