/**
 * 子目录独立项目扫描器
 *
 * Layer 2: 扫描根目录下的子目录，发现独立项目
 * 解决"业务域多项目"类型的仓库识别问题
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseDetector, type DetectionOptions, type DetectionResult } from './detector-interface.js';
import type { ModuleInfo, ModuleRole, ModuleType } from '../../../schemas/module.js';

/**
 * 忽略的目录名（不扫描）
 *
 * 包括：
 * - 版本控制
 * - IDE
 * - 依赖
 * - 构建产物
 * - 生成产物
 * - 配置目录（不应被识别为独立项目）
 * - 文档目录
 * - 其他
 */
const IGNORED_DIRS = new Set([
  // 版本控制
  '.git', '.svn', '.hg', '.bzr',
  // IDE
  '.idea', '.vscode', '.vs', '.eclipse',
  // 依赖
  'node_modules', 'bower_components', 'vendor',
  // 构建产物
  'target', 'dist', 'build', 'out', 'bin',
  // 生成产物
  'ai-knowledge', '.codegraph', '.knowledge',
  // 配置目录（不应被识别为独立项目）
  'config', 'configs', 'settings', 'deploy', 'docker', 'k8s', 'helm', 'swarm',
  // 文档目录（不应被识别为独立项目）
  'docs', 'documentation', 'wiki', 'readme',
  // 其他
  'logs', 'tmp', 'temp', 'coverage', '.cache',
  // 隐藏目录
  '.claude', '.cursor', '.devagent',
]);

/**
 * 子目录项目扫描器
 *
 * 扫描根目录下所有子目录，检测是否有独立构建配置
 */
export class SubProjectScanner extends BaseDetector {
  readonly name = 'sub-project-scanner';
  readonly priority = 10;
  readonly layer = 'sub-project' as const;

  /**
   * 检查根目录是否有子目录
   *
   * 如果根目录有构建配置，由 Layer 1 处理
   * 如果根目录无构建配置但有子目录有构建配置，由 Layer 2 处理
   */
  async canDetect(repoPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(repoPath, { withFileTypes: true });
      const subDirs = entries.filter(e => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));
      return subDirs.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 扫描所有子目录，发现独立项目
   */
  async detect(repoPath: string, options?: DetectionOptions): Promise<DetectionResult> {
    try {
      const entries = await fs.readdir(repoPath, { withFileTypes: true });
      const subDirs = entries.filter(
        e => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')
      );

      const modules: ModuleInfo[] = [];
      const discoveredPaths = options?.discoveredPaths ?? new Set<string>();

      for (const dir of subDirs) {
        const subDirPath = path.join(repoPath, dir.name);

        // 去重检查
        if (discoveredPaths.has(subDirPath)) {
          continue;
        }

        // 检测子目录的构建配置
        const buildConfig = await this.detectBuildConfig(subDirPath);

        if (buildConfig) {
          discoveredPaths.add(subDirPath);

          // 如果是 Maven 多模块项目，递归探测
          if (buildConfig.type === 'java-maven-module' && buildConfig.hasSubModules) {
            const nestedModules = await this.scanMavenModules(subDirPath, discoveredPaths, options?.maxDepth ?? 3);
            modules.push(...nestedModules);
          } else {
            // 单个项目
            const moduleInfo = await this.createModuleInfo(dir.name, subDirPath, buildConfig);
            if (moduleInfo) {
              modules.push(moduleInfo);
            }
          }
        } else {
          // 无构建配置，检查是否是配置目录
          const configModule = await this.detectConfigModule(dir.name, subDirPath);
          if (configModule) {
            modules.push(configModule);
          }
        }
      }

      // 标记为 Layer 2 发现的模块
      return this.createSuccessResult(modules);
    } catch (err) {
      return this.createErrorResult((err as Error).message);
    }
  }

  /**
   * 检测子目录的构建配置
   */
  private async detectBuildConfig(dirPath: string): Promise<{ type: ModuleType; hasSubModules: boolean } | null> {
    // Maven
    const pomPath = path.join(dirPath, 'pom.xml');
    try {
      const content = await fs.readFile(pomPath, 'utf-8');
      return {
        type: 'java-maven-module',
        hasSubModules: content.includes('<modules>'),
      };
    } catch {}

    // Gradle
    const gradleSettings = path.join(dirPath, 'settings.gradle');
    const gradleKtsSettings = path.join(dirPath, 'settings.gradle.kts');
    try {
      await fs.access(gradleSettings);
      return { type: 'java-gradle-module', hasSubModules: false };
    } catch {}
    try {
      await fs.access(gradleKtsSettings);
      return { type: 'java-gradle-module', hasSubModules: false };
    } catch {}

    // npm / Node
    const packageJsonPath = path.join(dirPath, 'package.json');
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      return {
        type: 'npm-package',
        hasSubModules: !!pkg.workspaces,
      };
    } catch {}

    // Go
    const goModPath = path.join(dirPath, 'go.mod');
    try {
      await fs.access(goModPath);
      return { type: 'go-module', hasSubModules: false };
    } catch {}

