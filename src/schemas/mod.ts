import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const modObjectSchema = commonObjectSchema.extend({
  type: z.literal('MOD'),
  module_name: z.string().min(1),
  module_name_zh: z.string().min(1),
  responsibility_zh: z.string().min(1),
  module_kind: z.enum(['service', 'controller', 'repository', 'utility', 'config', 'middleware', 'handler']),
  exports: z.array(z.string()),
  imports: z.array(z.string()),
  depends_on: z.array(z.string()),
  used_by: z.array(z.string()),
});

export type ModObject = z.infer<typeof modObjectSchema>;