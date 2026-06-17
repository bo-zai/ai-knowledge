import { z } from "zod";

export const manifestSchema = z.object({
  schema_version: z.literal(1),
  knowledge_pack_type: z.literal("bootstrap"),
  repo_id: z.string().min(1),
  repo_root: z.string().min(1),
  generated_at: z.string().min(1),
  analysis_version: z.string().min(1),
  object_types: z.array(
    z.enum(["TERM", "CON", "FLOW", "MOD", "OPEN", "OWN", "VER", "DB"]),
  ),
});

export type Manifest = z.infer<typeof manifestSchema>;
