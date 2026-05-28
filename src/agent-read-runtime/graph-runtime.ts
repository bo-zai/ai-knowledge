import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { END, START, StateGraph, Annotation } from '@langchain/langgraph';
import { withRetry } from '../generation/retry.js';
import { createBudgetState, resolveKnowledgeReadLimits } from './context-budget.js';
import { createLocalReadTools } from './local-read-tools.js';
import { createTraceCollector } from './trace.js';
import {
  KnowledgeReadAgentOutputSchema,
  type KnowledgeReadResult,
  type KnowledgeReadRuntimeInput,
} from './types.js';

const SYSTEM_PROMPT = `You are a repository evidence reader for a knowledge generation pipeline.
Use only the provided local read tools to inspect repository evidence.
Do not request whole-repository reads.
Do not invent facts.
If evidence is insufficient, set insufficient_evidence to true.
Return only JSON with keys: answer, evidence_refs, insufficient_evidence.`;

const GraphStateAnnotation = Annotation.Root({
  messages: Annotation<Array<HumanMessage | AIMessage | ToolMessage>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  finalText: Annotation<string | undefined>({
    reducer: (_, right) => right,
    default: () => undefined,
  }),
  budgetExceeded: Annotation<boolean>({
    reducer: (_, right) => right,
    default: () => false,
  }),
  repairAttempts: Annotation<number>({
    reducer: (_, right) => right,
    default: () => 0,
  }),
});

export function routeAfterBudgetCheck(state: { budgetExceeded: boolean; finalText?: string }): 'model_decide' | 'output_validate' {
  if (state.finalText || state.budgetExceeded) {
    return 'output_validate';
  }
  return 'model_decide';
}

export function parseKnowledgeReadAgentOutput(text: string): Omit<KnowledgeReadResult, 'toolCallsUsed' | 'trace'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Agent output is not valid JSON');
  }

  const output = KnowledgeReadAgentOutputSchema.parse(parsed);
  return {
    answer: output.answer,
    evidenceRefs: output.evidence_refs.map((ref) => ({
      file: ref.file,
      startLine: ref.start_line,
      endLine: ref.end_line,
      note: ref.note,
    })),
    insufficientEvidence: output.insufficient_evidence,
  };
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

export async function runKnowledgeReadRuntime(input: KnowledgeReadRuntimeInput): Promise<KnowledgeReadResult> {
  const limits = resolveKnowledgeReadLimits(input.limits);
  const budget = createBudgetState(limits);
  const trace = createTraceCollector();
  const tools = createLocalReadTools({
    repoPath: input.repoPath,
    budget,
    trace,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolMap = new Map<string, any>(tools.map((item) => [item.name, item]));

  const model = new ChatOpenAI({
    model: input.model,
    apiKey: input.apiKey,
    configuration: {
      baseURL: input.baseUrl,
    },
    temperature: 0,
  }).bindTools(tools);

  const userPrompt = [
    SYSTEM_PROMPT,
    input.initialContext ? `Initial context:\n${input.initialContext}` : '',
    `Instruction:\n${input.instruction}`,
  ].filter(Boolean).join('\n\n');

  const graph = new StateGraph(GraphStateAnnotation)
    .addNode('model_decide', async (state) => {
      const response = await model.invoke(state.messages);
      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return {
          messages: [response],
          finalText: messageContentToText(response.content),
        };
      }
      return { messages: [response] };
    })
    .addNode('tool_execute', async (state) => {
      const last = state.messages[state.messages.length - 1];
      if (!(last instanceof AIMessage)) {
        return {};
      }
      const toolMessages: ToolMessage[] = [];
      for (const call of last.tool_calls ?? []) {
        const selected = toolMap.get(call.name);
        let content: string;
        if (selected) {
          const result = await selected.invoke(call.args ?? {});
          content = String(result);
        } else {
          content = `unknown tool: ${call.name}`;
        }
        toolMessages.push(new ToolMessage({
          content,
          tool_call_id: call.id ?? call.name,
        }));
      }
      return {
        messages: toolMessages,
        budgetExceeded: budget.toolCallsUsed >= budget.limits.maxToolCalls
          || budget.totalToolResultChars >= budget.limits.maxTotalToolResultChars,
      };
    })
    .addNode('budget_check', async (state) => state)
    .addNode('output_validate', async (state) => state)
    .addEdge(START, 'model_decide')
    .addConditionalEdges('model_decide', (state) => {
      const last = state.messages[state.messages.length - 1];
      if (last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0) {
        return 'tool_execute';
      }
      return 'output_validate';
    }, {
      tool_execute: 'tool_execute',
      output_validate: 'output_validate',
    })
    .addEdge('tool_execute', 'budget_check')
    .addConditionalEdges('budget_check', routeAfterBudgetCheck, {
      model_decide: 'model_decide',
      output_validate: 'output_validate',
    })
    .addEdge('output_validate', END)
    .compile();

  const response = await withRetry(
    () => graph.invoke({
      messages: [new HumanMessage(userPrompt)],
      budgetExceeded: false,
      repairAttempts: 0,
    }),
    { maxRetries: 3, delayMs: 1000 },
  );

  const lastMessage = response.messages[response.messages.length - 1];
  const finalText = response.finalText ?? messageContentToText(lastMessage?.content);
  const parsed = parseKnowledgeReadAgentOutput(finalText);
  const finalizedTrace = trace.finalize();

  return {
    ...parsed,
    toolCallsUsed: budget.toolCallsUsed,
    trace: finalizedTrace,
  };
}