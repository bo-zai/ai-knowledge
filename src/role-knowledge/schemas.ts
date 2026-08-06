import { z } from "zod";
import {
  ClaimRelationSchema,
  ConfidenceSchema,
  DomainProfileSchema,
  KnowledgeObjectRefSchema,
  RoleClaimSchema,
  RoleIndexSchema,
  RoleReadProtocolSchema,
  RoleKnowledgeRefSchema,
  RoleKnowledgeStatusSchema,
  RoleSchema,
  RoleValidationSchema,
  SourceRefSchema,
} from "./types.js";

export const roleClaimSchema = RoleClaimSchema;
export const roleIndexSchema = RoleIndexSchema;
export const roleReadProtocolSchema = RoleReadProtocolSchema;

export {
  ClaimRelationSchema,
  ConfidenceSchema,
  DomainProfileSchema,
  KnowledgeObjectRefSchema,
  RoleKnowledgeRefSchema,
  RoleKnowledgeStatusSchema,
  RoleReadProtocolSchema,
  RoleSchema,
  RoleValidationSchema,
  SourceRefSchema,
};

export type RoleClaimInput = z.infer<typeof roleClaimSchema>;
export type RoleIndexInput = z.infer<typeof roleIndexSchema>;
export type RoleReadProtocolInput = z.infer<typeof roleReadProtocolSchema>;
