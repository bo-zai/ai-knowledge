/**
 * 图谱数据验证脚本
 *
 * 验证各节点类型的属性是否正确存储：
 * - Class: id, name, filePath, startLine, endLine, content, description
 * - Method: id, name, filePath, startLine, endLine, content, description, parameterCount, returnType
 * - Property: id, name, filePath, startLine, endLine, content, description
 * - Enum: id, name, filePath, startLine, endLine, content, description
 *
 * 使用方式：
 *   npx tsx scripts/verify-graph-data.ts <db-path>
 *
 * 示例：
 *   npx tsx scripts/verify-graph-data.ts D:/workspace/other_project/music-education-app/.knowledge/lbug
 */

import lbug from "@ladybugdb/core";
import {
  closeLbugConnection,
  openLbugConnection,
} from "../src/engine/lbug/lbug-config.js";

const BACKTICK_TABLES = new Set([
  "Struct",
  "Enum",
  "Macro",
  "Typedef",
  "Union",
  "Namespace",
  "Trait",
  "Impl",
  "TypeAlias",
  "Const",
  "Static",
  "Variable",
  "Property",
  "Record",
  "Delegate",
  "Annotation",
  "Constructor",
  "Template",
  "Module",
]);

function escapeTableName(table: string): string {
  return BACKTICK_TABLES.has(table) ? `\`${table}\`` : table;
}

async function queryTable(
  conn: any,
  tableName: string,
  limit: number = 5,
): Promise<any[]> {
  const t = escapeTableName(tableName);
  try {
    const result = await conn.query(`MATCH (n:${t}) RETURN n LIMIT ${limit}`);
    const rows = await result.getAll();
    return rows.map((row) => row.n || row[0] || {});
  } catch (err: any) {
    console.log(`  ❌ Query failed: ${err.message?.slice(0, 100)}`);
    return [];
  }
}

