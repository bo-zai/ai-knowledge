/**
 * 文件操作辅助函数
 *
 * 用于 DomainClusterAgent 的文件搜索和读取
 */

import { glob } from "glob";
import fs from "fs/promises";
import path from "path";

/**
 * Glob 文件搜索
 */
export async function globFiles(
  rootPath: string,
  pattern: string,
): Promise<string[]> {
  const absolutePattern = path.isAbsolute(pattern)
    ? pattern
    : path.join(rootPath, pattern);

  const matches = await glob(absolutePattern, {
    cwd: rootPath,
    absolute: true,
    ignore: [
      "node_modules/**",
      ".git/**",
      "dist/**",
      "build/**",
      "target/**",
      "*.class",
      "*.jar",
    ],
  });

  return matches;
}

/**
 * Grep 文件内容搜索（literal 匹配）
 */
export async function grepPatternInFiles(
  rootPath: string,
  pattern: string,
  globPattern?: string,
): Promise<{ filePath: string; line: number; content: string }[]> {
  const files = globPattern
    ? await globFiles(rootPath, globPattern)
    : await globFiles(rootPath, "**/*");

  const results: { filePath: string; line: number; content: string }[] = [];

  for (const file of files.slice(0, 100)) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(pattern)) {
          results.push({
            filePath: file,
            line: i + 1,
            content: lines[i].trim().slice(0, 150),
          });
        }
      }
    } catch {
      // 文件读取失败，跳过
    }
  }

  return results.slice(0, 50);
}

/**
 * 提取关键词匹配上下文
 */
export function extractContextAroundLine(
  content: string,
  lineNumber: number,
  contextLines: number = 3,
): string {
  const lines = content.split("\n");
  const start = Math.max(0, lineNumber - contextLines - 1);
  const end = Math.min(lines.length, lineNumber + contextLines);

  return lines
    .slice(start, end)
    .map((line, idx) => `${start + idx + 1}\t${line}`)
    .join("\n");
}
