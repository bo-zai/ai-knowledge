import lbug from '@ladybugdb/core';
import fs from 'fs';

const dbPath = 'D:/workspace/mall-group/.knowledge/lbug';
console.log('Opening graph database:', dbPath);
console.log('File size:', fs.statSync(dbPath).size, 'bytes');

let db;
try {
  db = new lbug.Database(dbPath, 0, false, false, 16 * 1024 * 1024 * 1024);
  const conn = new lbug.Connection(db);

  // 检查关系类型和数量
  console.log('\n=== Relationship Types ===');
  const relResult = await conn.query(`
    MATCH ()-[r:CodeRelation]->()
    RETURN r.type, count(*)
    ORDER BY count(*) DESC
    LIMIT 20
  `);
  const relRows = relResult.getAllSync();
  relRows.forEach(row => {
    const type = Object.values(row)[0];
    const cnt = Object.values(row)[1];
    console.log(`  ${type}: ${cnt}`);
  });

  // 检查节点标签和数量
  console.log('\n=== Node Labels ===');
  const labelQueries = [
    { label: 'Function', query: 'MATCH (n:Function) RETURN count(n)' },
    { label: 'Method', query: 'MATCH (n:Method) RETURN count(n)' },
    { label: 'Class', query: 'MATCH (n:Class) RETURN count(n)' },
    { label: 'Interface', query: 'MATCH (n:Interface) RETURN count(n)' },
    { label: 'File', query: 'MATCH (n:File) RETURN count(n)' },
  ];

  for (const { label, query } of labelQueries) {
    try {
      const result = await conn.query(query);
      const rows = result.getAllSync();
      if (rows.length > 0) {
        const cnt = Object.values(rows[0])[0];
        console.log(`  ${label}: ${cnt}`);
      }
    } catch (err) {
      console.log(`  ${label}: error (${err.message.slice(0, 50)})`);
    }
  }

  // 检查 Java CALLS
  console.log('\n=== Java CALLS Sample ===');
  try {
    const javaResult = await conn.query(`
      MATCH (src)-[r:CodeRelation {type: 'CALLS'}]->(dst)
      WHERE src.filePath ENDS WITH '.java'
      RETURN src.name, dst.name, src.filePath
      LIMIT 10
    `);
    const javaRows = javaResult.getAllSync();
    javaRows.forEach(row => {
      const vals = Object.values(row);
      console.log(`  ${vals[2]}: ${vals[0]} -> ${vals[1]}`);
    });
    if (javaRows.length === 0) console.log('  (no CALLS edges found)');
  } catch (err) {
    console.log('  Error:', err.message.slice(0, 100));
  }

  // 检查 Java IMPORTS
  console.log('\n=== Java IMPORTS Sample ===');
  try {
    const impResult = await conn.query(`
      MATCH (src)-[r:CodeRelation {type: 'IMPORTS'}]->(dst)
      WHERE src.filePath ENDS WITH '.java'
      RETURN src.name, dst.name, src.filePath
      LIMIT 10
    `);
    const impRows = impResult.getAllSync();
    impRows.forEach(row => {
      const vals = Object.values(row);
      console.log(`  ${vals[2]}: ${vals[0]} -> ${vals[1]}`);
    });
    if (impRows.length === 0) console.log('  (no IMPORTS edges found)');
  } catch (err) {
    console.log('  Error:', err.message.slice(0, 100));
  }

  // 统计总关系数
  console.log('\n=== Total Counts ===');
  try {
    const totalRel = await conn.query('MATCH ()-[r:CodeRelation]->() RETURN count(r)');
    const totalRows = totalRel.getAllSync();
    console.log(`  Total CodeRelation edges: ${Object.values(totalRows[0])[0]}`);
  } catch (err) {
    console.log('  Error:', err.message.slice(0, 50));
  }

  await conn.close();
  await db.close();
  console.log('\nDone');
} catch (err) {
  console.error('Error:', err.message);
  if (db) await db.close().catch(() => {});
}
