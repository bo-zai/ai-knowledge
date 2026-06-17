import { z } from "zod";

export const catalogObjectSchema = z.object({
  type: z.enum(["TERM", "CON", "FLOW", "MOD", "OPEN", "OWN", "VER", "DB"]),
  path: z.string().min(1),
  slice_ids: z.array(z.string()),
});

export const catalogSchema = z.object({
  retrieval_order: z.array(z.string()),
  objects: z.record(z.string(), catalogObjectSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogObject = z.infer<typeof catalogObjectSchema>;
