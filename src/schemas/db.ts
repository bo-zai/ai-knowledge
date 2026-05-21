import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const dbFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  default: z.string().nullable(),
  description_zh: z.string().min(1),
  description_source: z.enum(['comment', 'inferred']),
  constraints: z.array(z.string()),
});

export const gapInfoSchema = z.object({
  type: z.enum(['suspected_primary_key', 'suspected_not_null', 'suspected_unique', 'suspected_foreign_key', 'missing_mapper', 'unmapped_field', 'ambiguous_binding']),
  description: z.string().min(1),
  field_name: z.string().optional(),
  evidence: z.string().optional(),
});

export const dbCallerSchema = z.object({
  caller_class: z.string().min(1),
  caller_method: z.string().min(1),
  business_context: z.string().optional(),
});

export const dbObjectSchema = commonObjectSchema.extend({
  type: z.literal('DB'),
  table_name: z.string().min(1),
  table_name_zh: z.string().min(1),
  schema_name: z.string().min(1),
  source_kind: z.enum(['ddl', 'migration', 'orm', 'mapper', 'inferred']),
  primary_key: z.array(z.string()),
  indexes: z.array(z.string()),
  foreign_keys: z.array(z.string()),
  read_by_direct: z.array(z.string()),
  read_by_joined: z.array(z.string()),
  write_by_direct: z.array(z.string()),
  write_by_joined: z.array(z.string()),
  callers: z.array(dbCallerSchema).optional().default([]),
  fields: z.array(dbFieldSchema).min(1),
  gaps: z.array(gapInfoSchema).optional().default([]),
});

export type DbField = z.infer<typeof dbFieldSchema>;
export type DbObject = z.infer<typeof dbObjectSchema>;
export type DbCaller = z.infer<typeof dbCallerSchema>;
export type GapInfo = z.infer<typeof gapInfoSchema>;