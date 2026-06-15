import lbug from '@ladybugdb/core';
import fs from 'fs';

const dbPath = 'D:/workspace/mall-group/.knowledge/lbug';
let db;
try {
  db = new lbug.Database(dbPath, 0, false, false, 16 * 1024 * 1024 * 1024);
  const conn = new lbug.Connection(db);

  // 检查 EXTENDS 关系
  console.log('=== EXTENDS Relationships ===');
  const extendsResult = await conn.query(`
    MATCH (src:Class)-[r:CodeRelation {type: 'EXTENDS'}]->(dst:Class)
    WHERE src.filePath =~ '(?i).*mall-mbg.*'
    RETURN src.name, dst.name, src.filePath, dst.filePath
    LIMIT 20
  `);
  const extendsRows = extendsResult.getAllSync();
  extendsRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]} extends ${vals[1]}`);
  });
  console.log(`  Total mall-mbg EXTENDS: ${extendsRows.length}`);

  // 检查 IMPLEMENTS 关系
  console.log('\n=== IMPLEMENTS Relationships ===');
  const implResult = await conn.query(`
    MATCH (src:Class)-[r:CodeRelation {type: 'IMPLEMENTS'}]->(dst:Interface)
    WHERE src.filePath =~ '(?i).*mall-mbg.*'
    RETURN src.name, dst.name, src.filePath, dst.filePath
    LIMIT 20
  `);
  const implRows = implResult.getAllSync();
  implRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]} implements ${vals[1]}`);
  });
  console.log(`  Total mall-mbg IMPLEMENTS: ${implRows.length}`);

  // 检查 HAS_PROPERTY 中的字段类型
  console.log('\n=== HAS_PROPERTY with Type Info ===');
  const propResult = await conn.query(`
    MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WHERE c.filePath =~ '(?i).*mall-mbg.*model.*'
    AND p.declaredType =~ '(?i).*(Oms|Pms|Ums|Sms|Cms).*'
    RETURN c.name, p.name, p.declaredType, c.filePath
    LIMIT 30
  `);
  const propRows = propResult.getAllSync();
  propRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]}.${vals[1]}: ${vals[2]}`);
  });
  console.log(`  Total entity-typed properties: ${propRows.length}`);

  // 统计所有实体类的继承关系
  console.log('\n=== All Entity Classes Inheritance ===');
  const allExtendsResult = await conn.query(`
    MATCH (src:Class)-[r:CodeRelation {type: 'EXTENDS'}]->(dst)
    WHERE src.filePath =~ '(?i).*mall-mbg.*model.*'
    RETURN src.name, dst.name, count(*) as cnt
    ORDER BY cnt DESC
    LIMIT 30
  `);
  const allExtendsRows = allExtendsResult.getAllSync();
  allExtendsRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]} -> ${vals[1]}`);
  });

  await conn.close();
  await db.close();
  console.log('\nDone');
} catch (err) {
  console.error('Error:', err.message);
  if (db) await db.close().catch(() => {});
}