    // Rust
    const cargoPath = path.join(dirPath, 'Cargo.toml');
    try {
      await fs.access(cargoPath);
      return { type: 'rust-crate', hasSubModules: false };
    } catch {}

    // Python
    const pyProjectPath = path.join(dirPath, 'pyproject.toml');
    try {
      await fs.access(pyProjectPath);
      return { type: 'python-package', hasSubModules: false };
    } catch {}

    return null;
  }

  /**
   * 扫描 Maven 多模块项目的子模块
   */
  private async scanMavenModules(
    modulePath: string,
    discoveredPaths: Set<string>,
    maxDepth: number,
  ): Promise<ModuleInfo[]> {
    const pomPath = path.join(modulePath, 'pom.xml');

    try {
      const content = await fs.readFile(pomPath, 'utf-8');
      const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);

      if (!modulesMatch) {
        // 单模块
        const moduleName = path.basename(modulePath);
        const moduleInfo = await this.createModuleInfo(moduleName, modulePath, { type: 'java-maven-module', hasSubModules: false });
        return moduleInfo ? [moduleInfo] : [];
      }

      // 提取子模块名
      const matches = modulesMatch[1].match(/<module>([^<]+)<\/module>/g);
      if (!matches) {
        return [];
      }

      const subModuleNames = matches.map(m => m.replace('<module>', '').replace('</module>', '').trim());
      const modules: ModuleInfo[] = [];

      for (const subName of subModuleNames) {
        const subPath = path.join(modulePath, subName);

        if (discoveredPaths.has(subPath)) {
          continue;
        }
        discoveredPaths.add(subPath);

        const moduleInfo = await this.createModuleInfo(subName, subPath, { type: 'java-maven-module', hasSubModules: false });
        if (moduleInfo) {
          modules.push(moduleInfo);

          // 递归探测
          if (maxDepth > 1) {
            const nested = await this.scanMavenModules(subPath, discoveredPaths, maxDepth - 1);
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
   * 创建模块信息
   */
  private async createModuleInfo(
    name: string,
    modulePath: string,
    buildConfig: { type: ModuleType; hasSubModules: boolean },
  ): Promise<ModuleInfo | null> {
    try {
      const role = await this.detectRole(name, modulePath, buildConfig);

      // 提取描述（从 package.json 或 pom.xml）
      const description = await this.extractDescription(modulePath, buildConfig.type);

      // 提取依赖
      const dependencies = await this.extractDependencies(modulePath, buildConfig.type);

      // 提取入口点
      const entryPoint = role === 'deployable'
        ? await this.findEntryPoint(modulePath, buildConfig.type)
        : undefined;

      return {
        name,
        path: name + '/',
        type: buildConfig.type,
        role,
        description,
        dependencies,
        usedBy: [],
        entryPoint,
      };
    } catch {
      return null;
    }
  }

  /**
   * 检测模块角色
   */
  private async detectRole(
    name: string,
    modulePath: string,
    buildConfig: { type: ModuleType; hasSubModules: boolean },
  ): Promise<ModuleRole> {
    // 1. 项目名暗示判断
    if (this.isDeployableByName(name)) {
      return 'deployable';
    }
    if (this.isSharedByName(name)) {
      return 'shared';
    }

    // 2. 根据构建配置判断
    if (buildConfig.type === 'npm-package') {
      try {
        const pkgPath = path.join(modulePath, 'package.json');
        const content = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);

        // 有 main 或 bin → deployable
        if (pkg.main || pkg.bin) {
          return 'deployable';
        }
      } catch {}
    }

    if (buildConfig.type === 'java-maven-module') {
      try {
        const pomPath = path.join(modulePath, 'pom.xml');
        const content = await fs.readFile(pomPath, 'utf-8');

        // Spring Boot 插件 → deployable
        if (content.includes('spring-boot-maven-plugin')) {
          return 'deployable';
        }

        // packaging = pom → shared
        const packagingMatch = content.match(/<packaging>([^<]+)<\/packaging>/);
        if (packagingMatch && packagingMatch[1] === 'pom') {
          return 'shared';
        }

        // 有 Application.java
        const srcPath = path.join(modulePath, 'src/main/java');
        const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
        const hasApp = entries.some(e => e.isFile() && e.name.includes('Application'));
        if (hasApp) {
          return 'deployable';
        }
      } catch {}
    }

    if (buildConfig.type === 'java-gradle-module') {
      try {
        const buildPath = path.join(modulePath, 'build.gradle');
        const buildKtsPath = path.join(modulePath, 'build.gradle.kts');

        // 尝试读取 build.gradle 或 build.gradle.kts
        let content: string | null = null;
        try {
          content = await fs.readFile(buildPath, 'utf-8');
        } catch {
          try {
            content = await fs.readFile(buildKtsPath, 'utf-8');
          } catch {}
        }

        if (content) {
          // Spring Boot 插件 → deployable
          if (content.includes('org.springframework.boot')) {
            return 'deployable';
          }

          // application 插件 → deployable
          if (content.includes('application')) {
            return 'deployable';
          }
        }

        // 有 Application.java
        const srcPath = path.join(modulePath, 'src/main/java');
        const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
        const hasApp = entries.some(e => e.isFile() && e.name.includes('Application'));
        if (hasApp) {
          return 'deployable';
        }
      } catch {}
    }

    // 默认：根据类型判断
    // 前端项目默认 deployable（可独立运行）
    if (buildConfig.type === 'npm-package') {
      return 'deployable';
    }

    return 'shared';
  }

  /**
   * 根据项目名判断是否可部署
   */
  private isDeployableByName(name: string): boolean {
    const patterns = [
      'admin', 'portal', 'api', 'server', 'web', 'app',
      'service', 'backend', 'frontend', 'mobile',
    ];
    return patterns.some(p => name.toLowerCase().includes(p));
  }

  /**
   * 根据项目名判断是否共享模块
   */
  private isSharedByName(name: string): boolean {
    const patterns = [
      'common', 'util', 'lib', 'core', 'shared',
      'mbg', 'model', 'dao', 'security',
      'config', 'deploy', 'docker', 'docs', 'swarm',
    ];
    return patterns.some(p => name.toLowerCase().includes(p));
  }

  /**
   * 提取描述
   */
  private async extractDescription(modulePath: string, type: ModuleType): Promise<string | undefined> {
    if (type === 'npm-package') {
      try {
        const pkgPath = path.join(modulePath, 'package.json');
        const content = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        return pkg.description;
      } catch {}
    }

    if (type === 'java-maven-module' || type === 'java-gradle-module') {
      try {
        const pomPath = path.join(modulePath, 'pom.xml');
        const content = await fs.readFile(pomPath, 'utf-8');
        const match = content.match(/<description>([^<]*)<\/description>/);
        return match?.[1]?.trim();
      } catch {}
    }

    return undefined;
  }

  /**
   * 提取 Maven 模块依赖
   *
   * 解析 pom.xml 中的 <dependencies> 提取项目内部模块依赖
   */
  private async extractDependencies(modulePath: string, type: ModuleType): Promise<string[]> {
    if (type !== 'java-maven-module') {
      return [];
    }

    try {
      const pomPath = path.join(modulePath, 'pom.xml');
      const content = await fs.readFile(pomPath, 'utf-8');

      // 提取 dependencies 中的 artifactId
      const depsMatch = content.match(/<dependencies>([\s\S]*?)<\/dependencies>/);
      if (!depsMatch) {
        return [];
      }

      // 匹配所有 <artifactId>...</artifactId>
      const artifactMatches = depsMatch[1].match(/<artifactId>([^<]+)<\/artifactId>/g);
      if (!artifactMatches) {
        return [];
      }

      return artifactMatches.map(m => m.replace('<artifactId>', '').replace('</artifactId>', '').trim());
    } catch {
      return [];
    }
  }

  /**
   * 查找入口点
   */
  private async findEntryPoint(modulePath: string, type: ModuleType): Promise<string | undefined> {
    if (type === 'npm-package') {
      try {
        const pkgPath = path.join(modulePath, 'package.json');
        const content = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        return pkg.main;
      } catch {}
    }

    if (type === 'java-maven-module') {
      try {
        const srcPath = path.join(modulePath, 'src/main/java');
        const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
        const appFile = entries.find(e => e.isFile() && e.name.includes('Application'));
        if (appFile) {
          // parentPath 是绝对路径，转换为相对于 modulePath 的相对路径
          const relativeParent = appFile.parentPath ? path.relative(srcPath, appFile.parentPath) : '';
          return path.join('src/main/java', relativeParent, appFile.name);
        }
      } catch {}
    }

    if (type === 'go-module') {
      const mainGoPath = path.join(modulePath, 'main.go');
      try {
        await fs.access(mainGoPath);
        return 'main.go';
      } catch {}

      // 检查 cmd 目录
      const cmdPath = path.join(modulePath, 'cmd');
      try {
        const entries = await fs.readdir(cmdPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const mainPath = path.join(cmdPath, entry.name, 'main.go');
            try {
              await fs.access(mainPath);
              return `cmd/${entry.name}/main.go`;
            } catch {}
          }
        }
      } catch {}
    }

    return undefined;
  }

  /**
   * 检测配置目录（无构建配置但有特殊文件）
   */
  private async detectConfigModule(name: string, dirPath: string): Promise<ModuleInfo | null> {
    // 检查是否有 docker-compose.yml / Dockerfile / k8s 配置
    const configFiles = ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'deploy', 'k8s', 'helm'];

    for (const configFile of configFiles) {
      try {
        await fs.access(path.join(dirPath, configFile));
        return {
          name,
          path: name + '/',
          type: 'other',
          role: 'shared',
          description: '部署配置目录',
          dependencies: [],
          usedBy: [],
        };
      } catch {}
    }

    // 检查目录名是否暗示配置
    const configPatterns = ['deploy', 'docker', 'swarm', 'k8s', 'helm', 'config', 'docs'];
    if (configPatterns.some(p => name.toLowerCase().includes(p))) {
      return {
        name,
        path: name + '/',
        type: 'other',
        role: 'shared',
        description: `${name} 配置目录`,
        dependencies: [],
        usedBy: [],
      };
    }

    return null;
  }
}