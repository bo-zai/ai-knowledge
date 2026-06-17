import lbug from '@ladybugdb/core';

const dbPath = 'D:/workspace/mall-group/.knowledge/lbug';
let db;
try {
  db = new lbug.Database(dbPath, 0, false, false, 16 * 1024 * 1024 * 1024);
  const conn = new lbug.Connection(db);

  // 查询 mall-mbg 模块的实体类（这些是 MyBatis 生成的实体）
  console.log('=== Entity Classes in mall-mbg (Pms/Oms/Ums/Sms/Cms) ===');
  const mbgResult = await conn.query(`
    MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WHERE c.filePath =~ '(?i).*mall-mbg.*model.*'
    AND NOT c.filePath =~ '(?i).*(test|example).*'
    RETURN c.name as entityName, c.filePath as filePath, count(p) as fieldCount
    ORDER BY fieldCount DESC
    LIMIT 30
  `);
  const mbgRows = mbgResult.getAllSync();
  mbgRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]} (${vals[2]} fields)`);
  });

  // 查询 Class 的数量分布（按文件路径前缀）
  console.log('\n=== Class Distribution by Module ===');
  const distResult = await conn.query(`
    MATCH (c:Class)
    WHERE NOT c.filePath =~ '(?i).*(test|spec).*'
    RETURN
      CASE
        WHEN c.filePath =~ '(?i).*mall-mbg.*' THEN 'mall-mbg'
        WHEN c.filePath =~ '(?i).*mall-common.*' THEN 'mall-common'
        WHEN c.filePath =~ '(?i).*mall-admin.*' THEN 'mall-admin'
        WHEN c.filePath =~ '(?i).*mall-portal.*' THEN 'mall-portal'
        WHEN c.filePath =~ '(?i).*mall-search.*' THEN 'mall-search'
        ELSE 'other'
      END as module,
      count(c) as cnt
    ORDER BY cnt DESC
  `);
  const distRows = distResult.getAllSync();
  distRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]}: ${vals[1]} classes`);
  });

  // 查询 HAS_PROPERTY 关系的来源
  console.log('\n=== HAS_PROPERTY Source Distribution ===');
  const hpSrcResult = await conn.query(`
    MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->()
    WHERE NOT c.filePath =~ '(?i).*(test|spec).*'
    RETURN
      CASE
        WHEN c.filePath =~ '(?i).*mall-mbg.*' THEN 'mall-mbg'
        WHEN c.filePath =~ '(?i).*mall-common.*' THEN 'mall-common'
        WHEN c.filePath =~ '(?i).*mall-admin.*' THEN 'mall-admin'
        WHEN c.filePath =~ '(?i).*mall-portal.*' THEN 'mall-portal'
        WHEN c.filePath =~ '(?i).*mall-search.*' THEN 'mall-search'
        ELSE 'other'
      END as module,
      count(r) as cnt
    ORDER BY cnt DESC
  `);
  const hpSrcRows = hpSrcResult.getAllSync();
  hpSrcRows.forEach(row => {
    const vals = Object.values(row);
    console.log(`  ${vals[0]}: ${vals[1]} HAS_PROPERTY edges`);
  });

  await conn.close();
  await db.close();
} catch (err) {
  console.error('Error:', err.message);
  if (db) await db.close().catch(() => {});
}
