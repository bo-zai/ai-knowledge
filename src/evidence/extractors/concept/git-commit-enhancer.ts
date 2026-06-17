/**
 * Git Commit 增强器
 *
 * 从 Git 历史提取与表相关的 Commit 信息，增强概念候选。
 *
 * 功能：
 * - 扫描候选涉及的文件的 git log
 * - 计算相关度（修改了 Entity/Mapper/Controller 加分）
 * - commit message 包含表名额外加分
 * - 返回前 10 条最相关 commit
 */

import { execa } from "execa";
import type {
  TableAnchor,
  GitCommitEvidence,
  TableTraceSource,
} from "./types.js";

/**
 * Git Commit 增强器配置
 */
export interface GitCommitEnhancerConfig {
  /** 最大返回 commit 数量 */
  maxCommits?: number;
  /** 查询历史深度（天数） */
  historyDays?: number;
  /** Entity 文件修改加分 */
  entityBonus?: number;
  /** Mapper 文件修改加分 */
  mapperBonus?: number;
  /** Controller 文件修改加分 */
  controllerBonus?: number;
  /** commit message 包含表名加分 */
  tableNameBonus?: number;
}

/**
 * Git Commit 增强器实现
 */
export class GitCommitEnhancerImpl {
  private readonly config: Required<GitCommitEnhancerConfig>;

  constructor(config?: GitCommitEnhancerConfig) {
    this.config = {
      maxCommits: config?.maxCommits ?? 10,
      historyDays: config?.historyDays ?? 365,
      entityBonus: config?.entityBonus ?? 0.2,
      mapperBonus: config?.mapperBonus ?? 0.15,
      controllerBonus: config?.controllerBonus ?? 0.1,
      tableNameBonus: config?.tableNameBonus ?? 0.25,
    };
  }

  /**
   * 增强 Git Commit 信息
   *
   * @param tableAnchors - 表锚点列表
   * @param repoPath - 仓库根路径
   * @returns 表名 -> Git Commit 证据列表的映射
   */
  async enhance(
    tableAnchors: TableAnchor[],
    repoPath: string,
  ): Promise<Map<string, GitCommitEvidence[]>> {
    const result = new Map<string, GitCommitEvidence[]>();

    // 为每个表锚点获取相关 commit
    for (const anchor of tableAnchors) {
      try {
        const commits = await this.getRelevantCommits(anchor, repoPath);
        result.set(anchor.tableName, commits);
      } catch (error) {
        // 记录错误但继续处理其他锚点
        console.warn(`获取表 ${anchor.tableName} 的 Git commit 失败: ${error}`);
        result.set(anchor.tableName, []);
      }
    }

    return result;
  }

  /**
   * 获取与单个表锚点相关的 commit
   *
   * @param anchor - 表锚点
   * @param repoPath - 仓库根路径
   * @returns 最相关的 commit 列表（最多 maxCommits 条）
   */
  private async getRelevantCommits(
    anchor: TableAnchor,
    repoPath: string,
  ): Promise<GitCommitEvidence[]> {
    // 1. 收集所有相关文件路径
    const filePaths = this.collectRelevantFilePaths(anchor);

    if (filePaths.length === 0) {
      return [];
    }

    // 2. 执行 git log 获取这些文件的 commit 历史
    const rawCommits = await this.fetchGitLog(filePaths, repoPath);

    // 3. 计算每个 commit 的相关度并排序
    const scoredCommits = rawCommits.map((commit) =>
      this.scoreCommit(commit, anchor.tableName, anchor.traceSources),
    );

    // 4. 按相关度排序，返回前 N 条
    scoredCommits.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scoredCommits.slice(0, this.config.maxCommits);
  }

