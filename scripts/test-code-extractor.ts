/**
 * 测试代码提取器
 */

import { extractClassCodes } from "../src/code-extractor/index.js";

async function main() {
  const dbPath =
    process.argv[2] || "D:/workspace/other_project/joyrpc/.knowledge/lbug";

  const candidates = [
    {
      filePath: "joyrpc-core/src/main/java/io/joyrpc/Result.java",
      className: "Result",
    },
    {
      filePath: "joyrpc-spring/src/main/java/io/joyrpc/spring/ServerBean.java",
      className: "ServerBean",
    },
  ];

  console.log("测试代码提取器...");
  console.log("数据库路径:", dbPath);

  const result = await extractClassCodes(candidates, { dbPath });

  console.log("\n提取统计:");
  console.log("  成功:", result.successCount);
  console.log("  Fallback:", result.fallbackCount);
  console.log("  失败:", result.failCount);

  for (const [key, extracted] of result.results) {
    if (extracted) {
      console.log("\n=== " + key + " ===");
      console.log("类名:", extracted.className);
      console.log("行号:", extracted.startLine, "-", extracted.endLine);
      console.log("类声明:", extracted.classDeclaration.slice(0, 100));
      console.log("字段数:", extracted.fields.length);
      console.log("方法数:", extracted.methods.length);
      console.log("精简片段长度:", extracted.compactSnippet.length, "字符");
      console.log("\n精简片段预览:");
      console.log(extracted.compactSnippet.slice(0, 500));
    } else {
      console.log("\n=== " + key + " === 提取失败");
    }
  }
}

main().catch((e) => console.error("Error:", e.message));
