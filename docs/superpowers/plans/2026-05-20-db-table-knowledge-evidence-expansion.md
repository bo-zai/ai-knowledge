# DB Table Knowledge Evidence Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make single-table `DB` knowledge generation trustworthy for MyBatis projects by expanding `<include>` fragments, adding `resultMap/resultType` Java entity evidence, adding mapper caller evidence, and proving the flow on 3 real tables in `music-education-admin`.

**Architecture:** Keep the current LLM-based DB object generation model, but rebuild the upstream evidence path so it is statement-scoped and table-centric. The program must resolve `mapper.xml -> statement -> included SQL -> target table -> entity evidence -> caller evidence`, then feed that structured bundle to the DB generator. Validation should focus on three real tables: `auth_menu`, `mall_category`, and `music_user`.

**Tech Stack:** TypeScript, Node.js ESM, fast-xml-parser, embedded query/index runtime, MyBatis XML parsing, OpenAI-compatible API, vitest, tsup.

---

## File Structure

This work should converge on the following focused structure:

```text
src/
|-- mybatis/
|   |-- types.ts
|   |-- mapper-parser.ts
|   |-- include-resolver.ts
|   |-- result-map-resolver.ts
|   |-- java-entity-evidence.ts
|   |-- caller-evidence.ts
|   |-- sql-lineage.ts
|-- evidence/
|   |-- db-bundle-builder.ts
|-- query/
|   |-- index-service.ts
|-- generation/
|   |-- object-generators/db-generator.ts
|-- cli/
|   |-- generate.ts
|-- schemas/
|   |-- db.ts

scripts/
|-- selftest-music-admin-db-tables.mts
```

This plan intentionally minimizes test scaffolding. The primary validation mechanism is a deterministic self-test script over 3 real tables, plus only a few narrow unit tests where parser behavior is easy to regress.

## Real Table Self-Test Targets

Claude Code must use these exact tables in `D:\workspace\other_project\music-education-admin`:

1. `auth_menu`
   - covers `resultType`
   - should bind to `AuthMapper.getMenuAuthList`
   - should resolve entity `com.education.music.core.DO.user.AuthDO`
   - should pull caller evidence from `AuthService`

2. `mall_category`
   - covers `<include refid="Base_Category_Column_List" />`
   - covers `resultMap="BaseCategoryResultMap"`
   - should resolve entity `com.education.music.core.DO.mall.CategoryDO`
   - should pull caller evidence from `CategoryService`

3. `music_user`
   - covers `<include refid="Base_Column_List" />`
   - covers `resultMap="BaseResultMap"`
   - should resolve entity `com.education.music.core.DO.user.UserDO`
   - should pull caller evidence from `UserService`

## Task 1: Introduce Shared MyBatis Evidence Types

**Files:**
- Create: `src/mybatis/types.ts`
- Modify: `src/mybatis/index.ts`

- [ ] **Step 1: Add shared DB evidence types**

Create `src/mybatis/types.ts` with the canonical shared shapes used by parser, resolver, and bundle builder:

```ts
export interface StatementDraft {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete';
  rawSqlParts: Array<{ kind: 'text' | 'include'; value: string }>;
  includeRefs: string[];
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}

export interface SqlFragment {
  id: string;
  rawSqlParts: Array<{ kind: 'text' | 'include'; value: string }>;
}

export interface ResultMapDef {
  id: string;
  type?: string;
  mappings: Array<{ property: string; column: string }>;
}

export interface MapperDocument {
  filePath: string;
  namespace: string;
  statements: StatementDraft[];
  sqlFragments: SqlFragment[];
  resultMaps: ResultMapDef[];
}
```

- [ ] **Step 2: Re-export the new types**

Update `src/mybatis/index.ts` to export the new type file so downstream code stops redefining overlapping local interfaces.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: may still fail later in the pipeline, but the new shared type file must compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/mybatis/types.ts src/mybatis/index.ts
git commit -m "refactor: add shared mybatis evidence types"
```

## Task 2: Parse `<sql>`, `<include>`, and `resultMap` Without Losing Structure

**Files:**
- Modify: `src/mybatis/mapper-parser.ts`
- Create: `src/mybatis/include-resolver.ts`
- Create: `src/mybatis/result-map-resolver.ts`
- Test: `tests/unit/mybatis/include-resolution.test.ts`

- [ ] **Step 1: Write one narrow failing test for include expansion**

Create `tests/unit/mybatis/include-resolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseMapperFile } from '../../../src/mybatis/mapper-parser.js';
import { resolveStatementSql } from '../../../src/mybatis/include-resolver.js';

