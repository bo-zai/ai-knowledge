/**
 * 完整 Partition 分析对比脚本
 *
 * 运行完整的 domain partitioning（包括 LLM 分析），对比之前的结果
 */

import { runDomainPartitioning } from "../src/partitioning/domain-partitioner.js";
import fs from "fs/promises";
import path from "path";

const repoPath =
  process.argv[2] || "D:\\workspace\\other_project\\music-education-app";
const knowledgeDir = path.join(repoPath, ".knowledge");
const partitionsDir = path.join(knowledgeDir, "partitions");

console.log(
  `\n========== Running Full Partition Analysis: ${repoPath} ==========\n`,
);

// 读取之前的 partition 结果
let previousIndex: any = null;
try {
  const indexPath = path.join(partitionsDir, "_index.json");
  const content = await fs.readFile(indexPath, "utf-8");
  previousIndex = JSON.parse(content);
  console.log("Previous partition result:");
  console.log(`  Total partitions: ${previousIndex.stats.totalPartitions}`);
  console.log(`  Entry points: ${previousIndex.stats.backendEntryPointCount}`);
  for (const p of previousIndex.partitions) {
    console.log(
      `  - ${p.partitionId}: ${p.tableCount} tables, ${p.entryPointCount} entry points`,
    );
  }
} catch (err) {
  console.log("No previous partition result found.");
}

// 运行完整分析（启用 LLM）
console.log("\nRunning full domain partitioning with LLM analysis...\n");

const result = await runDomainPartitioning({
  repoPath,
  enableLLMAnalysis: true, // 启用 LLM 语义分析
});

console.log("\n=== New Partition Result ===");
console.log(`Output path: ${result.outputPath}`);
console.log(`Total partitions: ${result.partitions.length}`);

for (const partition of result.partitions) {
  console.log(`\nPartition: ${partition.partitionId}`);
  console.log(`  Tables: ${partition.tables.length}`);
  console.log(`  EntryPoints: ${partition.entryPoints.length}`);
  console.log(
    `  Services: ${partition.sharedResources?.coreLogic?.length ?? 0}`,
  );
  console.log(
    `  Mappers: ${partition.sharedResources?.dataLayer?.length ?? 0}`,
  );
  console.log(`  Confidence: ${JSON.stringify(partition.confidenceBreakdown)}`);
  if (partition.domainKeywords) {
    console.log(`  DomainKeywords: ${partition.domainKeywords.join(", ")}`);
  }
}

// 对比差异
console.log("\n=== Comparison ===");
if (previousIndex) {
  const previousCount = previousIndex.stats.totalPartitions;
  const newCount = result.partitions.length;
  console.log(
    `Partition count: ${previousCount} → ${newCount} (Δ ${newCount - previousCount})`,
  );

  // 对比每个 partition
  const previousTables = new Map<string, number>();
  for (const p of previousIndex.partitions) {
    previousTables.set(p.anchorTable, p.tableCount);
  }

  const newTables = new Map<string, number>();
  for (const p of result.partitions) {
    const anchorTable =
      p.tables.find((t) => t.role === "primary")?.tableName ?? "unknown";
    newTables.set(anchorTable, p.tables.length);
  }

  console.log("\nTable distribution changes:");
  for (const [table, count] of newTables.entries()) {
    const prevCount = previousTables.get(table) ?? 0;
    if (prevCount !== count) {
      console.log(`  ${table}: ${prevCount} → ${count} tables`);
    }
  }
}

console.log("\n========== Analysis Complete ==========");
