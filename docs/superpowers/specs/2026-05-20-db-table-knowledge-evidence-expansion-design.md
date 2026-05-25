# DB Table Knowledge Evidence Expansion Design

## Goal

Strengthen the generation path for a single `DB` knowledge object so that table knowledge is derived from real MyBatis evidence instead of shallow SQL-only heuristics.

The immediate target is narrow:

- generate trustworthy knowledge for one table at a time,
- start from `mapper.xml`,
- expand `<include>`-based SQL fragments,
- use `resultMap` / `resultType` to pull in Java entity evidence,
- use Java caller code and comments to improve field meaning,
- produce a `DbTableEvidenceBundle` that is rich enough for LLM-based DB object generation.

This spec focuses on the evidence pipeline for `DB` objects only. It does not redesign the other object types.

## Why This Is Needed

The current DB generation path is too shallow for real MyBatis projects.

Three gaps now matter directly:

1. fields may be defined inside `<sql>` fragments and only referenced through `<include refid="...">`
2. field meaning often cannot be inferred from SQL alone and instead depends on Java entity fields and comments
3. `resultMap` / `resultType` often provide the strongest mapping between SQL aliases and business properties

Without those inputs, the generator can produce DB objects that look plausible but are semantically wrong. The current `auth_menu` example demonstrates that risk: a field from another table can leak into the table bundle, while real fields from the target table are missed.

## Non-Goals

This expansion does **not** include:

- a full SQL compiler
- full support for every MyBatis dynamic tag in phase 1
- redesigning the graph label model
- broad changes to non-DB object generation
- replacing LLM generation with a fully deterministic DB documentation writer

## Design Principles

1. **Program discovers facts; LLM explains them**
   - the program must determine statement ownership, table ownership, field candidates, Java bindings, and evidence references
   - the LLM only turns those facts into a readable DB object

2. **Statement-level ownership, never mapper-level ownership**
   - a table bundle may only include a statement if that specific statement touches the table
   - the presence of the table elsewhere in the same mapper is not sufficient

3. **Evidence must expand outward from the table**
   - `table -> statements -> mapper methods -> Java entities -> Java callers`

4. **Every useful semantic hint should survive until the final LLM input**
   - SQL alias
   - fragment source
   - result mapping
   - entity field comment
   - caller comment

## Target Pipeline

The DB knowledge pipeline for one table should become:

```text
mapper.xml discovery
-> mapper structure parse
-> statement draft extraction
-> include/sql fragment expansion
-> statement-level table extraction
-> statement-level field extraction
-> namespace + statementId -> Java mapper binding
-> resultMap/resultType -> Java entity evidence
-> mapper method -> Java caller evidence
-> aggregate single-table DbTableEvidenceBundle
-> LLM DB prompt input
-> structured DB object output
-> schema validation
-> markdown render
```

## Step-By-Step Contracts

### Step 1: Discover mapper.xml files

**Input**

- `repoPath`

**Output**

- `mapperFiles: string[]`

**Requirement**

- only files that are actual MyBatis mapper XML files enter the DB pipeline

### Step 2: Parse mapper.xml structure

**Input**

- `mapperFile`

**Output**

- `MapperDocument`

```ts
interface MapperDocument {
  filePath: string;
  namespace: string;
  statements: StatementDraft[];
  sqlFragments: SqlFragment[];
  resultMaps: ResultMapDef[];
}
```

Where:

```ts
interface StatementDraft {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete';
  rawSqlParts: SqlPart[];
  includeRefs: string[];
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}

interface SqlFragment {
  id: string;
  rawSqlParts: SqlPart[];
}

interface ResultMapDef {
  id: string;
  type?: string;
  mappings: Array<{
    property: string;
    column: string;
  }>;
}
```

**Requirement**

- `<sql id="...">` must be preserved
- `<include refid="...">` must be preserved
- `resultMap` and `resultType` must not be dropped

### Step 3: Resolve `<include>` and SQL fragments

**Input**

- `StatementDraft`
- `sqlFragmentsById`

**Output**

- `ResolvedStatement`

```ts
interface ResolvedStatement {
  id: string;
  type: 'select' | 'insert' | 'update' | 'delete';
  namespace: string;
  mapperFile: string;
  sql: string;
  fragmentRefs: string[];
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
}
```

**Requirement**

- the SQL used for downstream extraction must be the expanded SQL, not the pre-include raw text
- `fragmentRefs` must be retained for provenance

### Step 4: Extract tables per statement

**Input**

- `ResolvedStatement.sql`

**Output**

- `StatementTableRef`

```ts
interface StatementTableRef {
  namespace: string;
  mapperFile: string;
  statementId: string;
  statementType: 'select' | 'insert' | 'update' | 'delete';
  sql: string;
  tables: string[];
}
```

**Requirement**

- statement ownership is defined here
- a table bundle may only consume statements whose `tables[]` contains that table

**Explicit rejection**

- do not infer table ownership from `mapper.referencedTables`

### Step 5: Extract fields per statement

**Input**

- `ResolvedStatement`
- `StatementTableRef`

**Output**

- `StatementFieldRef[]`

```ts
interface StatementFieldRef {
  table: string;
  fieldName: string;
  clauseType: 'select' | 'insert' | 'update' | 'where' | 'join';
  sourceStatementId: string;
  sqlAlias?: string;
  fragmentSource?: string;
}
```

**Requirement**

- fields extracted from an included fragment must retain `fragmentSource`
- aliases like `menu_code authCode` must preserve both the DB-side field and the alias

### Step 6: Bind namespace + statementId to Java Mapper methods

