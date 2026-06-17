/**
 * Skill 模板加载器
 *
 * 从 templates 目录加载 skill 模板文件
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../shared/logger.js";

// ESM 模块中获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Skill 模板目录（相对于 skills 模块根目录） */
const TEMPLATE_DIR = path.join(__dirname, "..", "skills", "templates");

/**
 * 加载 skill 模板内容
 *
 * @param skillName skill 名称（如 'use-knowledge'）
 * @returns skill 内容（SKILL.md 文件内容）
 */
export async function loadSkillTemplate(skillName: string): Promise<string> {
  const skillPath = path.join(TEMPLATE_DIR, skillName, "SKILL.md");

  try {
    const content = await fs.readFile(skillPath, "utf-8");
    return content;
  } catch (error) {
    logger.error(`Failed to load skill template: ${skillPath}`);
    throw error;
  }
}

/**
 * 同步加载 skill 模板内容（用于初始化时）
 *
 * 注意：使用 fsSync.readFileSync 而不是 require
 */
export function loadSkillTemplateSync(skillName: string): string {
  const skillPath = path.join(TEMPLATE_DIR, skillName, "SKILL.md");

  try {
    const content = fsSync.readFileSync(skillPath, "utf-8");
    return content;
  } catch (error) {
    logger.error(`Failed to load skill template sync: ${skillPath}`);
    throw error;
  }
}

/**
 * 获取所有可用的 skill 模板名称
 */
export async function getAvailableSkillTemplates(): Promise<string[]> {
  try {
    const entries = await fs.readdir(TEMPLATE_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // 目录不存在或读取失败
    return ["use-knowledge"]; // 返回默认列表
  }
}

/**
 * 预加载所有 skill 模板到 Map
 */
export async function loadAllSkillTemplates(): Promise<Map<string, string>> {
  const templates = new Map<string, string>();
  const skillNames = await getAvailableSkillTemplates();

  for (const name of skillNames) {
    const content = await loadSkillTemplate(name);
    templates.set(name, content);
  }

  return templates;
}

/**
 * USE_KNOWLEDGE_SKILL 常量（延迟加载）
 *
 * 注意：推荐使用 loadSkillTemplate('use-knowledge') 异步加载
 * 此常量仅在第一次访问时加载
 */
let _useKnowledgeSkill: string | null = null;

export function getUseKnowledgeSkill(): string {
  if (_useKnowledgeSkill === null) {
    _useKnowledgeSkill = loadSkillTemplateSync("use-knowledge");
  }
  return _useKnowledgeSkill;
}

// 向后兼容：导出 getter 作为常量访问方式
export const USE_KNOWLEDGE_SKILL = getUseKnowledgeSkill();
