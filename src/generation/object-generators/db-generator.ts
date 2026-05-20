export function buildDbPrompt(input: unknown): { system: string; user: string } {
  const system =
    'You must generate only JSON. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers. Every field MUST have description_zh (Chinese description) and description_source (either "comment" or "inferred"). Prefer "comment" when evidence shows DDL/ORM comments, use "inferred" when no source comment exists.';
  const user = JSON.stringify(
    {
      task: { object_type: 'DB', generation_mode: 'bootstrap' },
      evidence: input,
      output_schema: {
        id: 'string (DB-tableName)',
        type: 'DB',
        table_name: 'string',
        table_name_zh: 'string (Chinese)',
        schema_name: 'string',
        source_kind: 'ddl | migration | orm | inferred',
        primary_key: 'array of field names',
        fields: [
          {
            name: 'string',
            type: 'string',
            nullable: 'boolean',
            default: 'string | null',
            description_zh: 'string (REQUIRED)',
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