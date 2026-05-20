import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const openObjectSchema = commonObjectSchema.extend({
  type: z.literal('OPEN'),
  question: z.string().min(1),
  question_zh: z.string().min(1),
  context_zh: z.string().min(1),
  impact: z.enum(['high', 'medium', 'low']),
  decision_needed_by: z.string().optional(),
  options: z.array(
    z.object({
      label: z.string().min(1),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
    }),
  ).optional(),
});

export type OpenObject = z.infer<typeof openObjectSchema>;