async function countTable(conn: any, tableName: string): Promise<number> {
  const t = escapeTableName(tableName);
  try {
    const result = await conn.query(`MATCH (n:${t}) RETURN count(n) AS cnt`);
    const rows = await result.getAll();
    return Number(rows[0]?.cnt ?? rows[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

async function countRelations(conn: any, relType: string): Promise<number> {
  try {
    const result = await conn.query(
      `MATCH ()-[r:CodeRelation {type: '${relType}'}]->() RETURN count(r) AS cnt`,
    );
    const rows = await result.getAll();
    return Number(rows[0]?.cnt ?? rows[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

function validateNode(
  node: any,
  expectedProps: string[],
): { valid: boolean; missing: string[]; hasContent: boolean } {
  const missing: string[] = [];
  for (const prop of expectedProps) {
    if (node[prop] === undefined || node[prop] === null) {
      missing.push(prop);
    }
  }
  const hasContent = node.content && node.content.length > 0;
  return { valid: missing.length === 0, missing, hasContent };
}

async function verifyGraphData(dbPath: string) {
  console.log("\n========================================");
  console.log("图谱数据验证脚本");
  console.log("========================================\n");
  console.log(`数据库路径: ${dbPath}\n`);

  // 打开数据库连接
  const handle = await openLbugConnection(lbug, dbPath);
  const conn = handle.conn;

  // 1. 统计各表节点数量
  console.log("📊 节点数量统计\n");
  const tables = [
    "Class",
    "Method",
    "Property",
    "Enum",
    "Interface",
    "Function",
    "File",
  ];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    counts[table] = await countTable(conn, table);
    console.log(`  ${table}: ${counts[table]} 个节点`);
  }

  // 2. 统计关键关系数量
  console.log("\n📊 关系数量统计\n");
  const relTypes = [
    "HAS_PROPERTY",
    "HAS_METHOD",
    "EXTENDS",
    "IMPLEMENTS",
    "CONTAINS",
  ];
  for (const relType of relTypes) {
    const cnt = await countRelations(conn, relType);
    console.log(`  ${relType}: ${cnt} 条边`);
  }

  // 3. 验证 Class 节点属性
  console.log("\n📋 Class 节点验证\n");
  const classNodes = await queryTable(conn, "Class", 5);
  const classExpectedProps = [
    "id",
    "name",
    "filePath",
    "startLine",
    "endLine",
    "content",
  ];

  for (const node of classNodes) {
    const validation = validateNode(node, classExpectedProps);
    const contentPreview = node.content
      ? node.content.slice(0, 100) + "..."
      : "❌ 无内容";
    console.log(`  ${node.name || node.id}`);
    console.log(`    filePath: ${node.filePath || "❌ 缺失"}`);
    console.log(`    startLine-endLine: ${node.startLine}-${node.endLine}`);
    console.log(
      `    content: ${validation.hasContent ? `✅ ${contentPreview.length} 字符` : "❌ 无内容"}`,
    );
    if (validation.missing.length > 0) {
      console.log(`    ⚠️ 缺失属性: ${validation.missing.join(", ")}`);
    }
  }

  // 4. 验证 Method 节点属性
  console.log("\n📋 Method 节点验证\n");
  const methodNodes = await queryTable(conn, "Method", 5);
  const methodExpectedProps = [
    "id",
    "name",
    "filePath",
    "startLine",
    "endLine",
    "content",
    "parameterCount",
    "returnType",
  ];

  for (const node of methodNodes) {
    const validation = validateNode(node, methodExpectedProps);
    console.log(`  ${node.name || node.id}`);
    console.log(`    filePath: ${node.filePath || "❌ 缺失"}`);
    console.log(`    returnType: ${node.returnType || "❌ 缺失"}`);
    console.log(`    parameterCount: ${node.parameterCount ?? "❌ 缺失"}`);
    console.log(
      `    content: ${validation.hasContent ? `✅ ${node.content?.length} 字符` : "❌ 无内容"}`,
    );
    if (validation.missing.length > 0) {
      console.log(`    ⚠️ 缺失属性: ${validation.missing.join(", ")}`);
    }
  }

  // 5. 验证 Property 节点属性（字段）
  console.log("\n📋 Property 节点验证\n");
  const propertyNodes = await queryTable(conn, "Property", 5);
  const propertyExpectedProps = [
    "id",
    "name",
    "filePath",
    "startLine",
    "endLine",
    "content",
  ];

  for (const node of propertyNodes) {
    const validation = validateNode(node, propertyExpectedProps);
    const contentPreview = node.content
      ? node.content.slice(0, 80)
      : "❌ 无内容";
    console.log(`  ${node.name || node.id}`);
    console.log(`    filePath: ${node.filePath || "❌ 缺失"}`);
    console.log(`    startLine-endLine: ${node.startLine}-${node.endLine}`);
    console.log(
      `    content: ${validation.hasContent ? `✅ "${contentPreview}"` : "❌ 无内容"}`,
    );
    if (validation.missing.length > 0) {
      console.log(`    ⚠️ 缺失属性: ${validation.missing.join(", ")}`);
    }
  }

  // 6. 验证 Enum 节点属性
  console.log("\n📋 Enum 节点验证\n");
  const enumNodes = await queryTable(conn, "Enum", 5);
  const enumExpectedProps = [
    "id",
    "name",
    "filePath",
    "startLine",
    "endLine",
    "content",
  ];

  for (const node of enumNodes) {
    const validation = validateNode(node, enumExpectedProps);
    console.log(`  ${node.name || node.id}`);
    console.log(`    filePath: ${node.filePath || "❌ 缺失"}`);
    console.log(
      `    content: ${validation.hasContent ? `✅ ${node.content?.length} 字符` : "❌ 无内容"}`,
    );
    if (validation.missing.length > 0) {
      console.log(`    ⚠️ 缺失属性: ${validation.missing.join(", ")}`);
    }
  }

  // 7. 验证 HAS_PROPERTY 关系
  console.log("\n📋 HAS_PROPERTY 关系验证\n");
  try {
    const result = await conn.query(`
      MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:\`Property\`)
      RETURN c.name AS className, p.name AS propName, p.content AS propContent
      LIMIT 5
    `);
    const rows = await result.getAll();

    if (rows.length === 0) {
      console.log("  ⚠️ 没有找到 HAS_PROPERTY 关系");
    } else {
      for (const row of rows) {
        const className = row.className ?? row[0];
        const propName = row.propName ?? row[1];
        const propContent = row.propContent ?? row[2];
        console.log(`  ${className} -> ${propName}`);
        console.log(
          `    content: ${propContent ? `✅ ${propContent.slice(0, 60)}...` : "❌ 无内容"}`,
        );
      }
    }
  } catch (err: any) {
    console.log(`  ❌ 查询失败: ${err.message?.slice(0, 100)}`);
  }

  // 8. 验证 HAS_METHOD 关系
  console.log("\n📋 HAS_METHOD 关系验证\n");
  try {
    const result = await conn.query(`
      MATCH (c:Class)-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
      RETURN c.name AS className, m.name AS methodName, m.returnType AS returnType, m.parameterCount AS params
      LIMIT 5
    `);
    const rows = await result.getAll();

    if (rows.length === 0) {
      console.log("  ⚠️ 没有找到 HAS_METHOD 关系");
    } else {
      for (const row of rows) {
        const className = row.className ?? row[0];
        const methodName = row.methodName ?? row[1];
        const returnType = row.returnType ?? row[2];
        const params = row.params ?? row[3];
        console.log(`  ${className} -> ${methodName}(${params} params)`);
        console.log(`    returnType: ${returnType || "❌ 缺失"}`);
      }
    }
  } catch (err: any) {
    console.log(`  ❌ 查询失败: ${err.message?.slice(0, 100)}`);
  }

  // 9. 统计有 content 和无 content 的节点比例
  console.log("\n📊 Content 字段统计\n");
  for (const table of ["Class", "Method", "Property"]) {
    const t = escapeTableName(table);
    try {
      const withContentResult = await conn.query(
        `MATCH (n:${t}) WHERE n.content IS NOT NULL AND n.content <> '' RETURN count(n) AS cnt`,
      );
      const withoutContentResult = await conn.query(
        `MATCH (n:${t}) WHERE n.content IS NULL OR n.content = '' RETURN count(n) AS cnt`,
      );
      const withContent = Number(
        (await withContentResult.getAll())[0]?.cnt ?? 0,
      );
      const withoutContent = Number(
        (await withoutContentResult.getAll())[0]?.cnt ?? 0,
      );
      const total = withContent + withoutContent;
      const ratio = total > 0 ? ((withContent / total) * 100).toFixed(1) : "0";
      console.log(`  ${table}: ${withContent}/${total} 有 content (${ratio}%)`);
    } catch {
      console.log(`  ${table}: ❌ 查询失败`);
    }
  }

  // 关闭连接
  await closeLbugConnection(handle);

  console.log("\n========================================");
  console.log("验证完成");
  console.log("========================================\n");
}

// 主入口
const dbPath = process.argv[2] || process.argv[3];

if (!dbPath) {
  console.log("用法: npx tsx scripts/verify-graph-data.ts <db-path>");
  console.log(
    "示例: npx tsx scripts/verify-graph-data.ts D:/workspace/other_project/music-education-app/.knowledge/lbug",
  );
  process.exit(1);
}

verifyGraphData(dbPath).catch((err) => {
  console.error("执行失败:", err.message);
  process.exit(1);
});
