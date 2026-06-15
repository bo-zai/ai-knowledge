/**
 * Hybrid extraction configuration
 *
 * Controls when LLM supplement is triggered and cost limits.
 */

import type { KnowledgeType } from '../../../schemas/knowledge-type.js';

export const HYBRID_CONFIG = {
  /** Enable LLM supplement globally */
  enableLlmSupplement: true,

  /** Maximum LLM calls per knowledge type */
  maxLlmCallsPerType: 10,

  /** Timeout for single LLM call (ms) */
  llmCallTimeout: 30_000,

  /** Retry attempts for failed LLM calls */
  llmRetryAttempts: 2,

  /** Minimum evidence count to skip LLM */
  minEvidenceToSkipLlm: 5,

  /** Token budget per supplement call */
  tokenBudget: {
    maxInput: 4000,
    maxOutput: 2000,
  },

  /** Cost tracking */
  costTracking: {
    enabled: true,
    warnThreshold: 10, // Warn after 10 calls
    stopThreshold: 50, // Stop after 50 calls
  },
};

/**
 * Knowledge type specific supplement strategies
 */
export const TYPE_SUPPLEMENT_STRATEGY: Partial<Record<KnowledgeType, {
  focusAreas: readonly string[];
  promptTemplate: string;
}>> = {
  /** DATA_MODEL: Use LLM for entity relationships and constraints */
  DATA_MODEL: {
    focusAreas: ['relations', 'constraints', 'validationRules'],
    promptTemplate: 'data-model-supplement',
  },

  /** CAPABILITY: Use LLM for operation descriptions and domain hints */
  CAPABILITY: {
    focusAreas: ['operationDescriptions', 'domainContext', 'businessValue'],
    promptTemplate: 'capability-supplement',
  },

  /** RELATION: Use LLM for service interaction patterns */
  RELATION: {
    focusAreas: ['interactionPattern', 'dataFlow', 'dependencyReason'],
    promptTemplate: 'relation-supplement',
  },

  /** WORKFLOW: Use LLM for step descriptions and conditions */
  WORKFLOW: {
    focusAreas: ['stepDescriptions', 'conditions', 'triggers'],
    promptTemplate: 'workflow-supplement',
  },

  /** BOUNDARY: Use LLM for boundary rationale */
  BOUNDARY: {
    focusAreas: ['boundaryRationale', 'crossingPoints', 'enforcementRules'],
    promptTemplate: 'boundary-supplement',
  },

  /** CONSTRAINT: Use LLM for constraint context */
  CONSTRAINT: {
    focusAreas: ['constraintContext', 'enforcementMechanism', 'violationHandling'],
    promptTemplate: 'constraint-supplement',
  },

  /** EXTERNAL: Use LLM for integration patterns */
  EXTERNAL: {
    focusAreas: ['integrationPattern', 'errorHandling', 'fallbackStrategy'],
    promptTemplate: 'external-supplement',
  },
} as const;