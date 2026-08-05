/**
 * Claude Code Agent
 *
 * Skill 存储位置：项目根目录的 .claude/skills/ 目录
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  Agent,
  SkillInitConfig,
  SkillInitResult,
  SkillFile,
} from "./types.js";
import {
  getBusinessSubagentDiskPath,
  renderBusinessSubagentFiles,
  renderClaudeBusinessAgentSection,
} from "../business-subagents.js";

export const CLAUDE_CODE_AGENT: Agent = {
  name: "Claude Code",
  id: "claude-code",

  getSkillDir(repoPath: string): string {
    return path.join(repoPath, ".claude", "skills");
  },

  async isInitialized(
    repoPath: string,
    config?: SkillInitConfig,
  ): Promise<boolean> {
    const skillDir = this.getSkillDir(repoPath);
    const useKnowledgePath = path.join(skillDir, "use-knowledge", "SKILL.md");

    try {
      await fs.access(useKnowledgePath);
      for (const businessSubagent of config?.businessSubagents ?? []) {
        const businessFiles =
          await renderBusinessSubagentFiles(businessSubagent);
        for (const file of businessFiles) {
          await fs.access(getBusinessSubagentDiskPath(repoPath, file.filename));
        }
      }
      return true;
    } catch {
      return false;
    }
  },

  async initialize(config: SkillInitConfig): Promise<SkillInitResult> {
    const skillDir = this.getSkillDir(config.repoPath);
    const files: SkillFile[] = [];

    try {
      // 创建 skill 目录
      await fs.mkdir(skillDir, { recursive: true });

      // 写入 use-knowledge skill（从 skill-templates 获取内容）
      const { USE_KNOWLEDGE_SKILL } = await import("../skill-templates.js");
      if (!USE_KNOWLEDGE_SKILL) {
        throw new Error("USE_KNOWLEDGE_SKILL is undefined or empty");
      }
      const useKnowledgeDir = path.join(skillDir, "use-knowledge");
      await fs.mkdir(useKnowledgeDir, { recursive: true });
      const skillFilePath = path.join(useKnowledgeDir, "SKILL.md");
      await fs.writeFile(skillFilePath, USE_KNOWLEDGE_SKILL, "utf-8");
      files.push({
        name: "use-knowledge",
        filename: ".claude/skills/use-knowledge/SKILL.md",
        content: USE_KNOWLEDGE_SKILL,
      });

      for (const businessSubagent of config.businessSubagents ?? []) {
        const businessFiles =
          await renderBusinessSubagentFiles(businessSubagent);
        for (const file of businessFiles) {
          const filePath = getBusinessSubagentDiskPath(
            config.repoPath,
            file.filename,
          );
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, file.content, "utf-8");
          files.push(file);
        }
      }

      return {
        agentName: this.name,
        skillDir,
        files,
        success: true,
      };
    } catch (error) {
      return {
        agentName: this.name,
        skillDir,
        files,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async generateAgentsMd(
    repoPath: string,
    config?: SkillInitConfig,
  ): Promise<string | null> {
    // Claude Code 使用 CLAUDE.md 作为系统提示词
    const claudeMdPath = path.join(repoPath, "CLAUDE.md");
    let existingContent = "";

    try {
      existingContent = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      // 文件不存在，创建新文件
    }

    // skill 使用说明片段
    const skillSection = `
## 知识库技能

本项目已配置 \`use-knowledge\` 技能，帮助你在编码前读取项目知识。

### 使用方法

在开始编码任务前，调用技能：

\`\`\`
/use-knowledge
\`\`\`

该技能会：
1. 指导你读取 \`ai-knowledge/architecture.md\` 建立项目全局认知
2. 按需读取其他知识类型（capabilities、data-models 等）
3. 明确模块归属和包结构，避免代码放错位置

### 适用场景

- 新增业务功能时，先读取知识确定代码位置
- 修改现有代码时，先了解模块依赖关系
- 接手新项目时，快速建立全局认知
`;

    const sections: string[] = [];

    if (!existingContent.includes("use-knowledge")) {
      sections.push(skillSection);
    }

    for (const businessSubagent of config?.businessSubagents ?? []) {
      const businessSection =
        await renderClaudeBusinessAgentSection(businessSubagent);
      const heading = businessSection.split(/\r?\n/, 1)[0] ?? "";
      if (!existingContent.includes(heading)) {
        sections.push(businessSection);
      }
    }

    if (sections.length === 0) {
      return null;
    }

    // 合并内容
    const newContent = existingContent
      ? `${existingContent}\n${sections.join("\n")}`
      : `# 项目编码指南\n${sections.join("\n")}`;

    await fs.writeFile(claudeMdPath, newContent, "utf-8");
    return newContent;
  },
};
