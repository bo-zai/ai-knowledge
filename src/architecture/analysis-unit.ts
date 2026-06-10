/**
 * 分析单元划分模块
 *
 * 设计文档 04 步骤 3.5：分析单元划分
 *
 * 功能：
 * 1. 模块发现：检测 Maven 多模块、Gradle 多项目、npm workspaces 等
 * 2. 耦合度评估：6 信号检测
 * 3. 划分策略：紧耦合/松耦合决策树
 * 4. 模块拓扑分析：生成 modules.json 内容
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger.js';
import {
  type ModuleInfo,
  type ModuleTopology,
  type ModuleRole,
  type ModuleType,
  type CouplingMode,
  type AnalysisUnit,
  type AnalysisUnitResult,
  type SignalDetectionResult,
  type CouplingSignalId,
  COUPLING_SIGNALS,
  ModuleTopologySchema,
  CouplingModeSchema,
} from '../schemas/module.js';
import type { ProjectContext, ProjectType } from './project-context.js';

/**
 * 执行分析单元划分
 *
 * 从项目证据中检测模块结构、评估耦合度、确定划分策略
 */
export async function analyzeAnalysisUnits(
  repoPath: string,
  projectContext: ProjectContext,
): Promise<AnalysisUnitResult> {
  logger.info('Starting analysis unit division...');

  // 1. 模块发现
  const modules = await discoverModules(repoPath, projectContext);

  if (modules.length === 0) {
    // 单模块项目：无需划分
    logger.info('Single module project, no division needed');
    return createSingleModuleResult(repoPath);
  }

  logger.info(`Discovered ${modules.length} modules`);

  // 2. 耦合度评估
  const couplingSignals = await evaluateCouplingSignals(repoPath, modules);
  const tightCouplingScore = calculateCouplingScore(couplingSignals);

  logger.debug(`Coupling score: ${tightCouplingScore} (signals: ${couplingSignals.filter(s => s.detected).length}/6)`);

  // 3. 划分策略
  const couplingMode = decideCouplingMode(couplingSignals, modules);

  logger.info(`Coupling mode determined: ${couplingMode}`);

  // 4. 构建模块拓扑
  const moduleTopology = await buildModuleTopology(repoPath, modules, couplingMode, couplingSignals);

  // 5. 确定分析单元
  const analysisUnits = createAnalysisUnits(repoPath, moduleTopology);

  return {
    couplingMode,
    moduleTopology,
    analysisUnits,
  };
}

/**
 * 模块发现
 *
 * 根据项目类型和构建配置检测模块结构
 */
export async function discoverModules(
  repoPath: string,
  projectContext: ProjectContext,
): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  // Maven 多模块检测
  const mavenModules = await detectMavenModules(repoPath);
  if (mavenModules.length > 0) {
    modules.push(...mavenModules);
    return modules;
  }

  // Gradle 多项目检测
  const gradleModules = await detectGradleModules(repoPath);
  if (gradleModules.length > 0) {
    modules.push(...gradleModules);
    return modules;
  }

  // npm workspaces 检测
  const npmModules = await detectNpmWorkspaces(repoPath);
  if (npmModules.length > 0) {
    modules.push(...npmModules);
    return modules;
  }

  // Go modules 检测（简化：只检测 cmd/ 目录下的可部署模块）
  const goModules = await detectGoModules(repoPath);
  if (goModules.length > 0) {
    modules.push(...goModules);
    return modules;
  }

  // 从 projectContext.packages 获取（monorepo 已识别）
  if (projectContext.packages && projectContext.packages.length > 0) {
    for (const pkg of projectContext.packages) {
      modules.push({
        name: pkg.name,
        path: pkg.path,
        type: inferModuleType(pkg.type, projectContext.primaryLanguage),
        role: inferModuleRole(pkg.type),
        description: undefined,
        dependencies: [],
        usedBy: [],
      });
    }
    return modules;
  }

  return modules;
}

/**
 * Maven 多模块检测
 *
 * 解析根 pom.xml 的 <modules> 部分
 */
