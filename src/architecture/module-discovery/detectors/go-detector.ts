/**
 * Go modules 探测器
 *
 * Layer 1: 检测 cmd/ 目录下的可部署模块
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseDetector, type DetectionResult } from './detector-interface.js';
import type { ModuleInfo } from '../../../schemas/module.js';

export class GoRootDetector extends BaseDetector {
  readonly name = 'go-root';
  readonly priority = 4;
  readonly layer = 'root-build-system' as const;

  async canDetect(repoPath: string): Promise<boolean> {
    const goModPath = path.join(repoPath, 'go.mod');
    const cmdPath = path.join(repoPath, 'cmd');

    try {
      await fs.access(goModPath);
      await fs.access(cmdPath);
      return true;
    } catch {
      return false;
    }
  }

  async detect(repoPath: string): Promise<DetectionResult> {
    const cmdPath = path.join(repoPath, 'cmd');

    try {
      const entries = await fs.readdir(cmdPath, { withFileTypes: true });
      const modules: ModuleInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mainGoPath = path.join(cmdPath, entry.name, 'main.go');

          try {
            await fs.access(mainGoPath);

            modules.push({
              name: entry.name,
              path: `cmd/${entry.name}/`,
              type: 'go-module',
              role: 'deployable',
              description: undefined,
              dependencies: [],
              usedBy: [],
              entryPoint: `cmd/${entry.name}/main.go`,
            });
          } catch {
            // 无 main.go
          }
        }
      }

      return this.createSuccessResult(modules);
    } catch (err) {
      return this.createErrorResult((err as Error).message);
    }
  }
}