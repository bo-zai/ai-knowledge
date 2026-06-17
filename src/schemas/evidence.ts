import { z } from "zod";

export const evidenceFactSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  source_kind: z.string().min(1),
  refs: z.array(
    z.object({
      file: z.string().min(1),
      symbol: z.string().optional(),
      lines: z.string().optional(),
    }),
  ),
});

export const sliceEvidenceBundleSchema = z.object({
  slice: z.object({
    id: z.string().min(1),
    kind: z.enum(["route", "process", "tool", "community", "database"]),
    title: z.string().min(1),
    scope: z.string().min(1),
    seed: z.string().min(1),
  }),
  facts: z.array(evidenceFactSchema),
  symbols: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.string().min(1),
      file: z.string().min(1),
      lines: z.string().optional(),
      role: z.string().optional(),
    }),
  ),
  relations: z.array(
    z.object({
      type: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      reason: z.string().optional(),
    }),
  ),
  snippets: z.array(
    z.object({
      id: z.string().min(1),
      file: z.string().min(1),
      lines: z.string().optional(),
      content: z.string().min(1),
    }),
  ),
  tables: z.array(z.string()),
  tests: z.array(z.string()),
  gaps: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.string().min(1),
      question: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
});

export type EvidenceFact = z.infer<typeof evidenceFactSchema>;
export type SliceEvidenceBundle = z.infer<typeof sliceEvidenceBundleSchema>;
