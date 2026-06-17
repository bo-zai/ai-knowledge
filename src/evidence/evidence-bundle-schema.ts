import { z } from 'zod';

export const EvidenceEntryPointSchema = z.object({
  ref: z.string().startsWith('evidence://entry/'),
  kind: z.enum(['cli', 'http', 'handler', 'job', 'service']),
  location: z.string(),
  name: z.string(),
  signature: z.string().optional(),
  description: z.string().optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
  startLine: z.number().optional(),
});

export const EvidenceBehaviorSliceSchema = z.object({
  ref: z.string().startsWith('evidence://behavior/'),
  location: z.string(),
  verb: z.string(),
  object: z.string(),
  summary: z.string().optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
  startLine: z.number().optional(),
});

export const EvidenceDataContractSchema = z.object({
  ref: z.string().startsWith('evidence://contract/'),
  kind: z.enum(['schema', 'type', 'interface', 'table', 'sql', 'api', 'event', 'output', 'field']),
  location: z.string(),
  name: z.string(),
  fields: z.array(z.string()).optional(),
  description: z.string().optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
  startLine: z.number().optional(),
  customData: z.record(z.unknown()).optional(), // 自定义数据（如软标记信息）
});

export const EvidenceFlowTraceSchema = z.object({
  ref: z.string().startsWith('evidence://flow/'),
  steps: z.array(z.object({
    action: z.string(),
    location: z.string().optional(),
    outcome: z.string().optional(),
  })),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
});

export const EvidenceModuleSurfaceSchema = z.object({
  ref: z.string().startsWith('evidence://module/'),
  rootPath: z.string(),
  exports: z.array(z.string()),
  responsibilities: z.array(z.string()),
  dependencies: z.array(z.string()).optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
  startLine: z.number().optional(),
});

export const EvidenceValidationAnchorSchema = z.object({
  ref: z.string().startsWith('evidence://validation/'),
  kind: z.enum(['test', 'fixture', 'golden', 'manual', 'ci']),
  location: z.string(),
  name: z.string(),
  assertion: z.string().optional(),
  oracle: z.string().optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
  startLine: z.number().optional(),
});

export const EvidenceDocSnippetSchema = z.object({
  ref: z.string().startsWith('evidence://doc/'),
  location: z.string(),
  kind: z.enum(['readme', 'agents', 'notes', 'docs', 'comment']),
  excerpt: z.string(),
  terms: z.array(z.string()).optional(),
  targetRelevance: z.number().min(0).max(1).optional(),
  matchedTerms: z.array(z.string()).optional(),
  sourceLocation: z.string().optional(),
});

export const NegativeEvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['missing_boundary', 'missing_data', 'ambiguous_behavior', 'incomplete_trace', 'orphaned_code']),
  description: z.string(),
  impact: z.string(),
  location: z.string().optional(),
});

export const OpenQuestionSeedSchema = z.object({
  id: z.string(),
  question: z.string(),
  blockedDecisions: z.array(z.string()),
  minimalNextEvidence: z.string(),
  suggestedInvestigation: z.string().optional(),
});

export const RepoProfileLiteSchema = z.object({
  name: z.string(),
  language: z.string().optional(),
  framework: z.string().optional(),
  description: z.string().optional(),
});

export const CapabilityHintsSchema = z.object({
  nameCandidates: z.array(z.string()),
  relatedTerms: z.array(z.string()),
  summaryHint: z.string().optional(),
});

export const FunctionCandidateSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  normalizedVerb: z.string(),
  normalizedObject: z.string(),
  domainTerms: z.array(z.string()),
  summary: z.string(),
  sourceKinds: z.array(z.enum(['entry', 'behavior', 'test', 'doc'])),
  isCore: z.boolean(),
  relevance: z.number().min(0).max(1),
  signals: z.array(z.object({
    kind: z.enum(['entry', 'behavior', 'test', 'doc']),
    name: z.string(),
    location: z.string(),
    summary: z.string().optional(),
    role: z.string().optional(),
    matchedTerms: z.array(z.string()),
    relevance: z.number().min(0).max(1),
  })),
});

export const EvidenceBundleSchema = z.object({
  bundleId: z.string().min(1),
  candidateId: z.string().min(1),
  repoProfile: RepoProfileLiteSchema,
  confidence: z.number().min(0).max(1),
  risks: z.array(z.string()),
  capabilityHints: CapabilityHintsSchema,
  entryPoints: z.array(EvidenceEntryPointSchema),
  flowTraces: z.array(EvidenceFlowTraceSchema),
  behaviorSlices: z.array(EvidenceBehaviorSliceSchema),
  dataContracts: z.array(EvidenceDataContractSchema),
  moduleSurfaces: z.array(EvidenceModuleSurfaceSchema),
  validationAnchors: z.array(EvidenceValidationAnchorSchema),
  docs: z.array(EvidenceDocSnippetSchema),
  negativeEvidence: z.array(NegativeEvidenceSchema),
  openQuestions: z.array(OpenQuestionSeedSchema),
  functionCandidates: z.array(FunctionCandidateSchema).optional(),
});

export type EvidenceEntryPoint = z.infer<typeof EvidenceEntryPointSchema>;
export type EvidenceBehaviorSlice = z.infer<typeof EvidenceBehaviorSliceSchema>;
export type EvidenceDataContract = z.infer<typeof EvidenceDataContractSchema>;
export type EvidenceFlowTrace = z.infer<typeof EvidenceFlowTraceSchema>;
export type EvidenceModuleSurface = z.infer<typeof EvidenceModuleSurfaceSchema>;
export type EvidenceValidationAnchor = z.infer<typeof EvidenceValidationAnchorSchema>;
export type EvidenceDocSnippet = z.infer<typeof EvidenceDocSnippetSchema>;
export type NegativeEvidence = z.infer<typeof NegativeEvidenceSchema>;
export type OpenQuestionSeed = z.infer<typeof OpenQuestionSeedSchema>;
export type RepoProfileLite = z.infer<typeof RepoProfileLiteSchema>;
export type CapabilityHints = z.infer<typeof CapabilityHintsSchema>;
export type FunctionCandidate = z.infer<typeof FunctionCandidateSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