async function detectMavenModules(repoPath: string): Promise<ModuleInfo[]> {
  const pomPath = path.join(repoPath, 'pom.xml');

  try {
    const content = await fs.readFile(pomPath, 'utf-8');

    // 检查是否是多模块项目
    const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/);
    if (!modulesMatch) {
      return [];
    }

    // 提取模块名
    const moduleNames = modulesMatch[1]
      .match(/<module>([^<]+)<\/module>/g)
      ?.map(m => m.replace('<module>', '').replace('</module>', ''))
      ?? [];

    if (moduleNames.length === 0) {
      return [];
    }

    const modules: ModuleInfo[] = [];

    for (const moduleName of moduleNames) {
      const modulePath = path.join(repoPath, moduleName);
      const moduleInfo = await analyzeMavenModule(repoPath, moduleName, modulePath);
      if (moduleInfo) {
        modules.push(moduleInfo);
      }
    }

    // 构建依赖关系
    await buildMavenModuleDependencies(modules, repoPath);

    return modules;
  } catch {
    return [];
  }
}

/**
 * 分析单个 Maven 模块
 */
async function analyzeMavenModule(
  rootPath: string,
  moduleName: string,
  modulePath: string,
): Promise<ModuleInfo | null> {
  try {
    // 检查目录是否存在
    await fs.access(modulePath);

    // 解析模块 pom.xml
    const modulePomPath = path.join(modulePath, 'pom.xml');
    const content = await fs.readFile(modulePomPath, 'utf-8');

    // 判断是否可部署（有 Spring Boot 打包配置或主类）
    const isDeployable = await detectMavenDeployable(content, modulePath);

    // 提取包根路径
    const packageRoot = extractPackageRoot(content, modulePath);

    // 提取描述
    const descriptionMatch = content.match(/<description>([^<]*)<\/description>/);
    const description = descriptionMatch?.[1]?.trim();

    return {
      name: moduleName,
      path: moduleName + '/',
      type: 'java-maven-module',
      role: isDeployable ? 'deployable' : 'shared',
      description,
      dependencies: [],
      usedBy: [],
      entryPoint: isDeployable ? await findJavaEntryPoint(modulePath, packageRoot) : undefined,
      packageRoot,
    };
  } catch {
    return null;
  }
}

/**
 * 检测 Maven 模块是否可部署
 */
async function detectMavenDeployable(pomContent: string, modulePath: string): Promise<boolean> {
  // 检查 Spring Boot Maven Plugin
  if (pomContent.includes('spring-boot-maven-plugin')) {
    return true;
  }

  // 检查打包类型为 jar（非 pom）
  const packagingMatch = pomContent.match(/<packaging>([^<]+)<\/packaging>/);
  if (packagingMatch && packagingMatch[1] !== 'pom') {
    // 检查是否有主类
    const mainClassMatch = pomContent.match(/<mainClass>([^<]+)<\/mainClass>/);
    if (mainClassMatch) {
      return true;
    }

    // 检查是否有 Application.java
    try {
      const srcPath = path.join(modulePath, 'src/main/java');
      const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
      const hasApplicationClass = entries.some(
        e => e.isFile() && e.name.endsWith('Application.java')
      );
      if (hasApplicationClass) {
        return true;
      }
    } catch {
      // 忽略
    }
  }

  return false;
}

/**
 * 提取包根路径
 */
function extractPackageRoot(pomContent: string, modulePath: string): string | undefined {
  // 从 pom.xml 提取 groupId 作为基础
  const groupIdMatch = pomContent.match(/<groupId>([^<]+)<\/groupId>/);
  if (!groupIdMatch) {
    return undefined;
  }

  // 尝试从源码目录推断
  // 简化处理：直接使用 groupId 转换为包路径
  return groupIdMatch[1].replace(/\./g, '/');
}

/**
 * 查找 Java 入口文件
 */
async function findJavaEntryPoint(modulePath: string, packageRoot?: string): Promise<string | undefined> {
  try {
    const srcPath = path.join(modulePath, 'src/main/java');
    if (!packageRoot) {
      // 扫查找 Application.java
      const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });
      const appFile = entries.find(
        e => e.isFile() && e.name.endsWith('Application.java')
      );
      if (appFile) {
        return path.join('src/main/java', appFile.path.replace(srcPath, '').slice(1), appFile.name);
      }
    } else {
      // 在包根目录下查找
      const packagePath = path.join(srcPath, packageRoot);
      const entries = await fs.readdir(packagePath, { withFileTypes: true });
      const appFile = entries.find(
        e => e.isFile() && e.name.endsWith('Application.java')
      );
      if (appFile) {
        return path.join('src/main/java', packageRoot, appFile.name);
      }
    }
  } catch {
    // 忽略
  }

  return undefined;
}

/**
 * 构建 Maven 模块依赖关系
 */
