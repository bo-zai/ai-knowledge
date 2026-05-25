# Embedded Runtime And MyBatis DB Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all runtime dependence on the external GitNexus CLI by embedding the required indexing runtime into this project and add MyBatis mapper-to-table lineage so DB knowledge generation can start from a real table and expand to related code.

**Architecture:** Vendor the GitNexus runtime closure into `src/engine/`, expose project-native indexing and query services from `src/query/`, and add a project-specific `src/mybatis/` extension that produces `CodeElement{subtype: 'sql_statement' | 'db_table'}` nodes plus `QUERIES` and `ACCESSES` edges. Keep LLM generation downstream of evidence extraction: the embedded engine determines facts, the generator consumes structured DB evidence bundles.

**Tech Stack:** TypeScript, Node.js, LadybugDB, graphology, tree-sitter, XML parser support, OpenAI-compatible API, vitest, tsup.

---

## File Structure

The implementation should converge on this structure:

```text
src/
|-- cli/
|-- engine/
|   |-- shared/
|   |-- ingestion/
|   |-- graph/
|   |-- lbug/
|   |-- search/
|   |-- embeddings/
|   |-- analyze/
|   |-- storage/
|   |-- platform/
|-- query/
|-- mybatis/
|-- evidence/
|-- generation/
|-- packaging/
|-- schemas/
|-- shared/
```

The following directories must be removed after migration:

```text
src/gitnexus/
tests/unit/gitnexus/
```

The following runtime-facing phrases must be removed or rewritten:

- “requires GitNexus CLI”
- “run gitnexus analyze/query/list/status”
- comments that describe runtime behavior as external GitNexus orchestration

## Task 1: Vendor Shared Contracts And Runtime Core

**Files:**
- Create: `src/engine/shared/**`
- Create: `src/engine/ingestion/**`
- Create: `src/engine/graph/**`
- Create: `src/engine/lbug/**`
- Create: `src/engine/search/**`
- Create: `src/engine/embeddings/**`
- Create: `src/engine/analyze/run-analyze.ts`
- Create: `src/engine/storage/git.ts`
- Create: `src/engine/storage/repo-manager.ts`
- Create: `src/engine/platform/capabilities.ts`
- Modify: `package.json`
- Test: `tests/unit/engine/vendor-imports.test.ts`

- [ ] **Step 1: Write the failing test for engine entry imports**

```ts
import { describe, expect, it } from 'vitest';

describe('embedded engine imports', () => {
  it('exports runFullAnalysis from the embedded runtime', async () => {
    const mod = await import('../../../src/engine/analyze/run-analyze.js');
    expect(typeof mod.runFullAnalysis).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/engine/vendor-imports.test.ts`
Expected: FAIL with module not found for `src/engine/analyze/run-analyze.js`

- [ ] **Step 3: Vendor the runtime closure into `src/engine/`**

Copy the required runtime closure from:

- `D:\workspace\GitNexus\gitnexus-shared\src\**`
- `D:\workspace\GitNexus\gitnexus\src\core\ingestion\**`
- `D:\workspace\GitNexus\gitnexus\src\core\graph\**`
- `D:\workspace\GitNexus\gitnexus\src\core\lbug\**`
- `D:\workspace\GitNexus\gitnexus\src\core\search\**`
- `D:\workspace\GitNexus\gitnexus\src\core\embeddings\**`
- `D:\workspace\GitNexus\gitnexus\src\core\platform\capabilities.ts`
- `D:\workspace\GitNexus\gitnexus\src\core\run-analyze.ts`
- `D:\workspace\GitNexus\gitnexus\src\storage\git.ts`
- `D:\workspace\GitNexus\gitnexus\src\storage\repo-manager.ts`

Adjust imports to point at `src/engine/**` instead of `gitnexus-shared` or old relative roots.

- [ ] **Step 4: Add runtime dependencies**

Update `package.json` to include the embedded runtime requirements, including at minimum:

