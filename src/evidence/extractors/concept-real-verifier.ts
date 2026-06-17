#!/usr/bin/env node
/**
 * 真实项目验证脚本
 * 验证 Concept 证据提取对 mall-group 和 music-education 项目的实际运行效果
 */

import { ParallelDiscoveryRunner } from "./concept/index.js";
import type { ParallelDiscoveryResult } from "./concept/types.js";

interface ProjectVerificationResult {
  project: string;
  repoPath: string;
  modulePaths: string[];
  result: ParallelDiscoveryResult | null;
  error: string | null;
  stats: {
    durationMs: number;
    tableCount: number;
    candidateCount: number;
    crossModuleCount: number;
    entryPointCount: number;
    errorCount: number;
  };
}

async function verifyProject(
  project: string,
  repoPath: string,
  modulePaths: string[],
): Promise<ProjectVerificationResult> {
  console.log(`\n=== 验证项目: ${project} ===`);
  console.log(`路径: ${repoPath}`);
  console.log(`模块: ${modulePaths.join(", ")}`);

  // 检查知识图谱是否存在
  const fs = await import("fs/promises");
  const path = await import("path");
  for (const modulePath of modulePaths) {
    const fullModulePath = path.join(repoPath, modulePath);
    const knowledgePath = path.join(fullModulePath, ".knowledge", "lbug");
    const gitnexusPath = path.join(fullModulePath, ".gitnexus", "lbug");
    const repoKnowledgePath = path.join(repoPath, ".knowledge", "lbug");

    console.log(`检查模块 ${modulePath}:`);
    try {
      await fs.access(repoKnowledgePath);
      console.log(`  项目级知识图谱存在: ${repoKnowledgePath}`);
    } catch {
      console.log(`  项目级知识图谱不存在`);
    }
  }

  const startTime = Date.now();

  try {
    const runner = new ParallelDiscoveryRunner({
      repoPath,
      modulePaths,
      language: "java",
      pathways: ["controller", "scheduled", "mq_consumer"],
      enableTableRelation: true,
      enableGitEnhancement: false,
      enableDomainDefinition: false,
    });

    const result = await runner.run();
    const durationMs = Date.now() - startTime;

    // 调试信息：检查 pathResults
    console.log(`\n--- 调试信息 ---`);
    for (const pr of result.pathResults.slice(0, 3)) {
      console.log(`  ${pr.pathway}: ${pr.tracePaths.length} paths`);
      for (const tp of pr.tracePaths.slice(0, 2)) {
        console.log(`    入口: ${tp.entryPoints[0]?.className}`);
        console.log(`    Service: ${tp.serviceChain?.length || 0}`);
        console.log(`    Mapper: ${tp.mappers?.length || 0}`);
        console.log(`    Tables: ${tp.tables?.length || 0}`);
      }
    }

    const stats = {
      durationMs,
      tableCount: result.tableAnchors.length,
      candidateCount: result.candidates.length,
      crossModuleCount: result.tableAnchors.filter((a) => a.isCrossModule)
        .length,
      entryPointCount: result.allEntryPoints.length,
      errorCount: result.errors.length,
    };

    console.log(`\n--- 验证结果 ---`);
    console.log(`耗时: ${stats.durationMs}ms`);
    console.log(`表锚点: ${stats.tableCount}`);
    console.log(`跨模块表: ${stats.crossModuleCount}`);
    console.log(`入口点: ${stats.entryPointCount}`);
    console.log(`候选数: ${stats.candidateCount}`);
    console.log(`错误数: ${stats.errorCount}`);

    if (result.tableAnchors.length > 0) {
      console.log(`\n--- 表锚点列表 ---`);
      for (const anchor of result.tableAnchors.slice(0, 5)) {
        console.log(
          `  ${anchor.tableName}: ${anchor.isCrossModule ? "跨模块" : "单模块"} (${anchor.moduleCount} 模块, 置信度 ${anchor.aggregatedConfidence.toFixed(2)})`,
        );
      }
      if (result.tableAnchors.length > 5) {
        console.log(`  ... 还有 ${result.tableAnchors.length - 5} 个表`);
      }
    }

    if (result.errors.length > 0) {
      console.log(`\n--- 错误信息 ---`);
      for (const err of result.errors.slice(0, 3)) {
        console.log(`  ${err}`);
      }
    }

    return {
      project,
      repoPath,
      modulePaths,
      result,
      error: null,
      stats,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`验证失败: ${errorMsg}`);

    return {
      project,
      repoPath,
      modulePaths,
      result: null,
      error: errorMsg,
      stats: {
        durationMs,
        tableCount: 0,
        candidateCount: 0,
        crossModuleCount: 0,
        entryPointCount: 0,
        errorCount: 1,
      },
    };
  }
}

async function main(): Promise<void> {
  console.log("========================================");
  console.log("Concept 证据提取 - 真实项目验证");
  console.log("========================================");

  const projects: { name: string; path: string; modules: string[] }[] = [
    {
      name: "mall-group",
      path: "D:/workspace/mall-group",
      modules: ["D:/workspace/mall-group"], // 使用项目根路径
    },
    {
      name: "music-education",
      path: "D:/workspace/other_project/music-education-app",
      modules: ["D:/workspace/other_project/music-education-app"], // 使用项目根路径
    },
  ];

  const results: ProjectVerificationResult[] = [];

  for (const project of projects) {
    const result = await verifyProject(
      project.name,
      project.path,
      project.modules,
    );
    results.push(result);
  }

  // 汇总报告
  console.log("\n========================================");
  console.log("验证汇总");
  console.log("========================================");

  for (const result of results) {
    const status = result.error ? "失败" : "成功";
    console.log(`${result.project}: ${status}`);
    console.log(
      `  表数: ${result.stats.tableCount}, 跨模块: ${result.stats.crossModuleCount}, 入口点: ${result.stats.entryPointCount}`,
    );
  }

  const totalSuccess = results.filter((r) => !r.error).length;
  const totalTables = results.reduce((sum, r) => sum + r.stats.tableCount, 0);
  const totalCrossModule = results.reduce(
    (sum, r) => sum + r.stats.crossModuleCount,
    0,
  );

  console.log(`\n总计: ${totalSuccess}/${results.length} 成功`);
  console.log(`发现表: ${totalTables} 个`);
  console.log(`跨模块表: ${totalCrossModule} 个`);
}

main().catch(console.error);
