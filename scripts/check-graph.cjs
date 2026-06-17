const Database = require('better-sqlite3');
const path = require('path');

const dbPath = '/d/workspace/mall-group/.knowledge/lbug';
console.log('Opening graph database:', dbPath);
console.log('File size:', require('fs').statSync(dbPath).size, 'bytes');

try {
  const db = new Database(dbPath);

  // 统计边类型
  console.log('\n=== Edge Types ===');
  const edges = db.prepare(`
    SELECT type, COUNT(*) as cnt
    FROM relationships
    GROUP BY type
    ORDER BY cnt DESC
  `).all();
  edges.forEach(r => console.log(`  ${r.type}: ${r.cnt}`));

  // 统计节点类型
  console.log('\n=== Node Types ===');
  const nodes = db.prepare(`
    SELECT label, COUNT(*) as cnt
    FROM nodes
    GROUP BY label
    ORDER BY cnt DESC
  `).all();
  nodes.forEach(r => console.log(`  ${r.label}: ${r.cnt}`));

  // 检查 Java CALLS
  console.log('\n=== Java CALLS Sample ===');
  const javaCalls = db.prepare(`
    SELECT r.sourceId, r.targetId, r.reason
    FROM relationships r
    JOIN nodes n ON r.sourceId = n.id
    WHERE r.type = 'CALLS' AND n.filePath LIKE '%.java'
    LIMIT 5
  `).all();
  javaCalls.forEach(r => console.log(`  ${r.sourceId} -> ${r.targetId} (${r.reason})`));

  db.close();
  console.log('\nDone');
} catch (err) {
  console.error('Error:', err.message);
}
