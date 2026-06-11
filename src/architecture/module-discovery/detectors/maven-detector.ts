/**
 * Maven 模块探测器
 *
 * Layer 1: 检测根 pom.xml 的 <modules> 声明
 * 支持递归探测嵌套多模块
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseDetector, type DetectionOptions, type DetectionResult } from './detector-interface.js';
import type { ModuleInfo, ModuleRole, ModuleType } from '../../../schemas/module.js';

/**
 * Maven 根目录探测器
 *
 * 检测根 pom.xml 是否声明了多模块
 */
export class MavenRootDetector extends BaseDetector {
  readonly name = 'maven-root';
  readonly priority = 1;
  readonly layer = 'root-build-system' as const;

  /**
   * 检查根目录是否有 pom.xml 且包含 <modules>
   */
  async canDetect(repoPath: string): Promise<boolean> {
    const pomPath = path.join(repoPath, 'pom.xml');

    try {
      const content = await fs.readFile(pomPath, 'utf-8');
      // 检查是否有 <modules> 块
      return content.includes('<modules>');
    } catch {
      return false;
    }
  }

  /**
   * 解析根 pom.xml，提取模块列表
   */
  async detect(repoPath: string, options?: DetectionOptions): Promise<DetectionResult> {
    const pomPath = path.join(repoPath, 'pom.xml');

    try {
      const content = await fs.readFile(pomPath, 'utf-8');

      // 检查是否是多模块项目
      const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);
      if (!modulesMatch) {
        return this.createEmptyResult();
      }

      // 提取模块名
      const moduleNames = this.extractModuleNames(modulesMatch[1]);
      if (moduleNames.length === 0) {
        return this.createEmptyResult();
      }

      const modules: ModuleInfo[] = [];
      const discoveredPaths = options?.discoveredPaths ?? new Set<string>();

      for (const moduleName of moduleNames) {
        const modulePath = path.join(repoPath, moduleName);

        // 去重检查
        if (discoveredPaths.has(modulePath)) {
          continue;
        }
        discoveredPaths.add(modulePath);

        // 分析单个模块
        const moduleInfo = await this.analyzeModule(repoPath, moduleName, modulePath, content);
        if (moduleInfo) {
          modules.push(moduleInfo);

          // 递归探测嵌套模块（如果模块本身是聚合模块）
          if (options?.maxDepth && options.maxDepth > 1) {
            const nestedModules = await this.detectNestedModules(modulePath, discoveredPaths, options.maxDepth - 1);
            modules.push(...nestedModules);
          }
        }
      }

      // 构建依赖关系
      await this.buildDependencies(modules, repoPath);

      return this.createSuccessResult(modules);
    } catch (err) {
      return this.createErrorResult((err as Error).message);
    }
  }

  /**
   * 提取模块名列表
   */
  private extractModuleNames(modulesBlock: string): string[] {
    const matches = modulesBlock.match(/<module>([^<]+)<\/module>/g);
    if (!matches) {
      return [];
    }

    return matches
      .map(m => m.replace('<module>', '').replace('</module>', '').trim())
      .filter(name => name.length > 0);
  }

  /**
   * 分析单个 Maven 模块
   */
  private async analyzeModule(
    rootPath: string,
    moduleName: string,
    modulePath: string,
    rootPomContent: string,
  ): Promise<ModuleInfo | null> {
    try {
      await fs.access(modulePath);

      // 解析模块 pom.xml
      const modulePomPath = path.join(modulePath, 'pom.xml');
      const content = await fs.readFile(modulePomPath, 'utf-8');

      // 判断角色
      const role = await this.detectRole(content, modulePath);

      // 判断是否是聚合模块（有子模块）
      const isAggregator = content.includes('<modules>');

      // 提取描述
      const descriptionMatch = content.match(/<description>([^<]*)<\/description>/);
      const description = descriptionMatch?.[1]?.trim();

      // 提取包根路径
      const packageRoot = this.extractPackageRoot(content);

      // 提取入口文件
      const entryPoint = role === 'deployable' && !isAggregator
        ? await this.findEntryPoint(modulePath, packageRoot)
        : undefined;

      return {
        name: moduleName,
        path: moduleName + '/',
        type: 'java-maven-module',
        role: isAggregator ? 'shared' : role, // 聚合模块标记为 shared
        description,
        dependencies: [],
        usedBy: [],
        entryPoint,
        packageRoot,
      };
    } catch {
      return null;
    }
  }

  /**
   * 检测模块角色
   */
  private async detectRole(pomContent: string, modulePath: string): Promise<ModuleRole> {
    // 1. Spring Boot 插件 → deployable
    if (pomContent.includes('spring-boot-maven-plugin')) {
      return 'deployable';
    }

    // 2. 打包类型为 pom → shared（聚合模块）
    const packagingMatch = pomContent.match(/<packaging>([^<]+)<\/packaging>/);
    if (packagingMatch && packagingMatch[1] === 'pom') {
      return 'shared';
    }

    // 3. 有主类配置 → deployable
    if (pomContent.includes('<mainClass>')) {
      return 'deployable';
    }

    // 4. 有 Application.java → deployable
    try {
      const srcPath = path.join(modulePath, 'src/main/java');
      const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
      const hasApplication = entries.some(
        e => e.isFile() && (e.name.endsWith('Application.java') || e.name.includes('App.java'))
      );
      if (hasApplication) {
        return 'deployable';
      }
    } catch {
      // 无源码目录
    }

    // 5. 项目名暗示判断
    const artifactIdMatch = pomContent.match(/<artifactId>([^<]+)<\/artifactId>/);
    if (artifactIdMatch) {
      const artifactId = artifactIdMatch[1];
      if (this.isDeployableByName(artifactId)) {
        return 'deployable';
      }
      if (this.isSharedByName(artifactId)) {
        return 'shared';
      }
    }

    // 默认：shared（库模块）
    return 'shared';
  }

  /**
   * 根据项目名判断是否可部署
   */
  private isDeployableByName(name: string): boolean {
    const deployablePatterns = ['admin', 'portal', 'api', 'server', 'web', 'app', 'service', 'backend', 'frontend'];
    return deployablePatterns.some(p => name.toLowerCase().includes(p));
  }

  /**
   * 根据项目名判断是否共享模块
   */
  private isSharedByName(name: string): boolean {
    const sharedPatterns = ['common', 'util', 'lib', 'core', 'shared', 'mbg', 'model', 'dao', 'security'];
    return sharedPatterns.some(p => name.toLowerCase().includes(p));
  }

  /**
   * 提取包根路径
   */
  private extractPackageRoot(pomContent: string): string | undefined {
    const groupIdMatch = pomContent.match(/<groupId>([^<]+)<\/groupId>/);
    if (!groupIdMatch) {
      return undefined;
    }
    return groupIdMatch[1].replace(/\./g, '/');
  }

  /**
   * 查找入口文件
   */
  private async findEntryPoint(modulePath: string, packageRoot?: string): Promise<string | undefined> {
    try {
      const srcPath = path.join(modulePath, 'src/main/java');

      if (packageRoot) {
        // 在包根目录下查找
        const packagePath = path.join(srcPath, packageRoot);
        const entries = await fs.readdir(packagePath, { withFileTypes: true });
        const appFile = entries.find(
          e => e.isFile() && (e.name.endsWith('Application.java') || e.name.includes('App.java'))
        );
        if (appFile) {
          return path.join('src/main/java', packageRoot, appFile.name);
        }
      }

      // 递归查找
      const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
      const appFile = entries.find(
        e => e.isFile() && (e.name.endsWith('Application.java') || e.name.includes('App.java'))
      );
      if (appFile) {
        // parentPath 是绝对路径，转换为相对路径
        const relativeParent = appFile.parentPath ? path.relative(srcPath, appFile.parentPath) : '';
        return path.join('src/main/java', relativeParent, appFile.name);
      }
    } catch {
      // 无源码目录
    }

    return undefined;
  }

  /**
   * 递归探测嵌套模块
   */
  private async detectNestedModules(
    modulePath: string,
    discoveredPaths: Set<string>,
    maxDepth: number,
  ): Promise<ModuleInfo[]> {
    const pomPath = path.join(modulePath, 'pom.xml');

    try {
      const content = await fs.readFile(pomPath, 'utf-8');

      // 检查是否有子模块
      const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);
      if (!modulesMatch) {
        return [];
      }

      const moduleNames = this.extractModuleNames(modulesMatch[1]);
      const modules: ModuleInfo[] = [];

      for (const moduleName of moduleNames) {
        const subModulePath = path.join(modulePath, moduleName);

        if (discoveredPaths.has(subModulePath)) {
          continue;
        }
        discoveredPaths.add(subModulePath);

        const moduleInfo = await this.analyzeModule(modulePath, moduleName, subModulePath, content);
        if (moduleInfo) {
          modules.push(moduleInfo);

          // 继续递归
          if (maxDepth > 1) {
            const nested = await this.detectNestedModules(subModulePath, discoveredPaths, maxDepth - 1);
            modules.push(...nested);
          }
        }
      }

      return modules;
    } catch {
      return [];
    }
  }

  /**
   * 构建模块依赖关系
   */
  private async buildDependencies(modules: ModuleInfo[], repoPath: string): Promise<void> {
    const moduleNames = new Set(modules.map(m => m.name));

    for (const module of modules) {
      const modulePomPath = path.join(repoPath, module.path.slice(0, -1), 'pom.xml');

      try {
        const content = await fs.readFile(modulePomPath, 'utf-8');
        const depsMatch = content.match(/<dependencies>([\s\S]*?)<\/dependencies>/);

        if (!depsMatch) {
          continue;
        }

        // 提取依赖的 artifactId
        const artifactIdMatches = depsMatch[1].match(/<artifactId>([^<]+)<\/artifactId>/g) ?? [];
        const deps = artifactIdMatches
          .map(m => m.replace('<artifactId>', '').replace('</artifactId>', ''))
          .filter(dep => moduleNames.has(dep) && dep !== module.name);

        module.dependencies = deps;

        // 更新被依赖关系
        for (const dep of deps) {
          const depModule = modules.find(m => m.name === dep);
          if (depModule && !depModule.usedBy.includes(module.name)) {
            depModule.usedBy.push(module.name);
          }
        }
      } catch {
        // 忽略
      }
    }
  }
}