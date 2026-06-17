/**
 * npm workspaces 探测器
 *
 * Layer 1: 检测根 package.json
 * - 有 workspaces → 多模块项目
 * - 无 workspaces → 单项目
 */

import fs from "node:fs/promises";
import path from "node:path";
import { BaseDetector, type DetectionResult } from "./detector-interface.js";
import type { ModuleInfo, ModuleRole } from "../../../schemas/module.js";

export class NpmRootDetector extends BaseDetector {
  readonly name = "npm-root";
  readonly priority = 3;
  readonly layer = "root-build-system" as const;

  async canDetect(repoPath: string): Promise<boolean> {
    const packageJsonPath = path.join(repoPath, "package.json");

    try {
      await fs.access(packageJsonPath);
      return true;
    } catch {
      return false;
    }
  }

  async detect(repoPath: string): Promise<DetectionResult> {
    const packageJsonPath = path.join(repoPath, "package.json");

    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      // 无 workspaces → 单项目
      if (!pkg.workspaces) {
        return this.createSuccessResult([
          {
            name: pkg.name ?? "root",
            path: "",
            type: "npm-package",
            role: "deployable",
            description: pkg.description,
            dependencies: Object.keys(pkg.dependencies ?? {}),
            usedBy: [],
            entryPoint: pkg.main,
          },
        ]);
      }

      // workspaces 可以是数组或对象
      const workspacePatterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces.packages ?? []);

      const modules: ModuleInfo[] = [];

      for (const pattern of workspacePatterns) {
        // 简化处理：假设 pattern 是具体目录
        const workspacePath = path.join(repoPath, pattern);

        try {
          const wsPkgPath = path.join(workspacePath, "package.json");
          const wsContent = await fs.readFile(wsPkgPath, "utf-8");
          const wsPkg = JSON.parse(wsContent);

          modules.push({
            name: wsPkg.name ?? pattern,
            path: pattern + "/",
            type: "npm-package",
            role: wsPkg.main || wsPkg.bin ? "deployable" : "shared",
            description: wsPkg.description,
            dependencies: Object.keys(wsPkg.dependencies ?? {}),
            usedBy: [],
            entryPoint: wsPkg.main,
          });
        } catch {
          // workspace 目录不存在或无 package.json
        }
      }

      return this.createSuccessResult(modules);
    } catch (err) {
      return this.createErrorResult((err as Error).message);
    }
  }
}