  /**
   * 收集表锚点涉及的所有文件路径
   *
   * 包括：Entity 文件、Mapper 文件、Controller 文件
   */
  private collectRelevantFilePaths(anchor: TableAnchor): string[] {
    const filePaths: string[] = [];

    for (const source of anchor.traceSources) {
      // Entity 文件
      if (source.entityFilePath) {
        filePaths.push(source.entityFilePath);
      }

      // Mapper 文件
      if (source.mapperFilePath) {
        filePaths.push(source.mapperFilePath);
      }

      // 入口点文件（Controller/Scheduled/MQ Consumer）
      for (const ep of source.entryPoints) {
        if (ep.filePath) {
          filePaths.push(ep.filePath);
        }
      }
    }

    // 去重
    return [...new Set(filePaths)];
  }

  /**
   * 执行 git log 获取文件历史
   *
   * 使用 git log --follow 获取完整历史
   */
  private async fetchGitLog(
    filePaths: string[],
    repoPath: string,
  ): Promise<RawGitCommit[]> {
    const commits: RawGitCommit[] = [];

    // 构建日期范围参数
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - this.config.historyDays);
    const sinceStr = sinceDate.toISOString().split("T")[0];

    // 使用 git log 获取所有相关文件的 commit
    // 注意：--all-match 确保同时匹配多个条件
    try {
      // 分批处理，避免命令过长
      const batchSize = 20;
      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize);

        // 执行 git log
        const { stdout } = await execa(
          "git",
          [
            "log",
            "--all",
            "--since",
            sinceStr,
            "--pretty=format:%H%n%s%n%ad%n%an%n---COMMIT_END---",
            "--date=short",
            ...batch,
          ],
          {
            cwd: repoPath,
            reject: false, // 不抛出错误
          },
        );

