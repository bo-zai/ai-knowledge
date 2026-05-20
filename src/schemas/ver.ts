import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const verObjectSchema = commonObjectSchema.extend({
  type: z.literal('VER'),
  version_name: z.string().min(1),
  version_name_zh: z.string().min(1),
  version_value: z.string().min(1),
  version_kind: z.enum(['api', 'sdk', 'library', 'framework', 'platform', 'tool']),
  changelog_zh: z.string().min(1),
  breaking_changes: z.array(z.string()),
  migration_notes: z.array(z.string()).optional(),
});

export type VerObject = z.infer<typeof verObjectSchema>;