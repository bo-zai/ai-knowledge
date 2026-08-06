/**
 * init-skills CLI 命令
 *
 * 初始化项目的 AI Agent skills
 */

import { resolveTargetRepo } from "../shared/resolve-target-repo.js";
import { logger } from "../shared/logger.js";
import {
  initializeSkills,
  getSupportedAgentIds,
  type SkillInitSummary,
} from "../skills/index.js";

export interface InitSkillsOptions {
  /** 项目路径 */
  path?: string;

  /** 项目路径（repo 参数） */
  repo?: string;

  /** 要初始化的 Agent ID 列表 */
  agents?: string;

  /** 是否强制重新初始化 */
  force?: boolean;

  /** 是否更新 AGENTS.md */
  updateAgentsMd?: boolean;

  /** 是否 verbose 输出 */
  verbose?: boolean;

  /** Business domain id */
  businessDomain?: string;

  /** Business domain display name */
  businessDomainName?: string;

  /** Comma-separated business domain aliases */
  businessDomainAliases?: string;

  /** Comma-separated business domain source path globs */
  businessDomainPaths?: string;
}

function parseCommaList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function hasBusinessSubagentOptions(options: InitSkillsOptions): boolean {
  return Boolean(
    options.businessDomain !== undefined ||
      options.businessDomainName !== undefined ||
      options.businessDomainAliases !== undefined ||
      options.businessDomainPaths !== undefined,
  );
}

/**
 * 运行 init-skills 命令
 */
export async function runInitSkills(options: InitSkillsOptions): Promise<void> {
  // 解析项目路径
  const resolved = resolveTargetRepo({
    repoOption: options.repo,
    positionalPath: options.path,
  });
  const repoPath = resolved.repoPath;

  // 解析 Agent ID 列表
  const agentIds = options.agents
    ? options.agents.split(",").map((id) => id.trim())
    : undefined;

  // 验证 Agent ID
  if (agentIds) {
    const supportedIds = getSupportedAgentIds();
    const invalidIds = agentIds.filter((id) => !supportedIds.includes(id));
    if (invalidIds.length > 0) {
      logger.error(`Invalid agent IDs: ${invalidIds.join(", ")}`);
      logger.info(`Supported agents: ${supportedIds.join(", ")}`);
      return;
    }
  }

  const businessSubagents =
    hasBusinessSubagentOptions(options)
      ? [
          {
            domain: options.businessDomain ?? "",
            domainName: options.businessDomainName ?? "",
            aliases: parseCommaList(options.businessDomainAliases),
            paths: parseCommaList(options.businessDomainPaths),
          },
        ]
      : undefined;

  // 执行初始化
  const summary: SkillInitSummary = await initializeSkills(
    {
      repoPath,
      businessSubagents,
      force: options.force,
      updateAgentsMd: options.updateAgentsMd ?? true,
      verbose: options.verbose,
    },
    agentIds,
  );

  // 输出结果
  printSummary(summary);
}

/**
 * 打印初始化摘要
 */
function printSummary(summary: SkillInitSummary): void {
  console.log("\nSkill Initialization Summary:");
  console.log(`  Agents: ${summary.agentCount}`);
  console.log(`  Succeeded: ${summary.succeeded}`);
  console.log(`  Failed: ${summary.failed}`);

  if (summary.agentsMdUpdated) {
    console.log("  AGENTS.md: updated");
  }

  // 列出创建的文件
  const allFiles = summary.results.flatMap((r) => r.files);
  if (allFiles.length > 0) {
    console.log("\n  Created files:");
    for (const file of allFiles) {
      console.log(`    - ${file.filename}`);
    }
  }

  // 列出失败信息
  const failed = summary.results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.log("\n  Failed agents:");
    for (const result of failed) {
      console.log(`    - ${result.agentName}: ${result.error}`);
    }
  }

  console.log("");
}
