import { z } from "zod";

export const commonObjectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["TERM", "CON", "FLOW", "MOD", "OPEN", "OWN", "VER", "DB"]),
  title: z.string().min(1),
  status: z.enum(["fact", "derived", "open-question"]),
  maturity: z.literal("bootstrap"),
  scope: z.string().min(1),
  repo: z.string().min(1),
  slice_ids: z.array(z.string()),
  evidence_primary: z.array(z.string()).min(1),
  evidence_secondary: z.array(z.string()),
  stale_if: z.array(z.string()),
  generated_by: z.string().min(1),
  generated_at: z.string().min(1),
});

export type ObjectType = z.infer<typeof commonObjectSchema>["type"];
