import { z } from 'zod';

export const EntrySignalSchema = z.object({
  kind: z.enum(['cli', 'http', 'handler', 'job', 'service']),
  location: z.string(),
  name: z.string(),
  signature: z.string().optional(),
  description: z.string().optional(),
});

export const BehaviorSignalSchema = z.object({
  location: z.string(),
  verb: z.string(),
  object: z.string(),
  context: z.string().optional(),
});

export const DataSignalSchema = z.object({
  kind: z.enum(['schema', 'type', 'interface', 'table', 'sql', 'output']),
  location: z.string(),
  name: z.string(),
  fields: z.array(z.string()).optional(),
});

export const TestSignalSchema = z.object({
  location: z.string(),
  testName: z.string(),
  describeBlock: z.string().optional(),
  assertions: z.array(z.string()).optional(),
});

export const DocSignalSchema = z.object({
  location: z.string(),
  kind: z.enum(['readme', 'agents', 'notes', 'docs']),
  terms: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
});

export const ModuleClusterSchema = z.object({
  rootPath: z.string(),
  moduleNames: z.array(z.string()),
  cohesionScore: z.number().min(0).max(1),
});

export const CandidateRiskSchema = z.string();

export const CapabilityCandidateSchema = z.object({
  candidateId: z.string().min(1),
  nameCandidates: z.array(z.string().min(1)).min(1),
  summaryHint: z.string().optional(),
  confidence: z.number().min(0).max(1),
  confidenceBreakdown: z.object({
    entrySignal: z.number().min(0).max(1),
    behaviorSignal: z.number().min(0).max(1),
    dataSignal: z.number().min(0).max(1),
    testSignal: z.number().min(0).max(1),
    docSignal: z.number().min(0).max(1),
    graphCohesion: z.number().min(0).max(1),
  }),
  primaryEntryPoints: z.array(EntrySignalSchema),
  behaviorAnchors: z.array(BehaviorSignalSchema),
  dataAnchors: z.array(DataSignalSchema),
  testAnchors: z.array(TestSignalSchema),
  docAnchors: z.array(DocSignalSchema),
  moduleClusters: z.array(ModuleClusterSchema),
  relatedTerms: z.array(z.string()),
  risks: z.array(CandidateRiskSchema),
  missingSignals: z.array(z.string()),
});

export type EntrySignal = z.infer<typeof EntrySignalSchema>;
export type BehaviorSignal = z.infer<typeof BehaviorSignalSchema>;
export type DataSignal = z.infer<typeof DataSignalSchema>;
export type TestSignal = z.infer<typeof TestSignalSchema>;
export type DocSignal = z.infer<typeof DocSignalSchema>;
export type ModuleCluster = z.infer<typeof ModuleClusterSchema>;
export type CandidateRisk = z.infer<typeof CandidateRiskSchema>;
export type CapabilityCandidate = z.infer<typeof CapabilityCandidateSchema>;
