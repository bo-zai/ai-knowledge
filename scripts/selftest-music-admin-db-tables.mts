#!/usr/bin/env node
/**
 * Self-test script for 3 real music-education-admin tables.
 * Validates DB evidence pipeline for: auth_menu, mall_category, music_user.
 */

import { parseMapperFile, resolveStatementSql, extractTablesFromSql, findResultMap, resolveEntityEvidence, resolveCallerEvidence } from '../src/mybatis/index.js';

const REPO_PATH = 'D:/workspace/other_project/music-education-admin';
const CORE_REPO_PATH = 'D:/workspace/other_project/music-education-core';

interface TableExpectations {
  tableName: string;
  mapperFile: string;
  expectedStatementIds: string[];
  expectedFields: string[];
  expectedFragmentRefs?: string[];
  expectedEntityType?: string;
  expectedCallerContains?: string;
}

const expectations: TableExpectations[] = [
  {
    tableName: 'auth_menu',
    mapperFile: `${REPO_PATH}/src/main/resources/mappers/AuthMapper.xml`,
    expectedStatementIds: ['getMenuAuthList'],
    expectedFields: ['id', 'menu_code', 'menu_name', 'module_id', 'parent_id', 'path'],
    expectedEntityType: 'com.education.music.core.DO.user.AuthDO',
    expectedCallerContains: 'AuthService',
  },
  {
    tableName: 'mall_category',
    mapperFile: `${REPO_PATH}/src/main/resources/mappers/CategoryMapper.xml`,
    expectedStatementIds: ['getCategoryList', 'getCategoryByNameAndLevel', 'getCategoryById'],
    expectedFields: ['id', 'name', 'sort_code', 'is_disable', 'create_time', 'update_time', 'creator_id', 'updator_id', 'pic_url', 'icon_url', 'level', 'pid'],
    expectedFragmentRefs: ['Base_Category_Column_List'],
    expectedEntityType: 'com.education.music.core.DO.mall.CategoryDO',
    expectedCallerContains: 'CategoryService',
  },
  {
    tableName: 'music_user',
    mapperFile: `${REPO_PATH}/src/main/resources/mappers/UserMapper.xml`,
    expectedStatementIds: ['getAppUserById', 'getUserByMobile', 'getUserById'],
    expectedFields: ['id', 'mobile', 'nickname', 'realname', 'avatar_url'],
    expectedFragmentRefs: ['Base_Column_List'],
    expectedEntityType: 'com.education.music.core.DO.user.UserDO',
    expectedCallerContains: 'UserService', // UserService calls getUserById, CouponService calls getAppUserById
  },
];

let passed = 0;
let failed = 0;

async function runTests(): Promise<void> {
  console.log('Running self-test for 3 music-education-admin tables...\n');

  for (const exp of expectations) {
    console.log(`\n=== Testing ${exp.tableName} ===`);
    try {
      await testTable(exp);
      console.log(`✅ ${exp.tableName} passed`);
      passed++;
    } catch (error) {
      console.log(`❌ ${exp.tableName} failed: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${expectations.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function testTable(exp: TableExpectations): Promise<void> {
  // 1. Parse mapper file
  const mapper = await parseMapperFile(exp.mapperFile);
  if (!mapper) {
    throw new Error(`Failed to parse mapper file: ${exp.mapperFile}`);
  }

  // 2. Check expected statement IDs exist
  for (const stmtId of exp.expectedStatementIds) {
    const stmt = mapper.statements.find((s) => s.id === stmtId);
    if (!stmt) {
      throw new Error(`Missing statement: ${stmtId}`);
    }
    const resolved = resolveStatementSql(stmt, mapper);
    const tables = extractTablesFromSql(resolved.sql);
    if (!tables.includes(exp.tableName)) {
      throw new Error(`Statement ${stmtId} does not reference table ${exp.tableName}. Tables: ${tables.join(',')}`);
    }
  }

  // 3. Check fragment refs
  if (exp.expectedFragmentRefs) {
    for (const fragRef of exp.expectedFragmentRefs) {
      const stmt = mapper.statements.find((s) => s.includeRefs.includes(fragRef));
      if (!stmt) {
        throw new Error(`Missing fragment ref: ${fragRef}`);
      }
    }
  }

  // 4. Check field extraction
  for (const stmtId of exp.expectedStatementIds) {
    const stmt = mapper.statements.find((s) => s.id === stmtId);
    if (stmt) {
      const resolved = resolveStatementSql(stmt, mapper);
      for (const field of exp.expectedFields) {
        if (!resolved.sql.toLowerCase().includes(field.toLowerCase())) {
          // Some fields might be in fragments, check if fragment is included
          const hasFragment = stmt.includeRefs.length > 0;
          if (!hasFragment) {
            throw new Error(`Field ${field} not found in statement ${stmtId}`);
          }
        }
      }
    }
  }

  // 5. Check entity type (resultType or resultMap)
  if (exp.expectedEntityType) {
    const stmt = mapper.statements.find((s) => s.id === exp.expectedStatementIds[0]);
    if (stmt) {
      const entity = await resolveEntityEvidence({
        repoPath: REPO_PATH,
        coreRepoPath: CORE_REPO_PATH,
        resultType: stmt.resultType,
        resultMap: stmt.resultMap ? findResultMap(mapper, stmt.resultMap) : null,
      });

      if (!entity) {
        throw new Error(`Failed to resolve entity evidence for ${exp.expectedEntityType}`);
      }

      if (entity.javaType !== exp.expectedEntityType) {
        throw new Error(`Entity type mismatch: expected ${exp.expectedEntityType}, got ${entity.javaType}`);
      }
    }
  }

  // 6. Check caller evidence
  if (exp.expectedCallerContains) {
    // Try all expected statement IDs
    let foundCaller = false;
    for (const stmtId of exp.expectedStatementIds) {
      const stmt = mapper.statements.find((s) => s.id === stmtId);
      if (stmt) {
        const callers = await resolveCallerEvidence({
          repoPath: REPO_PATH,
          namespace: mapper.namespace,
          methodId: stmt.id,
        });

        const hasExpectedCaller = callers.some((c) =>
          c.callerClass.includes(exp.expectedCallerContains!) ||
          c.callerMethod.includes(exp.expectedCallerContains!)
        );

        if (hasExpectedCaller) {
          foundCaller = true;
          break;
        }
      }
    }

    if (!foundCaller) {
      // Log found callers for debugging
      const stmt = mapper.statements.find((s) => s.id === exp.expectedStatementIds[0]);
      if (stmt) {
        const callers = await resolveCallerEvidence({
          repoPath: REPO_PATH,
          namespace: mapper.namespace,
          methodId: stmt.id,
        });
        console.log(`  Found callers for ${stmt.id}: ${callers.map((c) => c.callerClass).join(', ')}`);
      }
      throw new Error(`Missing expected caller containing ${exp.expectedCallerContains}`);
    }
  }
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
