import { describe, expect, it } from 'vitest';
import { getRepoBasename, getRepoId } from '../../../src/shared/path-utils';

describe('getRepoBasename', () => {
  it('extracts basename from POSIX path', () => {
    expect(getRepoBasename('/home/user/my-project')).toBe('my-project');
    expect(getRepoBasename('/var/www/html')).toBe('html');
    expect(getRepoBasename('relative/path/to/repo')).toBe('repo');
  });

  it('extracts basename from Windows path', () => {
    expect(getRepoBasename('C:\\Users\\dev\\my-project')).toBe('my-project');
    expect(getRepoBasename('D:\\workspace\\ai-wiki')).toBe('ai-wiki');
    expect(getRepoBasename('C:\\Program Files\\app')).toBe('app');
  });

  it('handles mixed separators', () => {
    expect(getRepoBasename('C:/Users/dev/my-project')).toBe('my-project');
    expect(getRepoBasename('/home/user\\my-project')).toBe('my-project');
  });

  it('handles trailing separators', () => {
    expect(getRepoBasename('/home/user/my-project/')).toBe('my-project');
    expect(getRepoBasename('C:\\Users\\dev\\my-project\\')).toBe('my-project');
    expect(getRepoBasename('/path/to/repo///')).toBe('repo');
  });

  it('handles single segment paths', () => {
    expect(getRepoBasename('my-project')).toBe('my-project');
    expect(getRepoBasename('repo')).toBe('repo');
  });

  it('handles empty or root paths', () => {
    expect(getRepoBasename('')).toBe('unknown');
    expect(getRepoBasename('/')).toBe('unknown');
    expect(getRepoBasename('C:\\')).toBe('unknown');
  });
});

describe('getRepoId', () => {
  it('generates sanitized repo ID', () => {
    expect(getRepoId('/home/user/my-project')).toBe('my-project');
    expect(getRepoId('C:\\Users\\dev\\My Project')).toBe('my-project');
    expect(getRepoId('/path/to/My Awesome App')).toBe('my-awesome-app');
  });

  it('removes special characters', () => {
    expect(getRepoId('/path/to/app@v1')).toBe('appv1');
    expect(getRepoId('C:\\repos\\test.repo')).toBe('testrepo');
    expect(getRepoId('/home/user/app-v2.0')).toBe('app-v20');
  });

  it('converts to lowercase', () => {
    expect(getRepoId('/path/to/MyProject')).toBe('myproject');
    expect(getRepoId('C:\\Users\\REPO_NAME')).toBe('repo-name');
  });

  it('handles empty path', () => {
    expect(getRepoId('')).toBe('unknown');
    expect(getRepoId('/')).toBe('unknown');
  });
});