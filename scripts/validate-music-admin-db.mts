#!/usr/bin/env node
/**
 * Validate MyBatis DB Evidence for music-education-admin
 *
 * This script validates that:
 * 1. The embedded runtime can index the repository
 * 2. MyBatis mapper files are discovered
 * 3. Tables are extracted from mappers
 * 4. SQL lineage is built correctly
 */

import { parseAllMapperFiles, buildTableMapperMap } from '../src/mybatis/index.js';
import { buildDbTableBundle } from '../src/evidence/db-bundle-builder.js';
import { ensureEmbeddedIndex, checkEmbeddedIndex } from '../src/knowledge/embedded-adapter.js';

const DEFAULT_REPO = 'D:/workspace/other_project/music-education-admin';

async function main() {
  const repoPath = process.argv[2] || DEFAULT_REPO;

  console.log(`Validating DB evidence for: ${repoPath}`);
  console.log('');

  // Step 1: Ensure index exists
  console.log('Step 1: Checking embedded index...');
  const indexed = await checkEmbeddedIndex(repoPath);
  if (!indexed) {
    console.log('  Index not found, creating...');
    await ensureEmbeddedIndex(repoPath);
    console.log('  Index created successfully');
  } else {
    console.log('  Index exists');
  }
  console.log('');

  // Step 2: Parse mapper files
  console.log('Step 2: Parsing MyBatis mapper files...');
  const mappers = await parseAllMapperFiles(repoPath);
  console.log(`  Found ${mappers.length} mapper files`);

  if (mappers.length === 0) {
    throw new Error('No MyBatis mapper files found in repository');
  }

  // Show sample mapper
  const sample = mappers[0];
  console.log(`  Sample: ${sample.filePath}`);
  console.log(`    Namespace: ${sample.namespace}`);
  console.log(`    Statements: ${sample.statements.length}`);
  console.log(`    Tables: ${sample.referencedTables.join(', ')}`);
  console.log('');

  // Step 3: Build table map
  console.log('Step 3: Building table-to-mapper map...');
  const tableMap = await buildTableMapperMap(repoPath);
  const tables = [...tableMap.keys()];
  console.log(`  Found ${tables.length} unique tables`);

  if (tables.length === 0) {
    throw new Error('No database tables discovered from MyBatis mappers');
  }

  // Show sample table
  const sampleTable = tables[0];
  const bindings = tableMap.get(sampleTable) || [];
  console.log(`  Sample table: ${sampleTable}`);
  console.log(`    Mapper bindings: ${bindings.length}`);
  console.log('');

  // Step 4: Build DB bundle for sample table
  console.log('Step 4: Building DB evidence bundle...');
  const bundle = await buildDbTableBundle(repoPath, sampleTable);
  console.log(`  Table: ${bundle.table}`);
  console.log(`  Mapper bindings: ${bundle.mapperBindings.length}`);
  console.log(`  SQL statements: ${bundle.sqlStatements.length}`);
  console.log(`  Field candidates: ${bundle.fieldCandidates.length}`);
  console.log(`  Gaps: ${bundle.gaps.length}`);

  if (bundle.sqlStatements.length > 0) {
    const stmt = bundle.sqlStatements[0];
    console.log(`  Sample SQL: ${stmt.id}`);
    console.log(`    Type: ${stmt.statementType}`);
    console.log(`    SQL preview: ${stmt.sql.substring(0, 100)}...`);
  }
  console.log('');

  // Summary
  console.log('=== Validation Summary ===');
  console.log(`Repository: ${repoPath}`);
  console.log(`Mappers: ${mappers.length}`);
  console.log(`Tables: ${tables.length}`);
  console.log(`Status: SUCCESS`);
  console.log('');

  // Output table list
  console.log('Discovered tables:');
  for (const table of tables.sort()) {
    const b = tableMap.get(table) || [];
    console.log(`  - ${table} (${b.length} bindings)`);
  }
}

main().catch((err) => {
  console.error('Validation failed:', err.message);
  process.exitCode = 1;
});