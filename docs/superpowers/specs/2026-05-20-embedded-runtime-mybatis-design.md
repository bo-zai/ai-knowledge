# Embedded Runtime And MyBatis DB Lineage Design

## Goal

Replace all runtime dependence on the external `gitnexus` CLI by embedding the required GitNexus parsing, indexing, graph, storage, search, and embedding runtime directly inside this project, then extend that embedded runtime with first-class MyBatis support so the generator can discover database tables and related code from real repositories.

The immediate business goal is narrow and concrete:

- index the `music-education-admin`, `music-education-app`, and `music-education-core` repositories from inside this project,
- discover MyBatis `mapper.xml` statements and the tables they touch,
- query a table and return graph-linked Java/XML code context,
- build a `DB evidence bundle` suitable for LLM-driven database knowledge generation.

## Non-Goals

This migration does **not** include:

- MCP server support
- HTTP API / web UI
- wiki generation
- cross-repo group analysis
- external `gitnexus` command compatibility
- a full SQL compiler
- introducing new graph node labels for database concepts in phase 1

Phase 1 uses `CodeElement + subtype` for MyBatis graph entities instead of expanding the global graph label taxonomy.

## Motivation

The current project still depends on external `gitnexus` commands and text parsing assumptions. That is operationally fragile and blocks direct database querying inside this repo. Even after vendoring the parsing runtime, GitNexus does not currently include a MyBatis extraction chain, so the project still needs its own MyBatis extension.

The user requirement is stricter than “generate bootstrap knowledge”:

- database knowledge must be based on real code evidence,
- MyBatis is the actual persistence pattern in the target repos,
- DB knowledge generation must start from a table lookup and include related code in the same evidence context.

That requirement changes the core architecture. The project must own the parser/index/query runtime, not merely wrap an external tool.

## Target State

After this migration:

1. `repo-knowledge-generator` indexes repositories with its own embedded runtime.
2. All external `gitnexus analyze/list/query/status` calls are removed.
3. All project code, tests, and user-facing docs stop describing runtime dependence on GitNexus CLI.
4. MyBatis `mapper.xml` files are parsed into graph entities and database lineage edges.
5. The CLI can query discovered database tables and build `DB evidence bundles`.
6. LLM-based DB knowledge generation uses those bundles rather than ad hoc file scanning.

## Embedded Runtime Scope

The migration must vendor the **runtime closure**, not just `core/ingestion`.

### Required vendored sources

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

### Explicitly excluded sources

- `gitnexus/src/mcp/**`
- `gitnexus/src/server/**`
- `gitnexus/src/core/wiki/**`
- `gitnexus/src/core/group/**`
- `gitnexus-web/**`
- current GitNexus CLI wrappers other than code that is directly needed by the embedded runtime

## Project Restructure

The project should stop using `src/gitnexus/**` as the long-term boundary. The new internal structure should be:

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

### Responsibility split

- `engine/`
  - vendored, embedded runtime
- `query/`
  - project-native query facade over LadybugDB and internal graph data
- `mybatis/`
  - project-specific MyBatis parsing and lineage layer
- `evidence/`
  - transforms indexed/query results into controlled LLM evidence bundles

## Dependency Changes

The project will need runtime dependencies consistent with the embedded engine, including at least:

- `@ladybugdb/core`
- `graphology`
- `graphology-indices`
- `graphology-utils`
- `ignore`
- `glob`
- `jsonc-parser`
- `js-yaml`
- `uuid`
- `tree-sitter`
- the required tree-sitter language grammars
- `@huggingface/transformers`
- `onnxruntime-node`

### XML support

To support MyBatis:

- add `tree-sitter-xml` or another XML parser that can be used consistently inside the embedded analysis pipeline
- expose XML parsing as part of the embedded runtime or as a tightly integrated extension layer

## MyBatis Support Requirements

The new MyBatis layer must support four functions.

### 1. XML language support

The engine must parse `mapper.xml` files as structured XML, not as raw text blobs.

### 2. Mapper.xml parser

The parser must recognize at minimum:

- `<mapper namespace="...">`
- `<select id="...">`
- `<insert id="...">`
- `<update id="...">`
- `<delete id="...">`
- `<sql id="...">`
- `<include refid="...">`

The parser must preserve statement identity and normalized SQL text.

### 3. Java-Mapper binding

The system must bind:

- XML `namespace` -> Java Mapper interface FQN
- statement `id` -> Java interface method

This binding is required for useful graph traversal from table back to related Java code.

### 4. SQL dataflow analysis

The system must derive:

- statement operation type: `select | insert | update | delete`
- touched tables
- candidate fields when they are directly extractable from SQL

This produces graph edges from method to statement to table.

## MyBatis Graph Model

Phase 1 uses `CodeElement` nodes with constrained `subtype` properties.

