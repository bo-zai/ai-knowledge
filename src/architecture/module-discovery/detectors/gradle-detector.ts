/**
 * Gradle 项目探测器
 *
 * Layer 1: 检测根 settings.gradle 的 include 声明
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseDetector, type DetectionResult } from './detector-interface.js';
import type { ModuleInfo, ModuleRole } from '../../../schemas/module.js';

export class GradleRootDetector extends BaseDetector {
  readonly name = 'gradle-root';
  readonly priority = 2;
  readonly layer = 'root-build-system' as const;

  async canDetect(repoPath: string): Promise<boolean> {
    const settingsGradle = path.join(repoPath, 'settings.gradle');
    const settingsKts = path.join(repoPath, 'settings.gradle.kts');

    try {
      await fs.access(settingsGradle);
      return true;
    } catch {}

    try {
      await fs.access(settingsKts);
      return true;
    } catch {}

    return false;
  }

  async detect(repoPath: string): Promise<DetectionResult> {
    const settingsPaths = [
      path.join(repoPath, 'settings.gradle'),
      path.join(repoPath, 'settings.gradle.kts'),
    ];

    for (const settingsPath of settingsPaths) {
      try {
        const content = await fs.readFile(settingsPath, 'utf-8');

        // 提取 include 语句
        const includeMatches = content.match(/include\s*['"]([^'"]+)['"]/g);

        // 无 include 语句 → 单项目
        if (!includeMatches || includeMatches.length === 0) {
          return this.createSuccessResult([{
            name: 'root',
            path: '',
            type: 'java-gradle-module',
            role: await this.detectRootRole(repoPath),
            description: undefined,
            dependencies: [],
            usedBy: [],
          }]);
        }

        const projectNames = includeMatches
          .map(m => {
            const match = m.match(/['"]([^'"]+)['"]/);
            return match?.[1] ?? '';
          })
          .filter(name => name.length > 0);

        const modules: ModuleInfo[] = [];

        for (const projectName of projectNames) {
          const modulePath = projectName.replace(':', '/');

          modules.push({
            name: projectName,
            path: modulePath + '/',
            type: 'java-gradle-module',
            role: await this.detectRole(repoPath, modulePath),
            description: undefined,
            dependencies: [],
            usedBy: [],
          });
        }

        return this.createSuccessResult(modules);
      } catch {}
    }

    return this.createEmptyResult();
  }

  private async detectRootRole(repoPath: string): Promise<ModuleRole> {
    const buildPaths = [
      path.join(repoPath, 'build.gradle'),
      path.join(repoPath, 'build.gradle.kts'),
    ];

    for (const buildPath of buildPaths) {
      try {
        const content = await fs.readFile(buildPath, 'utf-8');

        // Spring Boot 插件 → deployable
        if (content.includes('org.springframework.boot')) {
          return 'deployable';
        }

        // application 插件 → deployable
        if (content.includes('application')) {
          return 'deployable';
        }
      } catch {}
    }

    return 'deployable';  // Gradle 项目默认可部署
  }

  private async detectRole(repoPath: string, modulePath: string): Promise<ModuleRole> {
    // 简化判断：检查是否有 build.gradle
    const buildPath = path.join(repoPath, modulePath, 'build.gradle');
    try {
      const content = await fs.readFile(buildPath, 'utf-8');

      // Spring Boot 插件
      if (content.includes('org.springframework.boot')) {
        return 'deployable';
      }

      // application 插件
      if (content.includes('application')) {
        return 'deployable';
      }
    } catch {}

    // 项目名判断
    const name = path.basename(modulePath);
    const deployablePatterns = ['admin', 'portal', 'api', 'server', 'web', 'app', 'service'];
    if (deployablePatterns.some(p => name.toLowerCase().includes(p))) {
      return 'deployable';
    }

    return 'shared';
  }
}