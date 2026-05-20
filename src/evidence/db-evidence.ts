type DbFieldSource = 'comment' | 'inferred';

interface DbFieldInput {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  description_zh: string;
  description_source: DbFieldSource;
  constraints: string[];
}

export function mergeDbFieldSources(fields: DbFieldInput[]): DbFieldInput[] {
  const byName = new Map<string, DbFieldInput>();
  for (const field of fields) {
    const existing = byName.get(field.name);
    if (!existing) {
      byName.set(field.name, field);
      continue;
    }
    // comment 优先级高于 inferred
    const keep =
      existing.description_source === 'comment'
        ? existing
        : field.description_source === 'comment'
          ? field
          : existing;
    byName.set(field.name, keep);
  }
  return [...byName.values()];
}

export function buildDbEvidence(input: {
  tableName: string;
  schemaName: string;
  ddlSource: string;
  fields: DbFieldInput[];
  primaryKey: string[];
  indexes: string[];
  foreignKeys: string[];
}): {
  facts: Array<{ id: string; claim: string; source_kind: string; refs: Array<{ file: string }> }>;
  fields: DbFieldInput[];
} {
  const facts = [
    {
      id: `F-DB-${input.tableName}-001`,
      claim: `Table ${input.schemaName}.${input.tableName} exists`,
      source_kind: 'ddl',
      refs: [{ file: input.ddlSource }],
    },
    {
      id: `F-DB-${input.tableName}-002`,
      claim: `Primary key of ${input.tableName} is ${input.primaryKey.join(', ')}`,
      source_kind: 'ddl',
      refs: [{ file: input.ddlSource }],
    },
  ];

  return {
    facts,
    fields: mergeDbFieldSources(input.fields),
  };
}