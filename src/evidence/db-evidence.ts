type DbFieldSource = 'comment' | 'inferred';
type DbSchemaSourceKind = 'ddl' | 'migration' | 'orm' | 'sql' | 'inferred';

interface DbFieldInput {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  description_zh: string;
  description_source: DbFieldSource;
  constraints: string[];
}

interface DbSchemaSource {
  kind: DbSchemaSourceKind;
  file: string;
  priority: number;
}

// Source priority: DDL > migration > ORM > SQL > inferred
const SOURCE_PRIORITY: Record<DbSchemaSourceKind, number> = {
  ddl: 1,
  migration: 2,
  orm: 3,
  sql: 4,
  inferred: 5,
};

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

// 合并多个来源的 schema 信息，按优先级选择
export function mergeSchemaSources(sources: DbSchemaSource[]): DbSchemaSource | null {
  if (sources.length === 0) return null;
  return sources.reduce((best, current) => {
    if (SOURCE_PRIORITY[current.kind] < SOURCE_PRIORITY[best.kind]) {
      return current;
    }
    return best;
  }, sources[0]);
}

// 解析 DDL 注释获取字段描述
export function parseDdlComment(comment: string): { description_zh: string } | null {
  // 简化实现：假设注释就是中文描述
  const cleaned = comment.trim();
  if (cleaned.length === 0) return null;
  return { description_zh: cleaned };
}

// 从多个来源提取表结构
export function extractTableSchema(input: {
  tableName: string;
  schemaName: string;
  sources: DbSchemaSource[];
  ddlContent?: string;
  migrationContent?: string;
  ormContent?: string;
  inferredFields?: DbFieldInput[];
}): {
  primarySource: DbSchemaSourceKind;
  fields: DbFieldInput[];
  primaryKey: string[];
  indexes: string[];
  foreignKeys: Array<{ field: string; targetTable: string; targetField: string }>;
  gaps: Array<{ id: string; kind: string; question: string; reason: string }>;
} {
  // 选择最高优先级的来源
  const primarySource = mergeSchemaSources(input.sources);
  const sourceKind = primarySource?.kind ?? 'inferred';

  const gaps: Array<{ id: string; kind: string; question: string; reason: string }> = [];

  // 如果只有 inferred，添加 gap
  if (sourceKind === 'inferred') {
    gaps.push({
      id: `G-${input.tableName}-SOURCE`,
      kind: 'inferred-source',
      question: `表 ${input.schemaName}.${input.tableName} 的结构来源是推断的`,
      reason: '无法从 DDL、migration、ORM 或 SQL 中提取表结构',
    });
  }

  // 使用推断字段作为 fallback
  let fields: DbFieldInput[] = input.inferredFields ?? [];

  // 如果有 DDL 内容，解析它
  if (input.ddlContent && sourceKind === 'ddl') {
    fields = parseDdlFields(input.ddlContent, input.tableName);
  }

  // 合并字段来源
  fields = mergeDbFieldSources(fields);

  // 检查 inferred-only 字段描述
  for (const field of fields) {
    if (field.description_source === 'inferred') {
      gaps.push({
        id: `G-${input.tableName}-${field.name}`,
        kind: 'inferred-description',
        question: `字段 ${field.name} 的描述来自推断`,
        reason: 'DDL 中没有注释',
      });
    }
  }

  return {
    primarySource: sourceKind,
    fields,
    primaryKey: extractPrimaryKey(input.ddlContent ?? '', input.tableName),
    indexes: extractIndexes(input.ddlContent ?? '', input.tableName),
    foreignKeys: extractForeignKeys(input.ddlContent ?? '', input.tableName),
    gaps,
  };
}

