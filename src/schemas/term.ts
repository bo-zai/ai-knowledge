import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const termObjectSchema = commonObjectSchema.extend({
  type: z.literal('TERM'),
  term: z.string().min(1),
  term_zh: z.string().min(1),
  definition_zh: z.string().min(1),
  aliases: z.array(z.string()),
  related_terms: z.array(z.string()),
  used_in: z.array(z.string()),
});

export type TermObject = z.infer<typeof termObjectSchema>;