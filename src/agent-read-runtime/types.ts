import { z } from 'zod';

export interface EvidenceRef {
  file: string;
  startLine: number;
  endLine: number;
  note: string;
}

export interface KnowledgeReadLimits {
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalToolResultChars: number;
  maxFileWindowLines: number;
  searchResultLimit: number;
  maxSearchFileBytes: number;
}

export interface KnowledgeReadRuntimeInput {
  repoPath: string;
  instruction: string;
  initialContext?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  limits?: Partial<KnowledgeReadLimits>;
}

export interface ToolTraceEvent {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  returnedChars: number;
  acceptedBudgetChars: number;
  truncated: boolean;
  error?: string;
}

export interface KnowledgeReadTrace {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  toolCalls: ToolTraceEvent[];
  totalToolResultChars: number;
}

export interface KnowledgeReadResult {
  answer: string;
  evidenceRefs: EvidenceRef[];
  insufficientEvidence: boolean;
  toolCallsUsed: number;
  trace: KnowledgeReadTrace;
}

export const KnowledgeReadAgentOutputSchema = z.object({
  answer: z.string(),
  evidence_refs: z.array(z.object({
    file: z.string(),
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
    note: z.string(),
  })),
  insufficient_evidence: z.boolean(),
});

export type KnowledgeReadAgentOutput = z.infer<typeof KnowledgeReadAgentOutputSchema>;