async function buildMavenModuleDependencies(modules: ModuleInfo[], repoPath: string): Promise<void> {
  // 获取所有模块名集合
  const moduleNames = new Set(modules.map(m => m.name));

  for (const module of modules) {
    const modulePomPath = path.join(repoPath, module.path.slice(0, -1), 'pom.xml');

    try {
      const content = await fs.readFile(modulePomPath, 'utf-8');

      // 提取 dependencies 块
      const depsMatch = content.match(/<dependencies>([\s\S]*?)<\/dependencies>/);
      if (!depsMatch) {
        continue;
      }

      // 在 dependencies 块内提取 artifactId
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

  // 更新 description 字段：根据角色和依赖信息生成更有意义的描述
  for (const module of modules) {
    if (module.role === 'shared') {
      // 共享模块：说明被哪些服务使用
      if (module.usedBy.length > 0) {
        module.description = `${module.name} 模块，被 ${module.usedBy.join('、')} 依赖`;
      }
    } else if (module.role === 'deployable') {
      // 可部署模块：说明依赖哪些共享模块
      if (module.dependencies.length > 0) {
        module.description = `${module.name} 服务，依赖共享模块 ${module.dependencies.join('、')}`;
      }
    }
  }
}

/**
 * Gradle 多项目检测
 */
async function detectGradleModules(repoPath: string): Promise<ModuleInfo[]> {
  // 尝试 settings.gradle 或 settings.gradle.kts
  const settingsPaths = [
    path.join(repoPath, 'settings.gradle'),
    path.join(repoPath, 'settings.gradle.kts'),
  ];

  for (const settingsPath of settingsPaths) {
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');

      // 提取 include 语句
      const includeMatches = content.match(/include\s*['"]([^'"]+)['"]/g) ?? [];
      const projectNames = includeMatches.map(m => {
        const match = m.match(/['"]([^'"]+)['"]/);
        return match?.[1] ?? '';
      }).filter(name => name.length > 0);

      if (projectNames.length === 0) {
        continue;
      }

      const modules: ModuleInfo[] = [];

      for (const projectName of projectNames) {
        const modulePath = projectName.replace(':', '/');
        const moduleInfo: ModuleInfo = {
          name: projectName,
          path: modulePath + '/',
          type: 'java-gradle-module',
          role: 'shared', // 默认为 shared，后续可检测是否可部署
          description: undefined,
          dependencies: [],
          usedBy: [],
        };
        modules.push(moduleInfo);
      }

      return modules;
    } catch {
      continue;
    }
  }

  return [];
}

/**
 * npm workspaces 检测
 */
async function detectNpmWorkspaces(repoPath: string): Promise<ModuleInfo[]> {
  const packageJsonPath = path.join(repoPath, 'package.json');

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    if (!pkg.workspaces) {
      return [];
    }

    // workspaces 可以是数组或对象
    const workspacePatterns = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces.packages ?? [];

    const modules: ModuleInfo[] = [];

    for (const pattern of workspacePatterns) {
      // 简化处理：假设 pattern 是具体目录
      const workspacePath = path.join(repoPath, pattern);
      try {
        const wsPkgJsonPath = path.join(workspacePath, 'package.json');
        const wsContent = await fs.readFile(wsPkgJsonPath, 'utf-8');
        const wsPkg = JSON.parse(wsContent);

        modules.push({
          name: wsPkg.name ?? pattern,
          path: pattern + '/',
          type: 'npm-package',
          role: wsPkg.main || wsPkg.bin ? 'deployable' : 'shared',
          description: wsPkg.description,
          dependencies: Object.keys(wsPkg.dependencies ?? {}),
          usedBy: [],
        });
      } catch {
        // workspace 目录不存在或无 package.json
      }
    }

    return modules;
  } catch {
    return [];
  }
}

/**
 * Go modules 检测
 */
async function detectGoModules(repoPath: string): Promise<ModuleInfo[]> {
  const goModPath = path.join(repoPath, 'go.mod');

  try {
    await fs.access(goModPath);

    // 检查 cmd/ 目录下的可部署模块
    const cmdPath = path.join(repoPath, 'cmd');
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

    return modules;
  } catch {
    return [];
  }
}

/**
 * 耦合度评估
 *
 * 6 信号检测
 */
