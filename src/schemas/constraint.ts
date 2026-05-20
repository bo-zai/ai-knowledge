import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const conObjectSchema = commonObjectSchema.extend({
  type: z.literal('CON'),
  constraint: z.string().min(1),
  constraint_zh: z.string().min(1),
  rationale_zh: z.string().min(1),
  scope_kind: z.enum(['global', 'module', 'api', 'component', 'db', 'process']),
  enforcement: z.enum(['hard', 'soft', 'guideline']),
  violations: z.array(z.string()),
  examples: z.array(z.string()),
});

export type ConObject = z.infer<typeof conObjectSchema>;