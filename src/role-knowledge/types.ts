import { z } from "zod";

export const RoleSchema = z.enum(["pm", "tech-lead", "qa", "review"]);
export type Role = z.infer<typeof RoleSchema>;

export const RoleKnowledgeStatusSchema = z.enum([
  "draft",
  "validated",
  "rejected",
  "stale",
]);
export type RoleKnowledgeStatus = z.infer<typeof RoleKnowledgeStatusSchema>;

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const SourceRefSchema = z.object({
  kind: z.string().min(1),
  path: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  summary: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const KnowledgeObjectRefSchema = z.object({
  objectId: z.string().min(1),
  objectType: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1).optional(),
});
export type KnowledgeObjectRef = z.infer<typeof KnowledgeObjectRefSchema>;

export const RoleKnowledgeRefSchema = z.object({
  role: RoleSchema.optional(),
  domain: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  relation: z.string().min(1).optional(),
  indexPath: z.string().min(1).optional(),
  generatedAt: z.string().min(1).optional(),
  status: z.enum(["generated", "partial", "needs_review", "blocked"]).optional(),
  confidence: ConfidenceSchema.optional(),
  summary: z.string().min(1).optional(),
});
export type RoleKnowledgeRef = z.infer<typeof RoleKnowledgeRefSchema>;

export const ClaimRelationSchema = z.object({
  relation: z.enum([
    "supports",
    "depends_on",
    "conflicts_with",
    "duplicates",
    "refines",
  ]),
  targetClaimId: z.string().min(1),
  rationale: z.string().min(1).optional(),
});
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>;

export const RoleValidationSchema = z.object({
  status: z.enum(["unvalidated", "validated", "rejected"]),
  validatedBy: z.string().min(1).optional(),
  validatedAt: z.string().min(1).optional(),
  notes: z.array(z.string()).default([]),
});
export type RoleValidation = z.infer<typeof RoleValidationSchema>;

export const DomainProfileSchema = z.object({
  domainKey: z.string().min(1),
  domainName: z.string().min(1),
  summary: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
});
export type DomainProfile = z.infer<typeof DomainProfileSchema>;

export const RoleClaimSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  status: RoleKnowledgeStatusSchema,
  confidence: ConfidenceSchema,
  claim: z.string().min(1),
  domain: DomainProfileSchema,
  sourceRefs: z.array(SourceRefSchema),
  knowledgeRefs: z.array(KnowledgeObjectRefSchema).default([]),
  roleRefs: z.array(RoleKnowledgeRefSchema).default([]),
  relations: z.array(ClaimRelationSchema).default([]),
  validation: RoleValidationSchema,
  tags: z.array(z.string()).default([]),
  generatedAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
});
export type RoleClaim = z.infer<typeof RoleClaimSchema>;

export const RoleIndexSchema = z.object({
  schemaVersion: z.literal("role-knowledge/v1"),
  role: RoleSchema,
  status: RoleKnowledgeStatusSchema,
  domain: DomainProfileSchema,
  claims: z.array(RoleClaimSchema),
  generatedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type RoleIndex = z.infer<typeof RoleIndexSchema>;