describe('include resolution', () => {
  it('expands sql fragments into the final statement sql', async () => {
    const mapper = await parseMapperFile('D:/workspace/other_project/music-education-admin/src/main/resources/mappers/CategoryMapper.xml');
    const stmt = mapper?.statements.find((item) => item.id === 'getCategoryList');
    expect(stmt).toBeTruthy();

    const resolved = resolveStatementSql(stmt!, mapper!);
    expect(resolved.sql).toContain('id, name, sort_code');
    expect(resolved.fragmentRefs).toContain('Base_Category_Column_List');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/mybatis/include-resolution.test.ts`
Expected: FAIL because current parser collapses SQL too early and does not preserve include structure.

- [ ] **Step 3: Rewrite `mapper-parser.ts` to preserve structure**

Change the parser so it produces:
- `sqlFragments`
- `resultMaps`
- `StatementDraft.rawSqlParts`
- `StatementDraft.includeRefs`

Do **not** flatten `<include>` into plain text in `parseMapperFile`.

- [ ] **Step 4: Implement `resolveStatementSql`**

Create `src/mybatis/include-resolver.ts` with a function shaped like:

```ts
export function resolveStatementSql(
  statement: StatementDraft,
  mapper: MapperDocument,
): ResolvedStatement
```

It must:
- recursively resolve fragment refs
- concatenate fragment text into final SQL
- preserve `fragmentRefs`

- [ ] **Step 5: Implement resultMap extraction**

Create `src/mybatis/result-map-resolver.ts` to parse:
- `<resultMap id="...">`
- `<id column="..." property="...">`
- `<result column="..." property="...">`

At this stage, it is enough to return:

```ts
export function findResultMap(mapper: MapperDocument, resultMapId?: string): ResultMapDef | null
```

- [ ] **Step 6: Re-run the narrow unit test**

Run: `npx vitest run tests/unit/mybatis/include-resolution.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/mybatis/mapper-parser.ts src/mybatis/include-resolver.ts src/mybatis/result-map-resolver.ts tests/unit/mybatis/include-resolution.test.ts
git commit -m "feat: preserve include and resultmap structure in mybatis parser"
```

## Task 3: Make Table and Field Extraction Statement-Scoped

**Files:**
- Modify: `src/mybatis/sql-lineage.ts`
- Modify: `src/evidence/db-bundle-builder.ts`

- [ ] **Step 1: Stop using mapper-level table membership**

Replace logic like:

```ts
if (mapper.referencedTables.includes(tableName.toLowerCase())) {
  ...
}
```

with statement-scoped matching:

```ts
const statementTables = extractTablesFromStatement(resolvedStatement);
if (statementTables.includes(tableName.toLowerCase())) {
  ...
}
```

- [ ] **Step 2: Extract field candidates per statement**

Add a statement-level field extractor that returns:

```ts
{
  table: string;
  fieldName: string;
  clauseType: 'select' | 'insert' | 'update' | 'where' | 'join';
  sourceStatementId: string;
  sqlAlias?: string;
  fragmentSource?: string;
}
```

At minimum, it must correctly parse:
- `menu_code authCode`
- `module_id moduleId`
- `parent_id parentId`
- `u.mobile`
- `u.nickname`

- [ ] **Step 3: Use expanded SQL, not raw statement text**

Ensure `sql-lineage.ts` and `db-bundle-builder.ts` operate on the resolved SQL from Task 2.

- [ ] **Step 4: Manually verify `auth_menu` bundle is table-local**

Run:

```bash
node scripts/validate-music-admin-db.mts
```

Expected after the fix:
- `auth_menu` bundle includes `getMenuAuthList`
- `auth_menu` bundle does **not** include `getAuthCodeList`
- field candidates include:
  - `id`
  - `menu_code`
  - `menu_name`
  - `module_id`
  - `parent_id`
  - `path`

- [ ] **Step 5: Commit**

```bash
git add src/mybatis/sql-lineage.ts src/evidence/db-bundle-builder.ts
git commit -m "fix: scope db statements and fields by statement ownership"
```

## Task 4: Resolve `resultType` / `resultMap` Java Entity Evidence

**Files:**
- Create: `src/mybatis/java-entity-evidence.ts`
- Modify: `src/evidence/db-bundle-builder.ts`

- [ ] **Step 1: Implement Java entity resolution**

Create `src/mybatis/java-entity-evidence.ts` with functions that:
- resolve `resultType` FQN to a Java file
- collect class comment if present
- collect field names
- collect field comments

Recommended public shape:

```ts
export async function resolveEntityEvidence(args: {
  repoPath: string;
  resultType?: string;
  resultMap?: ResultMapDef | null;
}): Promise<EntityEvidence | null>
```

- [ ] **Step 2: Support `resultMap` property/column mapping**

If the statement uses `resultMap`, the resolver must carry:
- `column`
- `property`
- matched Java field
- Java field comment

For `mall_category`, this must resolve at least:
- `name -> name`
- `pic_url -> picUrl`
- `icon_url -> iconUrl`
- `pid -> pid`

- [ ] **Step 3: Merge entity evidence into field candidates**

Update `db-bundle-builder.ts` so field candidates can retain:

```ts
{
  dbField: 'menu_code',
  mappedJavaProperty: 'authCode',
  javaFieldComment: '...'
}
```

- [ ] **Step 4: Manually validate two tables**

Run the bundle validator and inspect:
- `auth_menu` resolves `AuthDO`
- `mall_category` resolves `CategoryDO`

Expected:
- `AuthDO` contributes `authCode/authName/moduleId/menuId/parentId/path`
- `CategoryDO` contributes comments such as `主键`, `模块名称`, `排序编码，默认为0`

- [ ] **Step 5: Commit**

```bash
git add src/mybatis/java-entity-evidence.ts src/evidence/db-bundle-builder.ts
git commit -m "feat: add resultmap and resulttype entity evidence"
```

## Task 5: Add Mapper Caller Evidence From Real Java Code

**Files:**
- Create: `src/mybatis/caller-evidence.ts`
- Modify: `src/query/index-service.ts`
- Modify: `src/evidence/db-bundle-builder.ts`

- [ ] **Step 1: Implement caller lookup**

Create `src/mybatis/caller-evidence.ts` to resolve mapper method callers using the embedded query/index layer.

Recommended function:

```ts
export async function resolveCallerEvidence(args: {
  repoPath: string;
  namespace: string;
  methodId: string;
}): Promise<CallerEvidence[]>
```

It must return:
- caller class
- caller method
- caller file
- nearby comments if available
- naming hints

- [ ] **Step 2: Wire caller evidence into DB bundles**

Update `db-bundle-builder.ts` so each table bundle includes caller evidence for each mapper binding.

- [ ] **Step 3: Validate caller evidence on real tables**

Use these expectations:

- `auth_menu`
  - caller evidence includes `AuthService`
- `mall_category`
  - caller evidence includes `CategoryService`
- `music_user`
  - caller evidence includes `UserService`

- [ ] **Step 4: Commit**

```bash
git add src/mybatis/caller-evidence.ts src/query/index-service.ts src/evidence/db-bundle-builder.ts
git commit -m "feat: add mapper caller evidence for db bundles"
```

## Task 6: Align DB Generator Input and Output With Rich Evidence

**Files:**
- Modify: `src/generation/object-generators/db-generator.ts`
- Modify: `src/schemas/db.ts`
- Modify: `src/cli/generate.ts`

- [ ] **Step 1: Align `source_kind` policy**

The DB object schema and the DB evidence policy must agree.

For this phase, choose one consistent rule and apply it everywhere. Recommended:
- mapper-derived table knowledge emits `source_kind: inferred`
- actual field descriptions still use `description_source: comment | inferred`

Do **not** keep one side on `sql` while the schema rejects it.

- [ ] **Step 2: Ensure LLM sees the new evidence**

Update `db-generator.ts` so the prompt explicitly includes and relies on:
- `sqlStatements`
- `fieldCandidates`
- `entityEvidence`
- `callerEvidence`
- `gaps`

The prompt should tell the model:
- use SQL to identify DB-side fields
- use entity comments to infer field meaning
- use caller evidence as secondary semantic hints

- [ ] **Step 3: Respect `--slice` for one-table generation**

Update `src/cli/generate.ts` so:

```bash
node dist/cli/index.js generate --repo ... --slice database:auth_menu
```

only generates the `auth_menu` path instead of the whole repo.

- [ ] **Step 4: Commit**

```bash
git add src/generation/object-generators/db-generator.ts src/schemas/db.ts src/cli/generate.ts
git commit -m "feat: align db generator with expanded evidence and single-table slice"
```

## Task 7: Add 3-Table Real Self-Test Script

**Files:**
- Create: `scripts/selftest-music-admin-db-tables.mts`
- Modify: `README.md`

- [ ] **Step 1: Implement one deterministic self-test script**

Create:

```text
scripts/selftest-music-admin-db-tables.mts
```

The script must run against:

```text
D:\workspace\other_project\music-education-admin
```

and verify exactly these 3 tables:

- `auth_menu`
- `mall_category`
- `music_user`

- [ ] **Step 2: Encode hard expectations for each table**

The script must fail if any of these are missing.

For `auth_menu`:

```ts
expectStatementIds(['getMenuAuthList']);
expectFields(['id', 'menu_code', 'menu_name', 'module_id', 'parent_id', 'path']);
expectEntityType('com.education.music.core.DO.user.AuthDO');
expectCallerContains('AuthService');
```

For `mall_category`:

```ts
expectFragmentRefs(['Base_Category_Column_List']);
expectFields(['id', 'name', 'sort_code', 'is_disable', 'create_time', 'update_time', 'creator_id', 'updator_id', 'pic_url', 'icon_url', 'level', 'pid']);
expectEntityType('com.education.music.core.DO.mall.CategoryDO');
expectCallerContains('CategoryService');
```

For `music_user`:

```ts
expectFragmentRefs(['Base_Column_List']);
expectFields(['id', 'mobile', 'nickname', 'realname', 'avatar_url']);
expectEntityType('com.education.music.core.DO.user.UserDO');
expectCallerContains('UserService');
```

- [ ] **Step 3: Run the self-test script until it passes**

Run:

```bash
node scripts/selftest-music-admin-db-tables.mts
```

Expected:
- process exits `0`
- prints a short pass summary for all 3 tables

- [ ] **Step 4: Commit**

```bash
git add scripts/selftest-music-admin-db-tables.mts README.md
git commit -m "test: add real selftest for three music admin tables"
```

## Task 8: Generate And Inspect 3 Real DB Objects

**Files:**
- Output under: `D:\workspace\other_project\music-education-admin\bootstrap-knowledge\objects\db\`

- [ ] **Step 1: Generate one table at a time**

Run:

```bash
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:auth_menu --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:mall_category --llm-config llm.config.json
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-admin --slice database:music_user --llm-config llm.config.json
```

Expected:
- each command exits `0`
- each command produces a non-empty `DB-*.md`

- [ ] **Step 2: Inspect generated files**

Check these outputs:

- `bootstrap-knowledge/objects/db/DB-database-auth-menu.md`
- `bootstrap-knowledge/objects/db/DB-database-mall-category.md`
- `bootstrap-knowledge/objects/db/DB-database-music-user.md`

Minimum acceptance:
- no unrelated table fields leaked in
- included fields are present
- `read_by` is non-empty when mapper statements are `select`
- each field has `description_zh`
- each field has `description_source`

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run typecheck
npm run build
node scripts/selftest-music-admin-db-tables.mts
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src scripts
git commit -m "feat: validate db knowledge generation on three real music admin tables"
```

## Spec Coverage Check

This plan covers all requirements in `2026-05-20-db-table-knowledge-evidence-expansion-design.md`:

- include expansion: Task 2
- statement-level ownership: Task 3
- resultMap/resultType entity evidence: Task 4
- caller evidence: Task 5
- richer DB prompt input: Task 6
- single-table verification: Tasks 7-8
- real-table validation on `auth_menu`, `mall_category`, `music_user`: Tasks 7-8

## Self-Review

- Placeholder scan: no `TODO`, `TBD`, or deferred “implement later” text remains.
- Scope check: the plan stays within DB evidence expansion only and does not sprawl into unrelated object types.
- Type consistency: the plan consistently uses `MapperDocument`, `ResolvedStatement`, `DbTableEvidenceBundle`, `EntityEvidence`, and `CallerEvidence`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-db-table-knowledge-evidence-expansion.md`. You said Claude Code will execute it, so the next step is to hand this plan and the matching spec to Claude Code directly.
