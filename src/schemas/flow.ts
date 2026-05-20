import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const flowObjectSchema = commonObjectSchema.extend({
  type: z.literal('FLOW'),
  flow_name: z.string().min(1),
  flow_name_zh: z.string().min(1),
  trigger: z.string().min(1),
  trigger_zh: z.string().min(1),
  steps: z.array(
    z.object({
      order: z.number().int().min(1),
      action: z.string().min(1),
      action_zh: z.string().min(1),
      actor: z.string().min(1),
      inputs: z.array(z.string()),
      outputs: z.array(z.string()),
      branches: z.array(z.string()).optional(),
    }),
  ),
  outcomes: z.array(z.string()),
  error_handling: z.array(z.string()).optional(),
});

export type FlowObject = z.infer<typeof flowObjectSchema>;