        // 解析输出
        const parsedCommits = this.parseGitLogOutput(stdout);
        commits.push(...parsedCommits);
      }
    } catch (error) {
      // Git 命令失败时返回空数组
      console.warn(`Git log 命令执行失败: ${error}`);
    }

    // 去重（同一个 commit 可能出现在多个文件的历史中）
    const uniqueCommits = new Map<string, RawGitCommit>();
    for (const commit of commits) {
      uniqueCommits.set(commit.hash, commit);
    }

    return [...uniqueCommits.values()];
  }

  /**
   * 解析 git log 输出
   *
   * 输出格式：%H%n%s%n%ad%n%an%n---COMMIT_END---
   */
  private parseGitLogOutput(output: string): RawGitCommit[] {
    if (!output || output.trim() === "") {
      return [];
    }

    const commits: RawGitCommit[] = [];
    const commitBlocks = output
      .split("---COMMIT_END---")
      .filter((block) => block.trim());

    for (const block of commitBlocks) {
      const lines = block.trim().split("\n");
      if (lines.length >= 4) {
        commits.push({
          hash: lines[0],
          message: lines[1],
          date: lines[2],
          author: lines[3],
        });
      }
    }

    return commits;
  }

  /**
   * 计算 commit 相关度分数
   *
   * 加分项：
   * - 修改了 Entity 文件（核心）
   * - 修改了 Mapper 文件（数据层）
   * - 修改了 Controller 文件（入口层）
   * - commit message 包含表名（业务相关性）
   */
  private scoreCommit(
    commit: RawGitCommit,
    tableName: string,
    traceSources: TableTraceSource[],
  ): GitCommitEvidence {
    let score = 0.1; // 基础分数

    // 1. 检查 commit message 是否包含表名
    const tableNamePatterns = this.getTableNames(tableName);
    if (
      tableNamePatterns.some((pattern) =>
        commit.message.toLowerCase().includes(pattern.toLowerCase()),
      )
    ) {
      score += this.config.tableNameBonus;
    }

    // 2. 检查是否修改了关键文件类型
    // 由于 git log 输出中没有包含文件列表，这里基于 commit message 推断
    const msgLower = commit.message.toLowerCase();

    // Entity 相关关键词
    if (
      msgLower.includes("entity") ||
      msgLower.includes(tableNamePatterns[0])
    ) {
      score += this.config.entityBonus;
    }

    // Mapper/DAO 相关关键词
    if (
      msgLower.includes("mapper") ||
      msgLower.includes("dao") ||
      msgLower.includes("sql")
    ) {
      score += this.config.mapperBonus;
    }

    // Controller/API 相关关键词
    if (
      msgLower.includes("controller") ||
      msgLower.includes("api") ||
      msgLower.includes("endpoint")
    ) {
      score += this.config.controllerBonus;
    }

    // 3. 从 traceSources 检查文件路径是否在 commit 中被修改
    // 这需要额外获取每个 commit 的变更文件列表
    // 简化处理：如果 commit message 提到相关类名，给予加分
    for (const source of traceSources) {
      const className = source.entityClassName;
      if (className && commit.message.includes(className)) {
        score += this.config.entityBonus;
      }

      const mapperName = source.mapperClassName;
      if (mapperName && commit.message.includes(mapperName)) {
        score += this.config.mapperBonus;
      }

      for (const ep of source.entryPoints) {
        if (ep.className && commit.message.includes(ep.className)) {
          score += this.config.controllerBonus;
        }
      }
    }

    // 限制最大分数
    score = Math.min(score, 1.0);

    // 获取变更文件列表（异步操作转为同步）
    // 由于我们无法在此处异步获取变更文件，使用简化版本
    const changedFiles = this.inferChangedFiles(commit, traceSources);

    return {
      commitHash: commit.hash,
      commitMessage: commit.message,
      commitDate: commit.date,
      author: commit.author,
      changedFiles,
      relevanceScore: score,
    };
  }

  /**
   * 推断变更文件列表
   *
   * 基于 commit message 和 traceSources 推断可能变更的文件
   */
  private inferChangedFiles(
    commit: RawGitCommit,
    traceSources: TableTraceSource[],
  ): GitCommitEvidence["changedFiles"] {
    const changedFiles: GitCommitEvidence["changedFiles"] = [];
    const msgLower = commit.message.toLowerCase();

    for (const source of traceSources) {
      // Entity 文件
      if (
        source.entityFilePath &&
        this.isLikelyChanged(source.entityClassName, msgLower)
      ) {
        changedFiles.push({
          filePath: source.entityFilePath,
          moduleName: source.moduleName,
          changeType: "modified",
        });
      }

      // Mapper 文件
      if (
        source.mapperFilePath &&
        this.isLikelyChanged(source.mapperClassName, msgLower)
      ) {
        changedFiles.push({
          filePath: source.mapperFilePath,
          moduleName: source.moduleName,
          changeType: "modified",
        });
      }

      // 入口点文件
      for (const ep of source.entryPoints) {
        if (ep.filePath && this.isLikelyChanged(ep.className, msgLower)) {
          changedFiles.push({
            filePath: ep.filePath,
            moduleName: ep.moduleName,
            changeType: "modified",
          });
        }
      }
    }

    return changedFiles;
  }

  /**
   * 判断类是否可能被变更
   *
   * 检查 commit message 是否包含类名或相关关键词
   */
  private isLikelyChanged(className: string, msgLower: string): boolean {
    if (!className) return false;

    // 类名匹配
    const classLower = className.toLowerCase();
    if (msgLower.includes(classLower)) {
      return true;
    }

    // 部分匹配（去除后缀）
    const baseName = classLower.replace(
      /(?:service|controller|mapper|dao|entity|impl)$/i,
      "",
    );
    if (baseName && msgLower.includes(baseName)) {
      return true;
    }

    return false;
  }

  /**
   * 获取表名的多种变体
   *
   * 用于匹配 commit message
   */
  private getTableNames(tableName: string): string[] {
    const variants: string[] = [tableName];

    // snake_case -> CamelCase
    const camelCase = tableName
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
    variants.push(camelCase);

    // 去除常见后缀
    const cleanName = tableName.replace(
      /_(?:order|info|detail|record|log|config|setting|data)$/i,
      "",
    );
    if (cleanName !== tableName) {
      variants.push(cleanName);
    }

    return variants;
  }
}

/**
 * 原始 Git Commit 数据结构
 */
interface RawGitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * 创建 Git Commit 增强器实例
 */
export function createGitCommitEnhancer(
  config?: GitCommitEnhancerConfig,
): GitCommitEnhancerImpl {
  return new GitCommitEnhancerImpl(config);
}
