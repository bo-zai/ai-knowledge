/**
 * 模块拓扑写入器
 *
 * 读写 modules.json 文件
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../shared/logger.js";
import { ModuleTopologySchema } from "./types.js";
import type { ModuleTopology } from "./types.js";

/**
 * 默认知识库目录名
 */
const DEFAULT_KNOWLEDGE_DIR = "ai-knowledge";

/**
 * 模块拓扑写入器
 */
export class ModuleWriter {
  /**
   * 保存 modules.json
   *
   * @param topology 模块拓扑
   * @param outputRoot 输出根目录
   */
  async save(topology: ModuleTopology, outputRoot: string): Promise<string> {
    const outputPath = path.join(
      outputRoot,
      DEFAULT_KNOWLEDGE_DIR,
      "modules.json",
    );

    // 确保目录存在
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // 写入文件
    await fs.writeFile(
      outputPath,
      JSON.stringify(topology, null, 2) + "\n",
      "utf-8",
    );

    logger.info(`Module topology saved to ${outputPath}`);

    return outputPath;
  }

  /**
   * 加载已有的 modules.json
   *
   * @param outputRoot 输出根目录
   * @returns 模块拓扑，如果不存在则返回 null
   */
  async load(outputRoot: string): Promise<ModuleTopology | null> {
    const filePath = path.join(
      outputRoot,
      DEFAULT_KNOWLEDGE_DIR,
      "modules.json",
    );

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = ModuleTopologySchema.parse(JSON.parse(content));
      logger.info(`Loaded existing module topology from ${filePath}`);
      return parsed;
    } catch (err) {
      logger.debug(`No existing module topology at ${filePath}`);
      return null;
    }
  }

  /**
   * 检查 modules.json 是否存在
   */
  async exists(outputRoot: string): Promise<boolean> {
    const filePath = path.join(
      outputRoot,
      DEFAULT_KNOWLEDGE_DIR,
      "modules.json",
    );

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 modules.json 路径
   */
  getPath(outputRoot: string): string {
    return path.join(outputRoot, DEFAULT_KNOWLEDGE_DIR, "modules.json");
  }
}

/**
 * 创建模块写入器实例
 */
export function createModuleWriter(): ModuleWriter {
  return new ModuleWriter();
}
