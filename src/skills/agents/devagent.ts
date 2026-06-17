/**
 * DevAgent
 *
 * Skill 存储位置：项目根目录的 .devagent/skills/ 目录
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  Agent,
  SkillInitConfig,
  SkillInitResult,
  SkillFile,
} from "./types.js";

export const DEVAGENT_AGENT: Agent = {
  name: "DevAgent",
  id: "devagent",

  getSkillDir(repoPath: string): string {
    return path.join(repoPath, ".devagent", "skills");
  },

  async isInitialized(repoPath: string): Promise<boolean> {
    const skillDir = this.getSkillDir(repoPath);
    const useKnowledgePath = path.join(skillDir, "use-knowledge.md");

    try {
      await fs.access(useKnowledgePath);
      return true;
    } catch {
      return false;
    }
  },

  async initialize(config: SkillInitConfig): Promise<SkillInitResult> {
    const skillDir = this.getSkillDir(config.repoPath);
    const files: SkillFile[] = [];

    try {
      await fs.mkdir(skillDir, { recursive: true });

      const { USE_KNOWLEDGE_SKILL } = await import("../skill-templates.js");
      await fs.writeFile(
        path.join(skillDir, "use-knowledge.md"),
        USE_KNOWLEDGE_SKILL,
        "utf-8",
      );
      files.push({
        name: "use-knowledge",
        filename: ".devagent/skills/use-knowledge.md",
        content: USE_KNOWLEDGE_SKILL,
      });

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

  async generateAgentsMd(repoPath: string): Promise<string | null> {
    const agentsMdPath = path.join(repoPath, "AGENTS.md");
    let existingContent = "";

    try {
      existingContent = await fs.readFile(agentsMdPath, "utf-8");
    } catch {
      // 文件不存在
    }

    const skillSection = `
## 知识库技能

本项目已配置 \`use-knowledge\` 技能。

### 使用方法

在 DevAgent 中加载技能：
\`\`\`
load_skill use-knowledge
\`\`\`
`;

    if (existingContent.includes("use-knowledge")) {
      return null;
    }

    const newContent = existingContent
      ? `${existingContent}\n${skillSection}`
      : `# 项目编码指南\n${skillSection}`;

    await fs.writeFile(agentsMdPath, newContent, "utf-8");
    return newContent;
  },
};
