/**
 * 分析单元划分模块
 *
 * 设计文档 04 步骤 3.5：分析单元划分
 *
 * 功能：
 * 1. 模块发现：使用 ModuleDiscoveryCoordinator（Layer 1 + Layer 2）
 * 2. 耦合度评估：6 信号检测
 * 3. 划分策略：紧耦合/松耦合决策树
 * 4. 模块拓扑分析：生成 modules.json 内容
 */

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../shared/logger.js";
import {
  type ModuleInfo,
  type ModuleTopology,
  type ModuleRole,
  type CouplingMode,
  type AnalysisUnit,
  type AnalysisUnitResult,
  type SignalDetectionResult,
  type CouplingSignalId,
  COUPLING_SIGNALS,
  ModuleTopologySchema,
} from "../schemas/module.js";
import type { ProjectContext, ProjectType } from "./project-context.js";
import { ModuleDiscoveryCoordinator } from "./module-discovery/index.js";

/**
 * 执行分析单元划分
 *
 * 使用新的 ModuleDiscoveryCoordinator 进行模块发现，
 * 然后进行耦合度评估和划分策略决策
 */
export async function analyzeAnalysisUnits(
  repoPath: string,
  projectContext: ProjectContext,
): Promise<AnalysisUnitResult> {
  logger.info("Starting analysis unit division...");

  // 1. 模块发现（使用新的 Coordinator）
  const coordinator = new ModuleDiscoveryCoordinator();
  const discoveryResult = await coordinator.discover(repoPath, 3);

  const modules = discoveryResult.modules;

  if (modules.length === 0) {
    // 单模块项目：无需划分
    logger.info("Single module project, no division needed");
    return createSingleModuleResult(repoPath);
  }

  logger.info(
    `Discovered ${modules.length} modules, repoType=${discoveryResult.repoType}`,
  );

  // 2. 耦合度评估（增强版：结合 Coordinator 的初步评估）
  const couplingSignals = await evaluateCouplingSignals(repoPath, modules);

  // 如果 Coordinator 已经判定紧耦合（有共享实体），直接使用
  const couplingMode =
    discoveryResult.couplingMode === "tightly-coupled"
      ? "tightly-coupled"
      : decideCouplingMode(couplingSignals, modules);

  logger.info(`Coupling mode determined: ${couplingMode}`);

  // 3. 构建模块拓扑（使用 Coordinator 的结果）
  const moduleTopology = coordinator.buildTopology(discoveryResult);

  // 补充耦合信号详情
  moduleTopology.couplingSignals = couplingSignals.map((s) => ({
    signal: s.signal,
    detected: s.detected,
    evidence: s.evidence,
  }));

  // 4. 确定分析单元
  const analysisUnits = createAnalysisUnits(repoPath, moduleTopology);

  return {
    couplingMode,
    moduleTopology,
    analysisUnits,
  };
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
    signal: "module-count",
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
  const sharedModules = modules.filter((m) => m.role === "shared");

  if (sharedModules.length === 0) {
    return {
      signal: "shared-entities",
      detected: false,
      evidence: "无共享模块",
    };
  }

  // 检查 shared 模块是否被多个 deployable 模块使用
  for (const shared of sharedModules) {
    if (shared.usedBy.length >= 2) {
      const deployableUsers = shared.usedBy.filter(
        (name) => modules.find((m) => m.name === name)?.role === "deployable",
      );
      if (deployableUsers.length >= 2) {
        return {
          signal: "shared-entities",
          detected: true,
          evidence: `共享模块 ${shared.name} 被多个可部署服务使用: ${deployableUsers.join(", ")}`,
        };
      }
    }
  }

  // 进一步检测：实体类目录（如 mbg 生成的实体）
  for (const shared of sharedModules) {
    // 检查是否有 entity/model/domain 目录
    const entityPatterns = ["entity", "model", "domain", "dto"];
    const sharedPath = path.join(repoPath, shared.path.slice(0, -1));

    try {
      // 扫描源码目录
      const srcPath = path.join(sharedPath, "src/main/java");
      const entries = await fs.readdir(srcPath, {
        recursive: true,
        withFileTypes: true,
      });

      const hasEntityPackage = entries.some((e) =>
        entityPatterns.some((p) =>
          path
            .join(e.parentPath || "", e.name)
            .toLowerCase()
            .includes(p),
        ),
      );

      if (hasEntityPackage && shared.usedBy.length >= 1) {
        return {
          signal: "shared-entities",
          detected: true,
          evidence: `共享模块 ${shared.name} 包含实体类定义`,
        };
      }
    } catch {
      // 忽略
    }
  }

  return {
    signal: "shared-entities",
    detected: false,
    evidence: "共享模块未被多个可部署服务使用",
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
  const deployableModules = modules.filter((m) => m.role === "deployable");

  if (deployableModules.length < 2) {
    return {
      signal: "cross-module-calls",
      detected: false,
      evidence: "只有一个可部署模块",
    };
  }

  // 检查 deployable 模块间的依赖
  for (const module of deployableModules) {
    const crossDeps = module.dependencies.filter((dep) =>
      deployableModules.some((m) => m.name === dep),
    );

    if (crossDeps.length > 0) {
      return {
        signal: "cross-module-calls",
        detected: true,
        evidence: `可部署模块 ${module.name} 直接依赖其他可部署模块: ${crossDeps.join(", ")}`,
      };
    }
  }

  return {
    signal: "cross-module-calls",
    detected: false,
    evidence: "可部署模块之间无直接依赖",
  };
}

/**
 * 检测共享数据库配置
 */
async function detectSharedDbConfig(
  repoPath: string,
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  const deployableModules = modules.filter((m) => m.role === "deployable");

  if (deployableModules.length < 2) {
    return {
      signal: "shared-db-config",
      detected: false,
      evidence: "只有一个可部署模块",
    };
  }

  // 检查各模块的数据库配置
  const dbConfigs: Map<string, string[]> = new Map();

  for (const module of deployableModules) {
    const modulePath = path.join(repoPath, module.path.slice(0, -1));
    const configPatterns = [
      "src/main/resources/application.yml",
      "src/main/resources/application.properties",
      "src/main/resources/application.yaml",
    ];

    for (const configPattern of configPatterns) {
      const configPath = path.join(modulePath, configPattern);
      try {
        const content = await fs.readFile(configPath, "utf-8");

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
        signal: "shared-db-config",
        detected: true,
        evidence: `多个模块使用相同数据库: ${moduleNames.join(", ")}`,
      };
    }
  }

  return {
    signal: "shared-db-config",
    detected: false,
    evidence: "各模块使用独立数据库配置",
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
    .filter((m) => m.type === "java-maven-module")
    .map((m) => path.join(repoPath, m.path.slice(0, -1), "pom.xml"));

  for (const pomPath of modulePomPaths) {
    try {
      const content = await fs.readFile(pomPath, "utf-8");

      // 检查分布式事务相关依赖
      const txKeywords = [
        "seata",
        "atomikos",
        "bitronix",
        "narayana",
        "lcn-transaction",
      ];
      if (txKeywords.some((kw) => content.toLowerCase().includes(kw))) {
        return {
          signal: "transaction-boundary",
          detected: true,
          evidence: "检测到分布式事务依赖",
        };
      }
    } catch {
      // 忽略
    }
  }

  return {
    signal: "transaction-boundary",
    detected: false,
    evidence: "未检测到跨模块事务",
  };
}

/**
 * 检测相同技术栈
 */
async function detectSameTechStack(
  modules: ModuleInfo[],
): Promise<SignalDetectionResult> {
  if (modules.length === 0) {
    return {
      signal: "same-tech-stack",
      detected: false,
      evidence: "无模块",
    };
  }

  const types = modules.map((m) => m.type);
  const uniqueTypes = new Set(types);

  // Java Maven 模块默认为 Spring Boot 技术栈
  const allJavaMaven = types.every((t) => t === "java-maven-module");
  if (allJavaMaven) {
    return {
      signal: "same-tech-stack",
      detected: true,
      evidence: "所有模块均为 Java Maven (Spring Boot)",
    };
  }

  return {
    signal: "same-tech-stack",
    detected: uniqueTypes.size === 1,
    evidence:
      uniqueTypes.size === 1
        ? `所有模块类型相同: ${types[0]}`
        : `模块类型多样: ${uniqueTypes.size} 种`,
  };
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
  const sharedEntities = signals.find((s) => s.signal === "shared-entities");
  const crossCalls = signals.find((s) => s.signal === "cross-module-calls");

  // 有共享实体类或跨模块调用 → 紧耦合
  if (sharedEntities?.detected || crossCalls?.detected) {
    return "tightly-coupled";
  }

  // 模块数量 > 10 → 松耦合
  const moduleCount = signals.find((s) => s.signal === "module-count");
  if (moduleCount && !moduleCount.detected) {
    return "loosely-coupled";
  }

  // 检查 deployable 模块数量
  const deployableModules = modules.filter((m) => m.role === "deployable");

  // 只有一个 deployable → 紧耦合
  if (deployableModules.length <= 1) {
    return "tightly-coupled";
  }

  // 所有 deployable 模块无共享模块依赖 → 松耦合
  const sharedModules = modules.filter((m) => m.role === "shared");
  if (sharedModules.length === 0) {
    return "loosely-coupled";
  }

  // 默认：紧耦合（保守策略）
  return "tightly-coupled";
}

/**
 * 创建分析单元列表
 */
function createAnalysisUnits(
  repoPath: string,
  topology: ModuleTopology,
): AnalysisUnit[] {
  if (topology.couplingMode === "tightly-coupled") {
    // 紧耦合：一个分析单元覆盖整个仓库
    return [
      {
        name: "whole-repo",
        modules: topology.modules.map((m) => m.name),
        knowledgeDir: path.join(repoPath, "ai-knowledge"),
        isWholeRepo: true,
      },
    ];
  }

  // 松耦合：每个 deployable 模块一个分析单元
  const deployableModules = topology.modules.filter(
    (m) => m.role === "deployable",
  );

  return deployableModules.map((module) => ({
    name: module.name,
    modules: [module.name, ...getRequiredSharedModules(module, topology)],
    knowledgeDir: path.join(repoPath, module.path.slice(0, -1), "ai-knowledge"),
    isWholeRepo: false,
  }));
}

/**
 * 获取模块所需的共享模块
 */
function getRequiredSharedModules(
  module: ModuleInfo,
  topology: ModuleTopology,
): string[] {
  const shared = topology.modules.filter((m) => m.role === "shared");
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
    couplingMode: "tightly-coupled",
    moduleCount: 1,
    modules: [
      {
        name: "root",
        path: "",
        type: "other",
        role: "deployable",
        description: undefined,
        dependencies: [],
        usedBy: [],
      },
    ],
    analyzedAt: new Date().toISOString(),
    couplingSignals: [],
  };

  return {
    couplingMode: "tightly-coupled",
    moduleTopology: topology,
    analysisUnits: [
      {
        name: "root",
        modules: ["root"],
        knowledgeDir: path.join(repoPath, "ai-knowledge"),
        isWholeRepo: true,
      },
    ],
  };
}

/**
 * 保存 modules.json
 */
export async function saveModuleTopology(
  topology: ModuleTopology,
  outputRoot: string,
): Promise<void> {
  const filePath = path.join(outputRoot, "ai-knowledge", "modules.json");

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(topology, null, 2) + "\n",
    "utf-8",
  );

  logger.info(`Module topology saved to ${filePath}`);
}

/**
 * 读取已有的 modules.json
 */
export async function loadModuleTopology(
  outputRoot: string,
): Promise<ModuleTopology | null> {
  const filePath = path.join(outputRoot, "ai-knowledge", "modules.json");

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return ModuleTopologySchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

// 导出新的模块发现功能（供外部使用）
export { ModuleDiscoveryCoordinator } from "./module-discovery/index.js";
export type {
  ModuleDiscoveryResult,
  RepoType,
} from "./module-discovery/types.js";