export async function evaluateCouplingSignals(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult[]> {
  const results: SignalDetectionResult[] = [];

  // 信号 1: 共享实体类
  results.push(await detectSharedEntities(repoPath, modules));

  // 信号 2: 跨模块调用
  results.push(await detectCrossModuleCalls(repoPath, modules));

  // 信号 3: 共享数据库配置
  results.push(await detectSharedDbConfig(repoPath, modules));

  // 信号 4: 跨模块事务边界
  results.push(await detectTransactionBoundary(repoPath, modules));

  // 信号 5: 相同技术栈
  results.push(await detectSameTechStack(modules));

  // 信号 6: 模块数量
  results.push({
    signal: 'module-count',
    detected: modules.length <= 10,
    evidence: `模块数量: ${modules.length}`,
  });

  return results;
}

/**
 * 检测共享实体类
 *
 * 检查是否有 shared 模块被多个 deployable 模块使用
 */
async function detectSharedEntities(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  // 找出 shared 模块
  const sharedModules = modules.filter(m => m.role === 'shared');

  if (sharedModules.length === 0) {
    return {
      signal: 'shared-entities',
      detected: false,
      evidence: '无共享模块',
    };
  }

  // 检查 shared 模块是否被多个 deployable 模块使用
  for (const shared of sharedModules) {
    if (shared.usedBy.length >= 2) {
      const deployableUsers = shared.usedBy.filter(
        name => modules.find(m => m.name === name)?.role === 'deployable'
      );
      if (deployableUsers.length >= 2) {
        return {
          signal: 'shared-entities',
          detected: true,
          evidence: `共享模块 ${shared.name} 被多个可部署服务使用: ${deployableUsers.join(', ')}`,
        };
      }
    }
  }

  // 进一步检测：实体类目录（如 mbg 生成的实体）
  for (const shared of sharedModules) {
    // 检查是否有 entity/model/domain 目录
    const entityPatterns = ['entity', 'model', 'domain', 'dto'];
    const sharedPath = path.join(repoPath, shared.path.slice(0, -1));

    try {
      // 扫描源码目录
      const srcPath = path.join(sharedPath, 'src/main/java');
      const entries = await fs.readdir(srcPath, { recursive: true, withFileTypes: true });

      const hasEntityPackage = entries.some(
        e => entityPatterns.some(p => e.path.toLowerCase().includes(p))
      );

      if (hasEntityPackage && shared.usedBy.length >= 1) {
        return {
          signal: 'shared-entities',
          detected: true,
          evidence: `共享模块 ${shared.name} 包含实体类定义`,
        };
      }
    } catch {
      // 忽略
    }
  }

  return {
    signal: 'shared-entities',
    detected: false,
    evidence: '共享模块未被多个可部署服务使用',
  };
}

/**
 * 检测跨模块调用
 *
 * 检查 deployable 模块之间是否有直接的代码调用（非 HTTP）
 */
async function detectCrossModuleCalls(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  const deployableModules = modules.filter(m => m.role === 'deployable');

  if (deployableModules.length < 2) {
    return {
      signal: 'cross-module-calls',
      detected: false,
      evidence: '只有一个可部署模块',
    };
  }

  // 检查 deployable 模块间的依赖
  for (const module of deployableModules) {
    const crossDeps = module.dependencies.filter(
      dep => deployableModules.some(m => m.name === dep)
    );

    if (crossDeps.length > 0) {
      return {
        signal: 'cross-module-calls',
        detected: true,
        evidence: `可部署模块 ${module.name} 直接依赖其他可部署模块: ${crossDeps.join(', ')}`,
      };
    }
  }

  return {
    signal: 'cross-module-calls',
    detected: false,
    evidence: '可部署模块之间无直接依赖',
  };
}

/**
 * 检测共享数据库配置
 */
async function detectSharedDbConfig(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  const deployableModules = modules.filter(m => m.role === 'deployable');

  if (deployableModules.length < 2) {
    return {
      signal: 'shared-db-config',
      detected: false,
      evidence: '只有一个可部署模块',
    };
  }

  // 检查各模块的数据库配置
  const dbConfigs: Map<string, string[]> = new Map();

  for (const module of deployableModules) {
    const modulePath = path.join(repoPath, module.path.slice(0, -1));
    const configPatterns = [
      'src/main/resources/application.yml',
      'src/main/resources/application.properties',
      'src/main/resources/application.yaml',
    ];

    for (const configPattern of configPatterns) {
      const configPath = path.join(modulePath, configPattern);
      try {
        const content = await fs.readFile(configPath, 'utf-8');

        // 提取数据库 URL（简化处理）
        const urlMatch = content.match(/(?:url|jdbcUrl)[\s:=]+['"]?([^'"\s]+)/);
        if (urlMatch) {
          const dbUrl = urlMatch[1];
          const existing = dbConfigs.get(dbUrl) ?? [];
          existing.push(module.name);
          dbConfigs.set(dbUrl, existing);
        }
      } catch {
        // 配置文件不存在
      }
    }
  }

  // 检查是否有多个模块使用相同数据库
  for (const [dbUrl, moduleNames] of dbConfigs.entries()) {
    if (moduleNames.length >= 2) {
      return {
        signal: 'shared-db-config',
        detected: true,
        evidence: `多个模块使用相同数据库: ${moduleNames.join(', ')}`,
      };
    }
  }

  return {
    signal: 'shared-db-config',
    detected: false,
    evidence: '各模块使用独立数据库配置',
  };
}

/**
 * 检测跨模块事务边界
 */
async function detectTransactionBoundary(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  // 简化检测：检查是否有分布式事务相关的依赖或配置
  const modulePomPaths = modules
    .filter(m => m.type === 'java-maven-module')
    .map(m => path.join(repoPath, m.path.slice(0, -1), 'pom.xml'));

  for (const pomPath of modulePomPaths) {
    try {
      const content = await fs.readFile(pomPath, 'utf-8');

      // 检查分布式事务相关依赖
      const txKeywords = ['seata', 'atomikos', 'bitronix', 'narayana', 'lcn-transaction'];
      if (txKeywords.some(kw => content.toLowerCase().includes(kw))) {
        return {
          signal: 'transaction-boundary',
          detected: true,
          evidence: '检测到分布式事务依赖',
        };
      }
    } catch {
      // 忽略
    }
  }

  return {
    signal: 'transaction-boundary',
    detected: false,
    evidence: '未检测到跨模块事务',
  };
}

/**
 * 检测相同技术栈
 */
async function detectSameTechStack(modules: ModuleInfo[]): Promise<SignalDetectionResult> {
  if (modules.length === 0) {
    return {
      signal: 'same-tech-stack',
      detected: false,
      evidence: '无模块',
    };
  }

  const types = modules.map(m => m.type);
  const uniqueTypes = new Set(types);

  // Java Maven 模块默认为 Spring Boot 技术栈
  const allJavaMaven = types.every(t => t === 'java-maven-module');
  if (allJavaMaven) {
    return {
      signal: 'same-tech-stack',
      detected: true,
      evidence: '所有模块均为 Java Maven (Spring Boot)',
    };
  }

  return {
    signal: 'same-tech-stack',
    detected: uniqueTypes.size === 1,
    evidence: uniqueTypes.size === 1
      ? `所有模块类型相同: ${types[0]}`
      : `模块类型多样: ${uniqueTypes.size} 种`,
  };
}

/**
 * 计算耦合度分数
 *
 * 检测到的信号越多，紧耦合的可能性越大
 */
function calculateCouplingScore(signals: SignalDetectionResult[]): number {
  const detectedCount = signals.filter(s => s.detected).length;

  // 权重：共享实体类和跨模块调用是强信号
  const strongSignals = ['shared-entities', 'cross-module-calls'];
  const strongDetected = signals.filter(
    s => s.detected && strongSignals.includes(s.signal)
  ).length;

  // 强信号权重 0.3，弱信号权重 0.1
  return strongDetected * 0.3 + (detectedCount - strongDetected) * 0.1;
}

/**
 * 划分策略决策
 *
 * 根据耦合信号和模块特征决定耦合模式
 */
export function decideCouplingMode(
  signals: SignalDetectionResult[],
  modules: ModuleInfo[],
): CouplingMode {
  // 强信号直接决定
  const sharedEntities = signals.find(s => s.signal === 'shared-entities');
  const crossCalls = signals.find(s => s.signal === 'cross-module-calls');

  // 有共享实体类或跨模块调用 → 紧耦合
  if (sharedEntities?.detected || crossCalls?.detected) {
    return 'tightly-coupled';
  }

  // 模块数量 > 10 → 松耦合
  const moduleCount = signals.find(s => s.signal === 'module-count');
  if (moduleCount && !moduleCount.detected) {
    return 'loosely-coupled';
  }

  // 检查 deployable 模块数量
  const deployableModules = modules.filter(m => m.role === 'deployable');

  // 只有一个 deployable → 紧耦合
  if (deployableModules.length <= 1) {
    return 'tightly-coupled';
  }

  // 所有 deployable 模块无共享模块依赖 → 松耦合
  const sharedModules = modules.filter(m => m.role === 'shared');
  if (sharedModules.length === 0) {
    return 'loosely-coupled';
  }

  // 默认：紧耦合（保守策略）
  return 'tightly-coupled';
}

/**
 * 构建模块拓扑
 */
async function buildModuleTopology(
  repoPath: string,
  modules: ModuleInfo[],
  couplingMode: CouplingMode,
  couplingSignals: SignalDetectionResult[],
): Promise<ModuleTopology> {
  return {
    schemaVersion: 1,
    couplingMode,
    moduleCount: modules.length,
    modules,
    analyzedAt: new Date().toISOString(),
    couplingSignals: couplingSignals.map(s => ({
      signal: s.signal,
      detected: s.detected,
      evidence: s.evidence,
    })),
  };
}

/**
 * 创建分析单元列表
 */
function createAnalysisUnits(repoPath: string, topology: ModuleTopology): AnalysisUnit[] {
  if (topology.couplingMode === 'tightly-coupled') {
    // 紧耦合：一个分析单元覆盖整个仓库
    return [{
      name: 'whole-repo',
      modules: topology.modules.map(m => m.name),
      knowledgeDir: path.join(repoPath, 'ai-knowledge'),
      isWholeRepo: true,
    }];
  }

  // 松耦合：每个 deployable 模块一个分析单元
  const deployableModules = topology.modules.filter(m => m.role === 'deployable');

  return deployableModules.map(module => ({
    name: module.name,
    modules: [module.name, ...getRequiredSharedModules(module, topology)],
    knowledgeDir: path.join(repoPath, module.path.slice(0, -1), 'ai-knowledge'),
    isWholeRepo: false,
  }));
}

/**
 * 获取模块所需的共享模块
 */
function getRequiredSharedModules(module: ModuleInfo, topology: ModuleTopology): string[] {
  const shared = topology.modules.filter(m => m.role === 'shared');
  const required: string[] = [];

  for (const sharedModule of shared) {
    if (module.dependencies.includes(sharedModule.name)) {
      required.push(sharedModule.name);
    }
  }

  return required;
}

/**
 * 创建单模块项目的分析结果
 */
function createSingleModuleResult(repoPath: string): AnalysisUnitResult {
  const topology: ModuleTopology = {
    schemaVersion: 1,
    couplingMode: 'tightly-coupled',
    moduleCount: 1,
    modules: [{
      name: 'root',
      path: '',
      type: 'other',
      role: 'deployable',
      description: undefined,
      dependencies: [],
      usedBy: [],
    }],
    analyzedAt: new Date().toISOString(),
    couplingSignals: [],
  };

  return {
    couplingMode: 'tightly-coupled',
    moduleTopology: topology,
    analysisUnits: [{
      name: 'root',
      modules: ['root'],
      knowledgeDir: path.join(repoPath, 'ai-knowledge'),
      isWholeRepo: true,
    }],
  };
}

/**
 * 推断模块类型
 */
function inferModuleType(projectType: ProjectType, language: string): ModuleType {
  if (language === 'java') {
    return 'java-maven-module';
  }
  if (language === 'typescript' || language === 'javascript') {
    return 'npm-package';
  }
  if (language === 'go') {
    return 'go-module';
  }
  if (language === 'rust') {
    return 'rust-crate';
  }
  if (language === 'python') {
    return 'python-package';
  }
  return 'other';
}

/**
 * 推断模块角色
 */
function inferModuleRole(projectType: ProjectType): ModuleRole {
  const deployableTypes: ProjectType[] = ['backend-service', 'frontend-app', 'cli-tool', 'mobile-app'];
  return deployableTypes.includes(projectType) ? 'deployable' : 'shared';
}

/**
 * 保存 modules.json
 */
export async function saveModuleTopology(
  topology: ModuleTopology,
  outputRoot: string,
): Promise<void> {
  const filePath = path.join(outputRoot, 'ai-knowledge', 'modules.json');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(topology, null, 2) + '\n', 'utf-8');

  logger.info(`Module topology saved to ${filePath}`);
}

/**
 * 读取已有的 modules.json
 */
export async function loadModuleTopology(outputRoot: string): Promise<ModuleTopology | null> {
  const filePath = path.join(outputRoot, 'ai-knowledge', 'modules.json');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return ModuleTopologySchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}