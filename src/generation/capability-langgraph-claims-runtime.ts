import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { END, START, StateGraph, Annotation } from '@langchain/langgraph';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import { buildCapabilityClaimPrompt, filterCandidateClaims, type CandidateClaim } from './capability-claim-generator.js';
import { parseCapabilityClaimJsonWithMetadata } from './capability-llm-claims-provider.js';

type ModelLike = {
  invoke(messages: unknown): Promise<AIMessage>;
};

export interface RunCapabilityClaimsLangGraphInput {
  bundle: EvidenceBundle;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  model?: ModelLike;
  repairPrompt?: string;
}

export interface CapabilityClaimsLangGraphResult {
  claims: CandidateClaim[];
  rawText: string;
  repairedText?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  graphTrace: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
    normalizationNotes: string[];
  };
}

const State = Annotation.Root({
  rawText: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  repairedText: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  claims: Annotation<CandidateClaim[] | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  validationError: Annotation<string | undefined>({ reducer: (_, value) => value, default: () => undefined }),
  validationErrors: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  normalizationNotes: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  attempts: Annotation<number>({ reducer: (_, value) => value, default: () => 0 }),
  repaired: Annotation<boolean>({ reducer: (_, value) => value, default: () => false }),
});

function messageToText(message: AIMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) return String((item as { text: unknown }).text);
      return '';
    }).join('');
  }
  return '';
}

function validateAcceptedClaims(text: string, bundle: EvidenceBundle): { claims: CandidateClaim[]; normalizationNotes: string[] } {
  const parsed = parseCapabilityClaimJsonWithMetadata(text);
  const filtered = filterCandidateClaims(parsed.claims, bundle);
  if (!filtered.some((claim) => claim.suggestedType !== 'OPEN')) {
    throw new Error('LangGraph LLM output has no accepted non-OPEN claim after evidence filtering');
  }
  return { claims: filtered, normalizationNotes: parsed.normalizationNotes };
}

function buildSystemPrompt(): string {
  return [
    'You generate evidence-grounded capability knowledge claims for AI agents.',
    'Return only strict JSON array.',
    'Use only listed evidence refs.',
    'The program decides object IDs, paths, catalog, and package structure.',
  ].join('\n');
}

function buildRepairPrompt(rawText: string | undefined, error: string | undefined, userPrompt: string): string {
  return [
    'Repair the previous output into a strict JSON array matching the requested schema.',
    'Do not add markdown fences.',
    'Use only allowed sddStageUses enum values from the original instruction.',
    'Use only evidence refs listed in the original instruction.',
    '',
    `Validation error: ${error ?? 'unknown'}`,
    '',
    'Original instruction:',
    userPrompt,
    '',
    'Previous output:',
    rawText ?? '',
  ].join('\n');
}

export async function runCapabilityClaimsLangGraph(input: RunCapabilityClaimsLangGraphInput): Promise<CapabilityClaimsLangGraphResult> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = input.repairPrompt ?? buildCapabilityClaimPrompt(input.bundle);
  const model = input.model ?? new ChatOpenAI({
    model: input.modelName,
    apiKey: input.apiKey,
    configuration: input.baseUrl ? { baseURL: input.baseUrl } : undefined,
    temperature: 0,
  });

  const graph = new StateGraph(State)
    .addNode('model_generate', async () => {
      const response = await model.invoke([
        new HumanMessage(`${systemPrompt}\n\n${userPrompt}`),
      ]);
      return {
        rawText: messageToText(response),
        attempts: 1,
      };
    })
    .addNode('parse_validate', async (state) => {
      const text = state.repairedText ?? state.rawText ?? '';
      try {
        const validation = validateAcceptedClaims(text, input.bundle);
        return {
          claims: validation.claims,
          normalizationNotes: validation.normalizationNotes,
          validationError: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          validationError: message,
          validationErrors: [message],
        };
      }
    })
    .addNode('repair_json', async (state) => {
      const response = await model.invoke([
        new HumanMessage(buildRepairPrompt(state.rawText, state.validationError, userPrompt)),
      ]);
      return {
        repairedText: messageToText(response),
        attempts: 2,
        repaired: true,
      };
    })
    .addNode('failed', async (state) => {
      throw new Error(state.validationError ?? 'Capability LangGraph claim generation failed');
    })
    .addEdge(START, 'model_generate')
    .addEdge('model_generate', 'parse_validate')
    .addConditionalEdges('parse_validate', (state) => {
      if (state.claims) return END;
      if (state.attempts < 2) return 'repair_json';
      return 'failed';
    }, {
      [END]: END,
      repair_json: 'repair_json',
      failed: 'failed',
    })
    .addEdge('repair_json', 'parse_validate')
    .addEdge('failed', END)
    .compile();

  const result = await graph.invoke({});

  if (!result.claims) {
    throw new Error(result.validationError ?? 'Capability LangGraph claim generation failed');
  }

  return {
    claims: result.claims,
    rawText: result.rawText ?? '',
    repairedText: result.repairedText,
    model: input.modelName,
    systemPrompt,
    userPrompt,
    graphTrace: {
      attempts: result.attempts,
      repaired: result.repaired,
      validationErrors: result.validationErrors,
      normalizationNotes: result.normalizationNotes,
    },
  };
}
