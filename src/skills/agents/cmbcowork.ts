/**
 * CmbCoworkAgent
 *
 * Skill 存储位置：用户家目录的 .cmbcoworkagent/skills/ 目录
 * 所有项目共享同一个 skills 目录
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Agent,
  SkillInitConfig,
  SkillInitResult,
  SkillFile,
} from "./types.js";

export const CMBCOWORK_AGENT: Agent = {
  name: "CmbCoworkAgent",
  id: "cmbcowork",

  getSkillDir(repoPath: string): string {
    // CmbCoworkAgent 的 skills 存储在用户家目录，与 repoPath 无关
    return path.join(os.homedir(), ".cmbcoworkagent", "skills");
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
        filename: "~/.cmbcoworkagent/skills/use-knowledge.md",
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

  // CmbCoworkAgent 不生成项目级别的 AGENTS.md
  // 因为它的 skills 是全局共享的
  async generateAgentsMd(repoPath: string): Promise<string | null> {
    return null;
  },
};
