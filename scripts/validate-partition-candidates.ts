/**
 * 验证脚本入口
 *
 * 运行方式: npx tsx scripts/validate-partition-candidates.ts
 */

import { runValidation } from '../src/partitioning/candidate-validator.js';

const repoPath = process.argv[2] || 'D:\\workspace\\other_project\\music-education-app';

console.log(`\n========== Validating: ${repoPath} ==========\n`);

const result = await runValidation({
  repoPath,
  verbose: true,
});

console.log('=== Validation Summary ===');
console.log(JSON.stringify({
  success: result.success,
  entryPointCount: result.entryPointCount,
  candidateCount: result.candidateCount,
  relationCount: result.relationCount,
  groupCount: result.groupCount,
  executionTimeMs: result.executionTimeMs,
  error: result.error,
}, null, 2));

if (result.candidates.length > 0) {
  console.log('\n=== Candidates ===');
  for (const c of result.candidates) {
    console.log(`\nCandidate: ${c.candidateId}`);
    console.log(`  AnchorTable: ${c.anchorTable}`);
    console.log(`  EntryPoints: ${c.entryPointCount}`);
    console.log(`  Tables: ${c.tableCount}`);
    console.log(`  Mappers: ${c.mapperCount}`);
    console.log(`  Services: ${c.serviceCount}`);
  }
}

if (result.relations.length > 0) {
  console.log('\n=== Relations ===');
  for (const r of result.relations) {
    console.log(`\nRelation: ${r.candidateIdA} <-> ${r.candidateIdB}`);
    console.log(`  SharedTables: ${r.sharedTables.join(', ') || 'none'}`);
    console.log(`  SharedServices: ${r.sharedServices.join(', ') || 'none'}`);
    console.log(`  SharedMappers: ${r.sharedMappers.join(', ') || 'none'}`);
    console.log(`  ForeignKeyRelation: ${r.hasForeignKeyRelation}`);
  }
}

console.log('\n========== Validation Complete ==========');