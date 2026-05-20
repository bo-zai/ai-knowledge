import type { DbTableEvidenceBundle, MapperBinding, SqlStatementInfo, FieldCandidate, GapInfo } from '../../evidence/db-bundle-builder.js';
import type { EntityEvidence, CallerEvidence } from '../../mybatis/types.js';

interface DbPromptInput {
  slice?: { id: string; kind: string; title: string };
  evidence?: unknown;
  db_bundle?: DbTableEvidenceBundle | null;
  repoPath?: string;
}

/**
 * Build DB generation prompt with rich evidence.
 */
export function buildDbPrompt(input: DbPromptInput): { system: string; user: string } {
  const system = `You must generate only JSON. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers.

CRITICAL RULES:
- Every field MUST have description_zh (Chinese description) and description_source (either "comment" or "inferred")
- Prefer "comment" when Java entity field comments exist in evidence
- Use "inferred" when no source comment exists but field name is clear
- Use SQL aliases and Java property mappings to infer field meaning
- Caller evidence provides business context - use it for table-level description
- Never include fields from unrelated tables
- Statement-scoped: only fields from SQL that actually touches this table`;

  // Use db_bundle if available (new evidence pipeline)
  const evidence = input.db_bundle ? buildEvidenceFromBundle(input.db_bundle) : input.evidence;

  const user = JSON.stringify(
    {
      task: { object_type: 'DB', generation_mode: 'bootstrap' },
      evidence,
      output_schema: {
        id: 'string (DB-tableName)',
        type: 'DB',
        table_name: 'string',
        table_name_zh: 'string (Chinese, use caller evidence for context)',
        schema_name: 'string',
        source_kind: 'mapper | inferred (use "mapper" for MyBatis-derived)',
        primary_key: 'array of field names',
        indexes: 'array',
        foreign_keys: 'array',
        read_by: 'array of mapper method IDs from evidence',
        write_by: 'array of mapper method IDs from evidence',
        fields: [
          {
            name: 'string (DB field name from SQL)',
            type: 'string (inferred from Java type if available)',
            nullable: 'boolean',
            default: 'string | null',
            description_zh: 'string (REQUIRED - from Java field comment if available)',
            description_source: 'comment | inferred (REQUIRED)',
            constraints: 'array',
          },
        ],
      },
    },
    null,
    2,
  );
  return { system, user };
}

/**
 * Build structured evidence from DbTableEvidenceBundle.
 */
function buildEvidenceFromBundle(bundle: DbTableEvidenceBundle): Record<string, unknown> {
  return {
    db_bundle: {
      table: bundle.table,
      mapperBindings: bundle.mapperBindings.map((b: MapperBinding) => ({
        namespace: b.namespace,
        methodId: b.methodId,
        statementType: b.statementType,
        resultType: b.resultType,
        resultMap: b.resultMap,
      })),
      sqlStatements: bundle.sqlStatements.map((s: SqlStatementInfo) => ({
        id: s.id,
        sql: s.sql,
        statementType: s.statementType,
        tables: s.tables,
        fragmentRefs: s.fragmentRefs,
      })),
      fieldCandidates: bundle.fieldCandidates.map((f: FieldCandidate) => ({
        dbField: f.name,
        sqlAlias: f.sqlAlias,
        clauseType: f.clauseType,
        mappedJavaProperty: f.mappedJavaProperty,
        javaFieldComment: f.javaFieldComment,
        source: f.source,
      })),
      entityEvidence: bundle.entityEvidence.map((e: EntityEvidence) => ({
        javaType: e.javaType,
        classComment: e.classComment,
        fields: e.fields.map((f: { javaProperty: string; javaFieldName: string; javaFieldType?: string; javaFieldComment?: string; mappedColumn?: string }) => ({
          javaProperty: f.javaProperty,
          javaFieldType: f.javaFieldType,
          javaFieldComment: f.javaFieldComment,
          mappedColumn: f.mappedColumn,
        })),
      })),
      callerEvidence: bundle.callerEvidence.map((c: CallerEvidence) => ({
        callerClass: c.callerClass,
        callerMethod: c.callerMethod,
        nearbyComments: c.nearbyComments,
        businessHints: c.businessHints,
      })),
      gaps: bundle.gaps.map((g: GapInfo) => ({
        type: g.type,
        description: g.description,
      })),
    },
  };
}