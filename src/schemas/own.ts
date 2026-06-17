import { z } from "zod";
import { commonObjectSchema } from "./common.js";

export const ownObjectSchema = commonObjectSchema.extend({
  type: z.literal("OWN"),
  owner_type: z.enum([
    "team",
    "individual",
    "shared",
    "external",
    "deprecated",
  ]),
  owner_name: z.string().min(1),
  owner_name_zh: z.string().min(1),
  responsibility_zh: z.string().min(1),
  scope_items: z.array(z.string()),
  contact: z.string().optional(),
  backup_owner: z.string().optional(),
});

export type OwnObject = z.infer<typeof ownObjectSchema>;
