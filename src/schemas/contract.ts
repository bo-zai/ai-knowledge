import { z } from 'zod';
import { commonObjectSchema } from './common.js';

// Interface kind - 定义契约的类型
export const interfaceKindSchema = z.enum(['route', 'tool', 'api', 'method', 'event']);

// Input/Output shape - 定义输入输出的结构
export const fieldShapeSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean(),
  description_zh: z.string().min(1),
  description_source: z.enum(['comment', 'inferred']),
});

// Error shape - 定义错误响应结构
export const errorShapeSchema = z.object({
  code: z.string().min(1),
  message_zh: z.string().min(1),
  http_status: z.number().int().optional(),
});

// Contract object schema - 真正的契约对象
export const conObjectSchema = commonObjectSchema.extend({
  type: z.literal('CON'),

  // Interface summary
  interface_kind: interfaceKindSchema,
  interface_name: z.string().min(1),
  interface_name_zh: z.string().min(1),

  // Producer and Consumer
  producer: z.string().min(1),
  producer_zh: z.string().min(1),
  consumers: z.array(z.string()),
  consumer_zh: z.array(z.string()).optional(),

  // Inputs
  input_shape: z.array(fieldShapeSchema),
  input_description_zh: z.string().min(1),

  // Outputs
  output_shape: z.array(fieldShapeSchema),
  output_description_zh: z.string().min(1),

  // Runtime semantics
  middleware: z.array(z.string()).optional(),
  timeout_ms: z.number().int().optional(),
  retry_policy: z.string().optional(),

  // Error handling
  error_shape: z.array(errorShapeSchema).optional(),
  error_description_zh: z.string().optional(),

  // Code anchors
  related_routes: z.array(z.string()),
  related_tools: z.array(z.string()),
  entry_file: z.string().min(1),
  entry_symbol: z.string().optional(),
});

export type InterfaceKind = z.infer<typeof interfaceKindSchema>;
export type FieldShape = z.infer<typeof fieldShapeSchema>;
export type ErrorShape = z.infer<typeof errorShapeSchema>;
export type ConObject = z.infer<typeof conObjectSchema>;