### Nodes

- `CodeElement{subtype: 'sql_statement'}`
  - `name`
  - `mapperNamespace`
  - `statementId`
  - `operation`
  - `sqlText`
  - `parameterType?`
  - `resultType?`

- `CodeElement{subtype: 'db_table'}`
  - `name`
  - `qualifiedName`
  - `schemaName`
  - `tableName`
  - `sourceFile?`

- Existing `Method`
  - Java Mapper method

- Existing `File`
  - Java interface file / XML file

### Edges

- `File(xml) -> sql_statement`: `DEFINES`
- `Method(java) -> sql_statement`: `QUERIES`
- `sql_statement -> db_table`: `ACCESSES`
- optional fast-path:
  - `Method(java) -> db_table`: `ACCESSES`

This graph is sufficient for phase-1 DB knowledge generation and for table-centric code expansion.

## Table-Centric Query Requirements

The project must support database-first retrieval. The core query flow is:

1. find a table
2. expand related statements
3. expand related Java methods
4. expand related files/classes/routes/processes if available
5. build a compact evidence bundle for LLM use

### Required query surface

- `findDbTables(repo, query?)`
- `getDbTableContext(repo, tableName)`
- `buildDbEvidenceBundle(repo, tableName)`

## DB Evidence Bundle Contract

The bundle returned for LLM generation must be structured and table-centric.

```yaml
table:
  table_name:
  schema_name:
  qualified_name:
  source_nodes: []

mapper_bindings:
  - namespace:
    statement_id:
    operation:
    java_method:
    java_file:
    xml_file:

sql_statements:
  - id:
    sql_text:
    operation:
    tables: []
    fields: []
    refs: []

related_code:
  methods: []
  files: []
  classes: []
  routes: []
  processes: []

field_candidates:
  - name:
    source:
    refs: []

gaps: []
```

This bundle is the only supported input for phase-1 `DB` knowledge generation.

## Embeddings Requirements

Embeddings remain part of the embedded runtime. The migration must preserve:

- graph loading
- FTS index creation
- embedding generation
- exact-scan semantic fallback
- hybrid search compatibility

### New DB-related embedding behavior

- `sql_statement` nodes should be embeddable
  - source text includes namespace, statement id, operation, normalized SQL, related table names
- `db_table` nodes should be embeddable
  - source text includes qualified name, fields, related methods, related statements

The text must remain short and structured enough to avoid polluting semantic search.

## LLM Boundary

The LLM remains downstream of evidence extraction. For DB generation:

- program determines table/statement/method/file facts
- LLM generates:
  - table-level Chinese summary
  - field Chinese descriptions when comment is absent
  - relationship explanation

The LLM must not invent:

- tables
- fields
- methods
- mapper namespaces
- statement ids

## Cleanup Requirements

The migration must remove all project runtime dependence on external GitNexus commands and all project code/comments/docs that describe the runtime as externally GitNexus-driven.

Specifically:

- delete `src/gitnexus/**`
- remove `gitnexus analyze/list/query/status` invocations
- remove README and code comments that tell users to rely on GitNexus CLI at runtime
- update tests to validate the embedded runtime instead

### Provenance note

Code provenance must not be erased, but it should be centralized instead of leaking through runtime comments.

Required:

- add a dedicated third-party provenance file for vendored GitNexus-derived code
- keep runtime code comments project-focused, not GitNexus-CLI-focused

## Validation Requirements

The migration is not complete until it is validated against real repos:

- `D:\workspace\other_project\music-education-admin`
- `D:\workspace\other_project\music-education-app`
- `D:\workspace\other_project\music-education-core`

### Phase-1 validation success criteria

1. The project builds and runs without external `gitnexus` command usage.
2. The embedded runtime can index each target repo.
3. MyBatis `mapper.xml` files are detected and parsed.
4. At least one real table can be discovered from each applicable repo.
5. Querying a discovered table returns related Java/XML code context.
6. `buildDbEvidenceBundle` works on real table examples.
7. `DB` knowledge generation consumes this bundle successfully.

## Risks And Constraints

### Technical risks

- vendoring introduces a large dependency and import-rewrite surface
- embeddings add native/runtime dependencies
- XML parser choice may affect parse consistency
- SQL extraction will be partial in phase 1

### Scope constraint

This migration is already large. It must prioritize:

1. embedded runtime
2. MyBatis statement/table lineage
3. DB evidence bundle
4. real-repo validation

Other object types can continue evolving after the DB path is stable.

## Final Recommendation

Implement this migration in two execution stages under one plan:

- Stage A: embed the runtime and remove external GitNexus dependence
- Stage B: add MyBatis lineage and DB evidence generation on top of the embedded runtime

This keeps the architecture coherent while giving Claude Code a clean incremental sequence.
