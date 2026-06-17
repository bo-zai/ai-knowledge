import type {
  DbTableEvidenceBundle,
  SqlStatementInfo,
  FieldCandidate,
  GapInfo,
} from "../../evidence/db-bundle-builder.js";
import type { EntityEvidence, CallerEvidence } from "../../mybatis/types.js";

interface DbPromptInput {
  slice?: { id: string; kind: string; title: string };
  evidence?: unknown;
  db_bundle?: DbTableEvidenceBundle | null;
  repoPath?: string;
}

const MAX_STATEMENT_SAMPLES = 8;
const MAX_ENTITY_EVIDENCE = 4;
const MAX_ENTITY_FIELDS = 24;
const MAX_CALLER_EVIDENCE = 8;
const MAX_NEARBY_COMMENTS = 2;
const MAX_BUSINESS_HINTS = 3;
const MAX_SQL_EXCERPT_LENGTH = 280;
const MAX_SNIPPET_LENGTH = 220;

/**
 * Build DB generation prompt with rich evidence.
 */
export function buildDbPrompt(input: DbPromptInput): {
  system: string;
  user: string;
} {
  const system = `You must generate only JSON. Return exactly one JSON object that matches output_schema. Do not wrap the result in markdown, code fences, explanations, or additional text. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers.

CRITICAL RULES:
- Every field MUST have description_zh (Chinese description) and description_source (either "comment" or "inferred")
- Prefer "comment" when Java entity field comments exist in evidence
- Use "inferred" when no source comment exists but field name is clear
- Use SQL aliases and Java property mappings to infer field meaning
- Caller evidence provides business context - use it for table-level description and field-level disambiguation
- For field-level disambiguation, prioritize javaFieldComment, mappedJavaProperty, sqlAlias, entity class comments, callerEvidence.nearbyComments, callerEvidence.businessHints, and callerEvidence.callSiteSnippet
- entityEvidence and callerEvidence are Java-derived summaries; treat them as the Java-code boundary instead of assuming access to raw source files
- Use accessPaths to fill read_by_direct, read_by_joined, write_by_direct, and write_by_joined
- Use statementSamples as compact SQL evidence only when fieldCandidates alone are insufficient
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
  const evidence = input.db_bundle
    ? buildEvidenceFromBundle(input.db_bundle)
    : input.evidence;

  const user = JSON.stringify(
    {
      task: { object_type: "DB", generation_mode: "bootstrap" },
      evidence,
      output_schema: {
        id: "string (DB-tableName)",
        type: "DB",
        table_name: "string",
        table_name_zh: "string (Chinese, use caller evidence for context)",
        schema_name: "string",
        source_kind: 'mapper | inferred (use "mapper" for MyBatis-derived)',
        primary_key:
          "array of field names (MUST be empty [] when no DDL evidence)",
        indexes: "array",
        foreign_keys: "array",
        read_by_direct:
          "array of direct-access mapper method IDs from evidence",
        read_by_joined:
          "array of joined-access mapper method IDs from evidence",
        write_by_direct: "array of direct-access write mapper method IDs",
        write_by_joined:
          "array of joined-access write mapper method IDs (usually empty)",
        callers: [
          {
            caller_class: "string (Service/Manager class from evidence)",
            caller_method:
              "string (method that invokes the mapper, use empty string if unknown)",
            business_context:
              "string (Chinese - from nearby comments or hints)",
          },
        ],
        fields: [
          {
            name: "string (DB field name from SQL)",
            type: 'string (use javaType from evidence; "unknown" if missing; DO NOT guess)',
            nullable: "boolean | null (use null if no schema evidence)",
            default: "string | null",
            description_zh:
              "string (REQUIRED - from Java field comment if available)",
            description_source: "comment | inferred (REQUIRED)",
            constraints: "array (MUST be empty [] when no DDL evidence)",
          },
        ],
        gaps: [
          {
            type: "suspected_primary_key | suspected_not_null | suspected_unique | suspected_foreign_key | missing_mapper | unmapped_field | ambiguous_binding",
            description: "string (Chinese)",
            field_name: "string (optional)",
            evidence: "string (optional)",
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
function buildEvidenceFromBundle(
  bundle: DbTableEvidenceBundle,
): Record<string, unknown> {
  return {
    db_bundle: {
      table: bundle.table,
      accessPaths: buildAccessPaths(bundle),
      statementSamples: buildStatementSamples(bundle),
      fieldCandidates: buildFieldCandidates(bundle.fieldCandidates),
      entityEvidence: buildEntityEvidence(bundle),
      callerEvidence: buildCallerEvidence(bundle.callerEvidence),
      gaps: bundle.gaps.map((g: GapInfo) => ({
        type: g.type,
        description: g.description,
      })),
    },
  };
}

function buildAccessPaths(
  bundle: DbTableEvidenceBundle,
): Record<string, string[]> {
  return {
    read_by_direct: collectStatementIds(
      bundle.directStatements,
      (statement) => statement.statementType === "select",
    ),
    read_by_joined: collectStatementIds(
      bundle.joinedStatements,
      (statement) => statement.statementType === "select",
    ),
    write_by_direct: collectStatementIds(
      bundle.directStatements,
      (statement) => statement.statementType !== "select",
    ),
    write_by_joined: collectStatementIds(
      bundle.joinedStatements,
      (statement) => statement.statementType !== "select",
    ),
  };
}

function collectStatementIds(
  statements: SqlStatementInfo[],
  predicate: (statement: SqlStatementInfo) => boolean,
): string[] {
  const ids = new Set<string>();
  for (const statement of statements) {
    if (predicate(statement)) {
      ids.add(statement.id);
    }
  }
  return [...ids];
}

function buildStatementSamples(
  bundle: DbTableEvidenceBundle,
): Array<Record<string, unknown>> {
  const samples = [
    ...bundle.directStatements.map((statement) => ({
      statement,
      accessType: "direct" as const,
    })),
    ...bundle.joinedStatements.map((statement) => ({
      statement,
      accessType: "joined" as const,
    })),
  ];
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  for (const sample of samples) {
    if (seen.has(sample.statement.id)) {
      continue;
    }
    seen.add(sample.statement.id);
    result.push({
      id: sample.statement.id,
      statementType: sample.statement.statementType,
      accessType: sample.accessType,
      tables: sample.statement.tables,
      sqlExcerpt: compactSql(sample.statement.sql),
    });

    if (result.length >= MAX_STATEMENT_SAMPLES) {
      break;
    }
  }

  return result;
}

function buildFieldCandidates(
  fieldCandidates: FieldCandidate[],
): Array<Record<string, unknown>> {
  return fieldCandidates.map((field) => ({
    dbField: field.name,
    sqlAlias: field.sqlAlias,
    clauseType: field.clauseType,
    mappedJavaProperty: field.mappedJavaProperty,
    javaFieldComment: field.javaFieldComment,
    javaType: field.javaType,
    typeSource: field.typeSource,
    source: field.source,
    sourceStatementId: field.sourceStatementId,
  }));
}

function buildEntityEvidence(
  bundle: DbTableEvidenceBundle,
): Array<Record<string, unknown>> {
  const targetFieldNames = new Set(
    bundle.fieldCandidates.map((field) => field.name),
  );

  return [...bundle.entityEvidence]
    .sort(
      (left, right) =>
        scoreEntity(right, targetFieldNames) -
        scoreEntity(left, targetFieldNames),
    )
    .map((entity: EntityEvidence) => {
      const relevantFields = entity.fields.filter((field) => {
        const mappedColumn =
          field.mappedColumn ?? toSnakeCase(field.javaProperty);
        return (
          targetFieldNames.has(mappedColumn) ||
          Boolean(field.javaFieldComment?.trim())
        );
      });

      return {
        javaType: entity.javaType,
        classComment: entity.classComment,
        fields: relevantFields.slice(0, MAX_ENTITY_FIELDS).map((field) => ({
          javaProperty: field.javaProperty,
          javaFieldType: field.javaFieldType,
          javaFieldComment: field.javaFieldComment,
          mappedColumn: field.mappedColumn,
        })),
      };
    })
    .filter(
      (entity) =>
        entity.fields.length > 0 || Boolean(entity.classComment?.trim()),
    )
    .slice(0, MAX_ENTITY_EVIDENCE);
}

function scoreEntity(
  entity: EntityEvidence,
  targetFieldNames: Set<string>,
): number {
  return entity.fields.reduce(
    (score, field) => {
      const mappedColumn =
        field.mappedColumn ?? toSnakeCase(field.javaProperty);
      const overlapScore = targetFieldNames.has(mappedColumn) ? 3 : 0;
      const commentScore = field.javaFieldComment?.trim() ? 1 : 0;
      return score + overlapScore + commentScore;
    },
    entity.classComment?.trim() ? 1 : 0,
  );
}

function buildCallerEvidence(
  callerEvidence: CallerEvidence[],
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  const rankedCallers = [...callerEvidence].sort(
    (left, right) => scoreCaller(right) - scoreCaller(left),
  );
  for (const caller of rankedCallers) {
    const key = `${caller.callerClass}#${caller.callerMethod}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      callerClass: caller.callerClass,
      callerMethod: caller.callerMethod,
      callerFile: caller.callerFile,
      callSiteSnippet: caller.callSiteSnippet
        ? compactText(caller.callSiteSnippet, MAX_SNIPPET_LENGTH)
        : undefined,
      nearbyComments: caller.nearbyComments
        .map((comment) => comment.trim())
        .filter((comment) => comment.length > 0)
        .slice(0, MAX_NEARBY_COMMENTS)
        .map((comment) => compactText(comment, MAX_SNIPPET_LENGTH)),
      businessHints: caller.businessHints
        .map((hint) => hint.trim())
        .filter((hint) => hint.length > 0)
        .slice(0, MAX_BUSINESS_HINTS),
    });

    if (result.length >= MAX_CALLER_EVIDENCE) {
      break;
    }
  }

  return result;
}

function scoreCaller(caller: CallerEvidence): number {
  return (
    (caller.callSiteSnippet?.trim() ? 3 : 0) +
    caller.nearbyComments.filter((comment) => comment.trim().length > 0)
      .length *
      2 +
    caller.businessHints.filter((hint) => hint.trim().length > 0).length
  );
}

function compactSql(sql: string): string {
  return compactText(sql, MAX_SQL_EXCERPT_LENGTH);
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength - 3)}...`;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}