**Input**

- `namespace`
- `statementId`

**Output**

- `MapperMethodBinding`

```ts
interface MapperMethodBinding {
  namespace: string;
  methodId: string;
  javaMapperClass: string;
  javaMapperFile: string;
  javaMethod: string;
}
```

**Requirement**

- this binding must be explicit and table-local
- every statement in the table bundle should include its owning mapper method when resolvable

### Step 7: Resolve resultMap / resultType to Java entity evidence

**Input**

- `ResolvedStatement.resultMap`
- `ResolvedStatement.resultType`
- `MapperDocument.resultMaps`
- repository Java source

**Output**

- `EntityEvidence[]`

```ts
interface EntityEvidence {
  sourceStatementId: string;
  javaType: string;
  javaFile: string;
  classComment?: string;
  fields: Array<{
    javaProperty: string;
    javaFieldName: string;
    javaFieldType?: string;
    javaFieldComment?: string;
    mappedColumn?: string;
  }>;
}
```

**Requirement**

- if `resultType` exists, resolve the class and collect its field-level evidence
- if `resultMap` exists, resolve property/column mappings and then collect the target Java field evidence
- this step is mandatory for high-quality field descriptions

### Step 8: Resolve Java caller evidence

**Input**

- `MapperMethodBinding`
- internal graph/query service

**Output**

- `CallerEvidence[]`

```ts
interface CallerEvidence {
  sourceStatementId: string;
  callerMethod: string;
  callerClass: string;
  callerFile: string;
  callSiteSnippet?: string;
  nearbyComments: string[];
  businessHints: string[];
}
```

**Requirement**

- caller evidence should come from code that invokes the mapper method, not from unrelated classes
- nearby comments and naming hints must be retained because they often explain business meaning better than SQL

## Single-Table Aggregation

After the steps above, the program should build one `DbTableEvidenceBundle` per table.

```ts
interface DbTableEvidenceBundle {
  table: string;
  mapperBindings: MapperMethodBinding[];
  sqlStatements: Array<{
    id: string;
    sql: string;
    statementType: 'select' | 'insert' | 'update' | 'delete';
    tables: string[];
    fragmentRefs: string[];
  }>;
  fieldCandidates: Array<{
    dbField: string;
    sqlAlias?: string;
    sourceStatementId: string;
    sourceKind: 'mapper' | 'entity' | 'caller' | 'inferred';
    fragmentSource?: string;
    mappedJavaProperty?: string;
    javaFieldComment?: string;
    callerHints: string[];
  }>;
  entityEvidence: EntityEvidence[];
  callerEvidence: CallerEvidence[];
  gaps: GapInfo[];
  provenance: {
    source: string;
    repoPath: string;
    generatedAt: string;
  };
}
```

## LLM Input Contract

The DB generator should receive a table-centric payload, not raw repository scans.

```json
{
  "task": {
    "object_type": "DB",
    "generation_mode": "bootstrap"
  },
  "evidence": {
    "repo": { "...": "minimal repo context" },
    "slice": { "...": "database slice metadata" },
    "db_bundle": {
      "table": "auth_menu",
      "mapperBindings": [],
      "sqlStatements": [],
      "fieldCandidates": [],
      "entityEvidence": [],
      "callerEvidence": [],
      "gaps": []
    }
  },
  "output_schema": {
    "...": "DB object schema"
  }
}
```

## LLM Responsibility

The LLM should only:

- generate `table_name_zh`
- generate `description_zh` for each field
- choose `description_source`
- summarize read/write usage and table meaning
- preserve uncertainty when evidence is insufficient

The LLM must not:

- invent fields
- invent mapper methods
- invent Java entity mappings
- invent caller relationships
- invent table ownership

## Required Code Changes

The implementation should primarily touch:

- `src/mybatis/mapper-parser.ts`
- `src/mybatis/sql-lineage.ts`
- new or expanded MyBatis helpers for:
  - include expansion
  - resultMap parsing
  - Java entity resolution
  - caller evidence resolution
- `src/evidence/db-bundle-builder.ts`
- `src/query/index-service.ts`
- `src/generation/object-generators/db-generator.ts`

## Acceptance Criteria

Using one real table as the verification target:

- the system can expand `<include>`-defined fields into the resolved SQL
- the system can identify which statements truly belong to the target table
- the system can attach `resultMap` / `resultType` entity evidence when present
- the system can attach caller Java evidence when present
- the final `DbTableEvidenceBundle` for the target table is table-local and does not contain statements from unrelated tables
- the generated `DB-*.md` contains fields that match the target table’s real SQL evidence

## Verification Target

The first verification target should remain a single real table in:

- `D:\workspace\other_project\music-education-admin`

Recommended initial target:

- `auth_menu`

The reason to keep one-table validation first is simple:

- it makes statement pollution obvious
- it makes missing include expansion obvious
- it makes field-description quality easy to inspect manually

## Explicitly Unacceptable Outcomes

The following do **not** count as success:

- treating all statements in one mapper as belonging to every table referenced by that mapper
- ignoring `<include>` and pretending direct SQL text is complete
- generating field descriptions without passing in `resultMap` / `resultType` entity evidence when available
- generating field descriptions without caller evidence when it exists
- allowing unrelated table fields to appear in the target table bundle
- relying on prompt wording alone instead of fixing upstream evidence quality

## Recommendation

Implementation should proceed in this order:

1. statement-level ownership
2. include expansion
3. resultMap / resultType entity evidence
4. caller evidence
5. prompt/schema alignment cleanup

This order is important. The current bottleneck is not prompt quality; it is evidence quality.
