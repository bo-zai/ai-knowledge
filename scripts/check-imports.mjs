import lbug from '@ladybugdb/core';
import fs from 'fs';

const dbPath = 'D:/workspace/mall-group/.knowledge/lbug';
let db;
try {
  db = new lbug.Database(dbPath, 0, false, false, 16 * 1024 * 1024 * 1024);
  const conn = new lbug.Connection(db);

  // 检查 IMPORTS 关系的目标文件类型分布
  console.log('=== IMPORTS Target File Types ===');
  const impResult = await conn.query(`
    MATCH (src)-[r:CodeRelation {type: 'IMPORTS'}]->(dst)
    RETURN dst.filePath, count(*) as cnt
    ORDER BY cnt DESC
    LIMIT 20
  `);
  const impRows = impResult.getAllSync();
  impRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]}: ${vals[1]}`);
  });

  // 检查 Java 文件之间的正确 IMPORTS
  console.log('\n=== Java -> Java IMPORTS (correct) ===');
  const javaImpResult = await conn.query(`
    MATCH (src)-[r:CodeRelation {type: 'IMPORTS'}]->(dst)
    WHERE src.filePath ENDS WITH '.java' AND dst.filePath ENDS WITH '.java'
    RETURN src.name, dst.name, src.filePath, dst.filePath
    LIMIT 10
  `);
  const javaImpRows = javaImpResult.getAllSync();
  if (javaImpRows.length === 0) {
    console.log('  (no Java -> Java IMPORTS found)');
  } else {
    javaImpRows.forEach(row => {
      const vals = Object.values(row);
      console.log(`  ${vals[2]}: ${vals[0]} -> ${vals[3]}: ${vals[1]}`);
    });
  }

  // 检查错误的 Java -> TypeScript IMPORTS
  console.log('\n=== Java -> TypeScript IMPORTS (wrong) ===');
  const wrongImpResult = await conn.query(`
    MATCH (src)-[r:CodeRelation {type: 'IMPORTS'}]->(dst)
    WHERE src.filePath ENDS WITH '.java' AND dst.filePath ENDS WITH '.ts'
    RETURN src.filePath, dst.filePath, count(*) as cnt
    ORDER BY cnt DESC
    LIMIT 10
  `);
  const wrongImpRows = wrongImpResult.getAllSync();
  wrongImpRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]} -> ${vals[1]}: ${vals[2]}`);
  });

  await conn.close();
  await db.close();
} catch (err) {
  console.error('Error:', err.message);
  if (db) await db.close().catch(() => {});
}
