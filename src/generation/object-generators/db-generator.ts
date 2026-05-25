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
- Caller evidence provides business context - use it for table-level description and field-level disambiguation
- For field-level disambiguation, prioritize javaFieldComment, mappedJavaProperty, sqlAlias, entity class comments, callerEvidence.nearbyComments, callerEvidence.businessHints, and callerEvidence.callSiteSnippet
- For ambiguous abbreviations or polysemous tokens such as diff, lvl, biz, type, status, flag, code, kind, level, use business context first and do not default to generic dictionary translation
- If ambiguous abbreviations cannot be resolved from evidence, use conservative domain wording instead of inventing a precise meaning
- Never include fields from unrelated tables
- Statement-scoped: only fields from SQL that actually touches this table
- If caller_method is unknown, you may return an empty string instead of inventing one

FIELD SELECTION RULES:
- Strong clause types (select, insert, update) CAN enter main fields list
- Weak clause types (where, join, order_by) SHOULD NOT enter main fields list unless also has entity mapping evidence (mappedJavaProperty or javaType)
- If field only appears in order_by/where/join and no entity mapping, skip it from main fields

FIELD TYPE RULES (CRITICAL):
- When javaType exists in fieldCandidate, you MUST use it exactly as provided
- DO NOT infer Long/Integer/String/BigDecimal when javaType is available
- When no javaType, use "unknown" instead of guessing
- DO NOT add type_suffix like "_id" -> "Long" guesses

CONSTRAINT RULES (CRITICAL):
- When no DDL/migration evidence exists, primary_key MUST be empty array []
- When no DDL/migration evidence exists, constraints MUST be empty array []
- DO NOT infer primary_key from field name patterns like "id"
- DO NOT write nullable: false as fact without schema evidence
- Use gaps for suspected but unconfirmed constraints`;

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
        primary_key: 'array of field names (MUST be empty [] when no DDL evidence)',
        indexes: 'array',
        foreign_keys: 'array',
        read_by_direct: 'array of direct-access mapper method IDs from evidence',
        read_by_joined: 'array of joined-access mapper method IDs from evidence',
        write_by_direct: 'array of direct-access write mapper method IDs',
        write_by_joined: 'array of joined-access write mapper method IDs (usually empty)',
        callers: [
          {
            caller_class: 'string (Service/Manager class from evidence)',
            caller_method: 'string (method that invokes the mapper, use empty string if unknown)',
            business_context: 'string (Chinese - from nearby comments or hints)',
          },
        ],
        fields: [
          {
            name: 'string (DB field name from SQL)',
            type: 'string (use javaType from evidence; "unknown" if missing; DO NOT guess)',
            nullable: 'boolean | null (use null if no schema evidence)',
            default: 'string | null',
            description_zh: 'string (REQUIRED - from Java field comment if available)',
            description_source: 'comment | inferred (REQUIRED)',
            constraints: 'array (MUST be empty [] when no DDL evidence)',
          },
        ],
        gaps: [
          {
            type: 'suspected_primary_key | suspected_not_null | suspected_unique | suspected_foreign_key | missing_mapper | unmapped_field | ambiguous_binding',
            description: 'string (Chinese)',
            field_name: 'string (optional)',
            evidence: 'string (optional)',
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
        accessType: b.accessType,
      })),
      sqlStatements: bundle.sqlStatements.map((s: SqlStatementInfo) => ({
        id: s.id,
        sql: s.sql,
        statementType: s.statementType,
        tables: s.tables,
        fragmentRefs: s.fragmentRefs,
        accessType: s.accessType,
      })),
      directStatements: bundle.directStatements.map((s: SqlStatementInfo) => ({
        id: s.id,
        sql: s.sql,
        statementType: s.statementType,
        tables: s.tables,
      })),
      joinedStatements: bundle.joinedStatements.map((s: SqlStatementInfo) => ({
        id: s.id,
        sql: s.sql,
        statementType: s.statementType,
        tables: s.tables,
      })),
      fieldCandidates: bundle.fieldCandidates.map((f: FieldCandidate) => ({
        dbField: f.name,
        sqlAlias: f.sqlAlias,
        clauseType: f.clauseType,
        mappedJavaProperty: f.mappedJavaProperty,
        javaFieldComment: f.javaFieldComment,
        javaType: f.javaType,
        typeSource: f.typeSource,
        source: f.source,
        sourceStatementId: f.sourceStatementId,
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
        callerFile: c.callerFile,
        callSiteSnippet: c.callSiteSnippet,
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
