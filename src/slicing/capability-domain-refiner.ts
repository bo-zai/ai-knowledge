import { z } from "zod";
import type { CapabilityDomainCandidate } from "./capability-domain-clusterer.js";

const RefinedDomainSchema = z.object({
  id: z.string(),
  domain_name: z.string(),
  summary: z.string().optional(),
  included_function_ids: z.array(z.string()).default([]),
  core_function_ids: z.array(z.string()).default([]),
  supporting_function_ids: z.array(z.string()).default([]),
  target_terms: z.array(z.string()).default([]),
});

const RefinePayloadSchema = z.object({
  domains: z.array(RefinedDomainSchema),
});

export interface RefinedCapabilityDomain {
  id: string;
  name: string;
  summary?: string;
  includedFunctionIds: string[];
  coreFunctionIds: string[];
  supportingFunctionIds: string[];
  targetTerms: string[];
}

export function buildCapabilityDomainRefinePrompt(
  candidates: CapabilityDomainCandidate[],
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You refine repository-derived business capability domains.",
    "Use only the provided candidate domains and function clusters.",
    "Return strict JSON only.",
    "A capability domain is a business area made of related user-visible business actions.",
    "Do not create technical domains such as controller/service/config/upload unless evidence forces it.",
  ].join("\n");

  const payload = {
    candidate_domains: candidates.map((candidate) => ({
      id: candidate.id,
      name_hint: candidate.nameHint,
      summary: candidate.summary,
      target_terms: candidate.targetTerms,
      primary_objects: candidate.primaryObjects,
      related_entities: candidate.relatedEntities,
      functions: candidate.functionClusters.map((cluster) => ({
        id: cluster.clusterId,
        canonical_name: cluster.canonicalName,
        normalized_verb: cluster.normalizedVerb,
        normalized_object: cluster.normalizedObject,
        domain_terms: cluster.domainTerms,
        is_core: cluster.isCore,
        relevance: cluster.relevance,
      })),
    })),
    output_schema: {
      domains: [
        {
          id: "string",
          domain_name: "string",
          summary: "string",
          included_function_ids: ["string"],
          core_function_ids: ["string"],
          supporting_function_ids: ["string"],
          target_terms: ["string"],
        },
      ],
    },
  };

  const userPrompt = [
    "Refine the following candidate capability domains.",
    "You may merge candidates if they clearly describe one business area.",
    "Keep function membership explicit.",
    "Mark query/list/detail functions as supporting unless they are clearly core.",
    JSON.stringify(payload, null, 2),
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseCapabilityDomainRefineResponse(
  text: string,
): RefinedCapabilityDomain[] {
  const parsed = JSON.parse(stripJsonFence(text));
  const result = RefinePayloadSchema.parse(parsed);
  return result.domains.map((domain) => ({
    id: domain.id,
    name: domain.domain_name,
    summary: domain.summary,
    includedFunctionIds: domain.included_function_ids,
    coreFunctionIds: domain.core_function_ids,
    supportingFunctionIds: domain.supporting_function_ids,
    targetTerms: domain.target_terms,
  }));
}
