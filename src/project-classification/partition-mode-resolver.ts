import type { ModuleTopology } from "../module/index.js";
import type {
  PartitionModeResolutionResult,
  ProjectTypeEvidence,
  ProjectTypeIdentificationResult,
} from "./types.js";

export function resolvePartitionMode(
  evidence: ProjectTypeEvidence,
  projectTypeResult: ProjectTypeIdentificationResult,
): PartitionModeResolutionResult {
  const deps = evidence.dependencies.join(",").toLowerCase();
  const signals = new Set(evidence.structuralSignals);
  const topLevelDirectoryCount = evidence.topLevelDirectories.length;
  const entryCandidateCount = evidence.entryCandidates.length;
  const layeredBackendScore = countSignals(signals, [
    "layered-entry",
    "layered-logic",
    "layered-data",
  ]);
  const asyncBoundaryScore = countSignals(signals, ["async-boundary-cluster"]);
  const frameworkScore =
    countSignals(signals, ["extension-cluster"]) +
    scoreDependencyMatches(deps, [
      "spring-boot-starter",
      "auto-service",
      "dubbo",
      "rocketmq",
      "rabbitmq",
    ]);

  if (
    projectTypeResult.projectType === "library" ||
    (topLevelDirectoryCount >= 6 &&
      frameworkScore >= 5 &&
      entryCandidateCount <= 1)
  ) {
    return {
      partitionMode: "capability-domain",
      confidence: 0.9,
      evidence: [
        "仓库呈现框架/能力模块结构",
        "顶层模块以 core/adapter/starter 为主",
      ],
    };
  }

  if (
    projectTypeResult.projectType === "microservices" ||
    projectTypeResult.projectType === "backend-service" ||
    layeredBackendScore + asyncBoundaryScore >= 5
  ) {
    return {
      partitionMode: "business-domain",
      confidence: 0.85,
      evidence: [
        "仓库存在明显入口层和数据访问层",
        `结构信号得分: ${layeredBackendScore + asyncBoundaryScore}`,
      ],
    };
  }

  if (frameworkScore >= 4) {
    return {
      partitionMode: "capability-domain",
      confidence: 0.7,
      evidence: [
        "能力模块和适配器信号强于业务对象信号",
        `技术模块得分: ${frameworkScore}`,
      ],
    };
  }

  if (layeredBackendScore >= 2) {
    return {
      partitionMode: "degraded-structure",
      confidence: 0.55,
      evidence: ["仓库具备结构层次，但业务对象信号不足"],
    };
  }

  return {
    partitionMode: "unsupported",
    confidence: 0.4,
    evidence: ["仓库缺少稳定的入口或能力边界信号"],
  };
}

export function refinePartitionModeWithTopology(
  current: PartitionModeResolutionResult,
  moduleTopology: ModuleTopology,
): PartitionModeResolutionResult {
  if (
    current.partitionMode === "business-domain" ||
    current.partitionMode === "capability-domain"
  ) {
    return current;
  }

  const deployableModules = moduleTopology.modules.filter(
    (module) => module.role === "deployable",
  );
  const sharedModules = moduleTopology.modules.filter(
    (module) => module.role === "shared",
  );
  const javaModuleCount = moduleTopology.modules.filter(
    (module) =>
      module.type === "java-maven-module" ||
      module.type === "java-gradle-module",
  ).length;

  if (
    moduleTopology.couplingMode === "loosely-coupled" &&
    moduleTopology.moduleCount >= 8 &&
    sharedModules.length >= deployableModules.length
  ) {
    return {
      partitionMode: "capability-domain",
      confidence: Math.max(current.confidence, 0.88),
      evidence: [
        ...current.evidence,
        "模块拓扑呈现大量共享能力模块与松耦合结构",
        `模块统计: deployable=${deployableModules.length}, shared=${sharedModules.length}`,
      ],
    };
  }

  if (
    moduleTopology.couplingMode === "tightly-coupled" &&
    deployableModules.length >= 2 &&
    javaModuleCount >= Math.max(2, Math.floor(moduleTopology.moduleCount / 2))
  ) {
    return {
      partitionMode: "business-domain",
      confidence: Math.max(current.confidence, 0.78),
      evidence: [
        ...current.evidence,
        "模块拓扑呈现多部署单元共享后端实现，适合按业务域划分",
        `模块统计: deployable=${deployableModules.length}, shared=${sharedModules.length}`,
      ],
    };
  }

  return current;
}

function countSignals(signals: Set<string>, targets: string[]): number {
  return targets.filter((target) => signals.has(target)).length;
}

function scoreDependencyMatches(
  searchText: string,
  dependencies: string[],
): number {
  return dependencies.reduce(
    (score, dependency) =>
      searchText.includes(dependency) ? score + 1 : score,
    0,
  );
}