// 解析 DDL 中的字段（简化实现）
function parseDdlFields(ddlContent: string, tableName: string): DbFieldInput[] {
  // 简化解析：从 CREATE TABLE 中提取字段
  const fields: DbFieldInput[] = [];
  const lines = ddlContent.split('\n');

  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.toUpperCase().startsWith(`CREATE TABLE ${tableName.toUpperCase()}`)) {
      inTable = true;
      continue;
    }

    if (inTable && trimmed === ')') {
      break;
    }

    if (inTable && trimmed.length > 0 && !trimmed.toUpperCase().startsWith('PRIMARY KEY') && !trimmed.toUpperCase().startsWith('INDEX') && !trimmed.toUpperCase().startsWith('FOREIGN KEY')) {
      // 解析字段定义
      const fieldMatch = parseFieldDefinition(trimmed);
      if (fieldMatch) {
        fields.push(fieldMatch);
      }
    }
  }

  return fields;
}

function parseFieldDefinition(line: string): DbFieldInput | null {
  // 简化解析格式: field_name TYPE [NOT NULL] [DEFAULT value] [COMMENT 'desc']
  const parts = line.split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  const name = parts[0].replace(/[^a-zA-Z0-9_]/g, '');
  const type = parts[1].toUpperCase();

  const nullable = !line.toUpperCase().includes('NOT NULL');

  // 提取默认值
  let defaultVal: string | null = null;
  const defaultMatch = line.match(/DEFAULT\s+(['"]?[^,)\s]+['"]?)/i);
  if (defaultMatch) {
    defaultVal = defaultMatch[1].replace(/['"]/g, '');
  }

  // 提取注释
  let description_zh = `${name} 字段`;
  let description_source: DbFieldSource = 'inferred';
  const commentMatch = line.match(/COMMENT\s+['"]([^'"]+)['"]/i);
  if (commentMatch) {
    description_zh = commentMatch[1];
    description_source = 'comment';
  }

  // 提取约束
  const constraints: string[] = [];
  if (line.toUpperCase().includes('UNIQUE')) constraints.push('UNIQUE');
  if (line.toUpperCase().includes('AUTO_INCREMENT')) constraints.push('AUTO_INCREMENT');

  return {
    name,
    type,
    nullable,
    default: defaultVal,
    description_zh,
    description_source,
    constraints,
  };
}

function extractPrimaryKey(ddlContent: string, tableName: string): string[] {
  // 简化实现：查找 PRIMARY KEY
  const pkMatch = ddlContent.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
  if (pkMatch) {
    return pkMatch[1].split(',').map((f) => f.trim().replace(/['"]/g, ''));
  }

  // 或者字段定义中的 PRIMARY KEY - 需要匹配完整的字段定义行
  const lines = ddlContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配行内 PRIMARY KEY：字段名 + 类型 + PRIMARY KEY
    const inlinePkMatch = trimmed.match(/^(\w+)\s+\w+[^,]*\bPRIMARY KEY\b/i);
    if (inlinePkMatch && !trimmed.toUpperCase().startsWith('CREATE')) {
      return [inlinePkMatch[1]];
    }
  }

  return [];
}

function extractIndexes(ddlContent: string, tableName: string): string[] {
  const indexes: string[] = [];
  const indexMatches = ddlContent.matchAll(/INDEX\s+(\w+)\s*\(([^)]+)\)/gi);
  for (const match of indexMatches) {
    indexes.push(`${match[1]}(${match[2]})`);
  }
  return indexes;
}

function extractForeignKeys(ddlContent: string, tableName: string): Array<{ field: string; targetTable: string; targetField: string }> {
  const fks: Array<{ field: string; targetTable: string; targetField: string }> = [];
  const fkMatches = ddlContent.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi);
  for (const match of fkMatches) {
    fks.push({
      field: match[1].trim(),
      targetTable: match[2],
      targetField: match[3].trim(),
    });
  }
  return fks;
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
      claim: `表 ${input.schemaName}.${input.tableName} 存在`,
      source_kind: 'ddl',
      refs: [{ file: input.ddlSource }],
    },
    {
      id: `F-DB-${input.tableName}-002`,
      claim: `主键: ${input.primaryKey.join(', ')}`,
      source_kind: 'ddl',
      refs: [{ file: input.ddlSource }],
    },
  ];

  return {
    facts,
    fields: mergeDbFieldSources(input.fields),
  };
}