```json
{
  "dependencies": {
    "@ladybugdb/core": "...",
    "@huggingface/transformers": "...",
    "graphology": "...",
    "graphology-indices": "...",
    "graphology-utils": "...",
    "glob": "...",
    "ignore": "...",
    "js-yaml": "...",
    "jsonc-parser": "...",
    "onnxruntime-node": "...",
    "tree-sitter": "...",
    "uuid": "..."
  }
}
```

- [ ] **Step 5: Run the import test again**

Run: `npx vitest run tests/unit/engine/vendor-imports.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck to expose vendoring breakage**

Run: `npm run typecheck`
Expected: FAIL initially on unresolved imports or type mismatches that will be fixed in subsequent tasks

- [ ] **Step 7: Commit**

```bash
git add src/engine package.json tests/unit/engine/vendor-imports.test.ts
git commit -m "feat: vendor embedded runtime core"
```

## Task 2: Replace External GitNexus Runtime Integration

**Files:**
- Delete: `src/gitnexus/**`
- Modify: `src/cli/generate.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/status.ts`
- Modify: `README.md`
- Test: `tests/unit/cli/no-external-gitnexus.test.ts`

- [ ] **Step 1: Write the failing test that blocks external gitnexus execution**

```ts
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('no external gitnexus runtime dependency', () => {
  it('does not reference gitnexus CLI commands from generate.ts', async () => {
    const source = await readFile('src/cli/generate.ts', 'utf8');
    expect(source).not.toMatch(/gitnexus\\s+(analyze|query|list|status)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/cli/no-external-gitnexus.test.ts`
Expected: FAIL because `generate.ts` still contains external GitNexus orchestration

- [ ] **Step 3: Delete the old external adapter layer**

Remove:

- `src/gitnexus/adapter.ts`
- `src/gitnexus/commands.ts`
- `src/gitnexus/ensure-index.ts`
- `src/gitnexus/types.ts`

Then update imports in CLI code to point to new internal engine/query modules.

- [ ] **Step 4: Replace external runtime flow in `generate.ts`**

Change the flow from:

```ts
ensureGitNexusIndex(...)
runGitNexus(...)
extractSliceSeedsFromGitNexus(...)
```

to:

```ts
runEmbeddedAnalysis(...)
discoverSlicesFromEmbeddedIndex(...)
buildEvidenceFromEmbeddedIndex(...)
```

- [ ] **Step 5: Rewrite runtime-facing README language**

Replace any text that tells users to depend on an installed `gitnexus` CLI at runtime with text that describes the embedded runtime.

- [ ] **Step 6: Run the test again**

Run: `npx vitest run tests/unit/cli/no-external-gitnexus.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli README.md tests/unit/cli/no-external-gitnexus.test.ts
git commit -m "refactor: remove external gitnexus runtime dependency"
```

## Task 3: Introduce Embedded Analysis And Query Facades

**Files:**
- Create: `src/query/index-service.ts`
- Create: `src/query/query-service.ts`
- Create: `src/query/types.ts`
- Modify: `src/cli/generate.ts`
- Modify: `src/cli/status.ts`
- Test: `tests/unit/query/query-service.test.ts`

- [ ] **Step 1: Write the failing query facade test**

```ts
import { describe, expect, it } from 'vitest';
import { createQueryService } from '../../../src/query/query-service.js';

describe('query service', () => {
  it('exposes table discovery and table context methods', () => {
    const service = createQueryService({} as never);
    expect(typeof service.findDbTables).toBe('function');
    expect(typeof service.getDbTableContext).toBe('function');
    expect(typeof service.buildDbEvidenceBundle).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/query-service.test.ts`
Expected: FAIL with missing module or missing exported functions

- [ ] **Step 3: Create the index facade**

`src/query/index-service.ts` should wrap the embedded runtime analysis and storage bootstrap. It must expose:

- `ensureIndexed(repoPath)`
- `getRepoHandle(repoPath)`
- `openRepoDb(repoId)`

- [ ] **Step 4: Create the query facade**

`src/query/query-service.ts` should expose:

- `findDbTables`
- `getDbTableContext`
- `buildDbEvidenceBundle`

This file must depend on internal engine/lbug query functions, not shell commands.

- [ ] **Step 5: Run the test again**

Run: `npx vitest run tests/unit/query/query-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/query tests/unit/query/query-service.test.ts
git commit -m "feat: add embedded index and query facades"
```

## Task 4: Add XML Language Support

**Files:**
- Modify: `package.json`
- Create: `src/mybatis/xml-language.ts`
- Modify: `src/engine/ingestion/languages/index.ts`
- Test: `tests/unit/mybatis/xml-language.test.ts`

- [ ] **Step 1: Write the failing XML language test**

```ts
import { describe, expect, it } from 'vitest';
import { canParseMapperXml } from '../../../src/mybatis/xml-language.js';

describe('xml language support', () => {
  it('recognizes mapper.xml as parseable input', () => {
    expect(canParseMapperXml('UserMapper.xml')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mybatis/xml-language.test.ts`
Expected: FAIL with missing XML support module

- [ ] **Step 3: Add XML parser dependency**

Add `tree-sitter-xml` or the chosen XML parser dependency to `package.json`.

- [ ] **Step 4: Create XML language support**

Implement `src/mybatis/xml-language.ts` with:

- filename recognition for `*Mapper.xml`
- parser bootstrap
- mapper file parse helper

- [ ] **Step 5: Run the test again**

Run: `npx vitest run tests/unit/mybatis/xml-language.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json src/mybatis/xml-language.ts tests/unit/mybatis/xml-language.test.ts
git commit -m "feat: add xml language support for mybatis"
```

## Task 5: Implement Mapper.xml Statement Extraction

**Files:**
- Create: `src/mybatis/types.ts`
- Create: `src/mybatis/mapper-parser.ts`
- Test: `tests/unit/mybatis/mapper-parser.test.ts`

- [ ] **Step 1: Write the failing mapper parser test**

```ts
import { describe, expect, it } from 'vitest';
import { parseMapperXml } from '../../../src/mybatis/mapper-parser.js';

describe('mapper parser', () => {
  it('extracts namespace and select statements', () => {
    const xml = `
      <mapper namespace="demo.UserMapper">
        <select id="selectUsers" resultType="demo.User">
          SELECT id, name FROM users
        </select>
      </mapper>
    `;

    const parsed = parseMapperXml(xml, 'UserMapper.xml');
    expect(parsed.namespace).toBe('demo.UserMapper');
    expect(parsed.statements[0]?.id).toBe('selectUsers');
    expect(parsed.statements[0]?.operation).toBe('select');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mybatis/mapper-parser.test.ts`
Expected: FAIL with missing parser

- [ ] **Step 3: Implement statement extraction**

Support at minimum:

- `mapper namespace`
- `select`
- `insert`
- `update`
- `delete`
- `sql`
- `include`

Normalize SQL text and preserve statement identity.

- [ ] **Step 4: Run the parser test again**

Run: `npx vitest run tests/unit/mybatis/mapper-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mybatis/types.ts src/mybatis/mapper-parser.ts tests/unit/mybatis/mapper-parser.test.ts
git commit -m "feat: parse mybatis mapper statements"
```

## Task 6: Add Java Mapper Binding And SQL Lineage

**Files:**
- Create: `src/mybatis/mapper-binding.ts`
- Create: `src/mybatis/sql-lineage.ts`
- Modify: `src/engine/ingestion/**` where graph nodes/edges are emitted
- Test: `tests/unit/mybatis/sql-lineage.test.ts`

- [ ] **Step 1: Write the failing SQL lineage test**

```ts
import { describe, expect, it } from 'vitest';
import { extractSqlLineage } from '../../../src/mybatis/sql-lineage.js';

describe('sql lineage', () => {
  it('extracts table names from select and insert statements', () => {
    const selectLineage = extractSqlLineage('SELECT id, name FROM users WHERE status = 1');
    const insertLineage = extractSqlLineage('INSERT INTO users (id, name) VALUES (?, ?)');

    expect(selectLineage.tables).toContain('users');
    expect(insertLineage.tables).toContain('users');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mybatis/sql-lineage.test.ts`
Expected: FAIL with missing lineage extractor

- [ ] **Step 3: Implement Java/XML binding**

Create a binding helper that maps:

- XML `namespace` -> Java Mapper interface
- statement `id` -> Java method

At this stage, it is acceptable to start with name-based and FQN-based matching derived from existing symbol metadata.

- [ ] **Step 4: Implement SQL lineage extraction**

Support phase-1 extraction for:

- `FROM`
- `JOIN`
- `INSERT INTO`
- `UPDATE`
- `DELETE FROM`
- selected field names
- updated field names

- [ ] **Step 5: Emit graph entities**

Emit:

- `CodeElement{subtype:'sql_statement'}`
- `CodeElement{subtype:'db_table'}`

Emit edges:

- `File(xml) -> sql_statement` as `DEFINES`
- `Method(java) -> sql_statement` as `QUERIES`
- `sql_statement -> db_table` as `ACCESSES`

- [ ] **Step 6: Run the test again**

Run: `npx vitest run tests/unit/mybatis/sql-lineage.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/mybatis src/engine/ingestion tests/unit/mybatis/sql-lineage.test.ts
git commit -m "feat: add mybatis method to table lineage"
```

## Task 7: Build DB Table Context And Evidence Bundle

**Files:**
- Modify: `src/query/query-service.ts`
- Create: `src/evidence/db-bundle-builder.ts`
- Test: `tests/unit/evidence/db-bundle-builder.test.ts`

- [ ] **Step 1: Write the failing DB evidence bundle test**

```ts
import { describe, expect, it } from 'vitest';
import { buildDbEvidenceBundle } from '../../../src/evidence/db-bundle-builder.js';

describe('db evidence bundle', () => {
  it('builds a table-centric bundle shape', () => {
    const bundle = buildDbEvidenceBundle({
      table: { table_name: 'users', schema_name: 'public', qualified_name: 'public.users' },
      statements: [],
      methods: [],
      files: [],
      gaps: [],
    });

    expect(bundle.table.table_name).toBe('users');
    expect(Array.isArray(bundle.sql_statements)).toBe(true);
    expect(Array.isArray(bundle.related_code.files)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/evidence/db-bundle-builder.test.ts`
Expected: FAIL with missing builder

- [ ] **Step 3: Implement `findDbTables` and `getDbTableContext`**

Query through the internal graph for:

- table nodes
- related sql statement nodes
- related Java methods
- related files

- [ ] **Step 4: Implement `buildDbEvidenceBundle`**

The bundle must contain:

- `table`
- `mapper_bindings`
- `sql_statements`
- `related_code`
- `field_candidates`
- `gaps`

- [ ] **Step 5: Run the test again**

Run: `npx vitest run tests/unit/evidence/db-bundle-builder.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/query/query-service.ts src/evidence/db-bundle-builder.ts tests/unit/evidence/db-bundle-builder.test.ts
git commit -m "feat: add db table evidence bundle builder"
```

## Task 8: Wire DB Knowledge Generation To The New DB Bundle

**Files:**
- Modify: `src/cli/generate.ts`
- Modify: `src/generation/object-generators/db-generator.ts`
- Modify: `src/evidence/db-evidence.ts`
- Test: `tests/integration/generate-nonempty-fixture.test.ts`

- [ ] **Step 1: Write the failing integration assertion for DB evidence-driven generation**

Use the existing MyBatis fixture integration test and tighten it to assert:

- at least one `DB-*` object exists
- the DB object is built from table-centric evidence
- fields remain present and each field has `description_source`

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npx vitest run tests/integration/generate-nonempty-fixture.test.ts`
Expected: FAIL because the old DB path is still synthetic or incomplete

- [ ] **Step 3: Replace the old DB generation path**

Change `generate.ts` so DB generation:

1. discovers table nodes through the internal query service
2. builds a `DB evidence bundle`
3. invokes the DB generator with that bundle
4. falls back deterministically only when LLM content generation is unavailable

- [ ] **Step 4: Update DB generator prompts**

Ensure the DB generator only enriches:

- table-level Chinese summary
- field Chinese descriptions when source comment is absent

and never invents new tables, fields, statements, or bindings.

- [ ] **Step 5: Run the integration test again**

Run: `npx vitest run tests/integration/generate-nonempty-fixture.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/generate.ts src/generation/object-generators/db-generator.ts src/evidence/db-evidence.ts tests/integration/generate-nonempty-fixture.test.ts
git commit -m "feat: generate db knowledge from internal table evidence"
```

## Task 9: Real Validation On Music Education Repositories

**Files:**
- Modify: `tests/integration/real-repo-database.test.ts`
- Modify: `README.md`
- Modify: `docs/` references that still describe external GitNexus runtime

- [ ] **Step 1: Write the failing real-repo test**

Add a real integration test that targets at least one of:

- `D:\workspace\other_project\music-education-admin`
- `D:\workspace\other_project\music-education-app`
- `D:\workspace\other_project\music-education-core`

The test should assert:

- indexing succeeds
- at least one MyBatis table is discovered
- querying a discovered table returns related XML/Java code context

- [ ] **Step 2: Run the real-repo test to verify it fails**

Run: `npx vitest run tests/integration/real-repo-database.test.ts`
Expected: FAIL until MyBatis runtime wiring is complete

- [ ] **Step 3: Make the runtime pass on real repos**

Fix only real gaps revealed by the music-education repositories:

- namespace mismatches
- include/refid expansion issues
- SQL table extraction failures
- missing Java method bindings

- [ ] **Step 4: Run the real-repo validation**

Run:

```bash
npx vitest run tests/integration/real-repo-database.test.ts
```

Expected: PASS on the available indexed local repos

- [ ] **Step 5: Commit**

```bash
git add tests/integration/real-repo-database.test.ts README.md docs
git commit -m "test: validate embedded mybatis db lineage on real repos"
```

## Task 10: Cleanup And Provenance Consolidation

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Delete: stale tests under `tests/unit/gitnexus/` if no longer relevant

- [ ] **Step 1: Write the failing test for stale external naming**

```ts
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('runtime docs cleanup', () => {
  it('does not describe runtime usage through external gitnexus commands', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).not.toMatch(/run\\s+gitnexus\\s+(analyze|query|list|status)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or guard against regressions**

Run: `npx vitest run tests/unit/cli/no-external-gitnexus.test.ts`
Expected: PASS after cleanup, or FAIL if external wording remains

- [ ] **Step 3: Add centralized provenance**

Create `THIRD_PARTY_NOTICES.md` and record the vendored-source provenance there instead of leaving runtime code littered with GitNexus operational comments.

- [ ] **Step 4: Remove stale tests and docs**

Delete or rewrite tests that only validate old `src/gitnexus/**` behavior.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run typecheck
npm run build
npm test
```

Expected: all commands pass

- [ ] **Step 6: Commit**

```bash
git add THIRD_PARTY_NOTICES.md README.md AGENTS.md tests
git commit -m "chore: finalize embedded runtime migration cleanup"
```

## Spec Coverage Check

This plan covers all spec requirements:

- embedded runtime vendoring: Task 1
- removal of external GitNexus runtime dependence: Task 2
- internal query facade: Task 3
- XML support: Task 4
- mapper.xml parsing: Task 5
- Java-Mapper binding and SQL lineage: Task 6
- DB evidence bundle: Task 7
- DB knowledge generation path: Task 8
- real repo validation on music-education repos: Task 9
- cleanup and provenance centralization: Task 10

No spec section is intentionally left without a task.

## Self-Review

- Placeholder scan: no `TODO`, `TBD`, or deferred “implement later” markers remain.
- Type consistency: the plan consistently uses `db_table`, `sql_statement`, `findDbTables`, `getDbTableContext`, and `buildDbEvidenceBundle`.
- Scope check: the plan is large but still coherent because every task serves the same migration boundary: embedded runtime plus MyBatis DB lineage.

Plan complete and saved to `docs/superpowers/plans/2026-05-20-embedded-runtime-mybatis.md`. You said Claude Code will execute it, so this plan is ready to hand off directly.
