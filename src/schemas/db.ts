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

export const dbObjectSchema = commonObjectSchema.extend({
  type: z.literal('DB'),
  table_name: z.string().min(1),
  table_name_zh: z.string().min(1),
  schema_name: z.string().min(1),
  source_kind: z.enum(['ddl', 'migration', 'orm', 'mapper', 'inferred']),
  primary_key: z.array(z.string()),
  indexes: z.array(z.string()),
  foreign_keys: z.array(z.string()),
  read_by: z.array(z.string()),
  write_by: z.array(z.string()),
  fields: z.array(dbFieldSchema).min(1),
});

export type DbField = z.infer<typeof dbFieldSchema>;
export type DbObject = z.infer<typeof dbObjectSchema>;