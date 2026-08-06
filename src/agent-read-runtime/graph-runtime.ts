import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph, Annotation } from "@langchain/langgraph";
import {
  createBudgetState,
  recordToolCall,
  resolveKnowledgeReadLimits,
} from "./context-budget.js";
import { createLocalReadTools } from "./local-read-tools.js";
import { createTraceCollector } from "./trace.js";
import {
  KnowledgeReadAgentOutputSchema,
  type KnowledgeReadAgentOutput,
  type KnowledgeReadResult,
  type KnowledgeReadRuntimeInput,
} from "./types.js";

const SYSTEM_PROMPT = `You are a repository evidence reader for a knowledge generation pipeline.
Use only the provided local read tools to inspect repository evidence.
Do not request whole-repository reads.
Do not invent facts.
If evidence is insufficient, set insufficient_evidence to true.
Return only JSON with keys: answer, evidence_refs, insufficient_evidence.`;

export class KnowledgeReadValidationError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeReadValidationError";
  }
}

const GraphStateAnnotation = Annotation.Root({
  messages: Annotation<Array<HumanMessage | AIMessage | ToolMessage>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  finalText: Annotation<string | undefined>({
    reducer: (_, right) => right,
    default: () => undefined,
  }),
  parsedOutput: Annotation<KnowledgeReadAgentOutput | undefined>({
    reducer: (_, right) => right,
    default: () => undefined,
  }),
  validationError: Annotation<string | undefined>({
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

export function routeAfterBudgetCheck(state: {
  budgetExceeded: boolean;
  finalText?: string;
}): "model_decide" | "force_insufficient_output" | "output_validate" {
  if (state.finalText) {
    return "output_validate";
  }
  if (state.budgetExceeded) {
    return "force_insufficient_output";
  }
  return "model_decide";
}

export function routeAfterValidation(state: {
  parsedOutput?: KnowledgeReadAgentOutput;
  validationError?: string;
  repairAttempts: number;
}): typeof END | "repair_output" | "failed" {
  if (state.parsedOutput) {
    return END;
  }
  if (state.validationError && state.repairAttempts < 1) {
    return "repair_output";
  }
  return "failed";
}

export function buildForcedInsufficientOutput(): string {
  return JSON.stringify({
    answer:
      "Evidence budget was exhausted before enough evidence could be confirmed.",
    evidence_refs: [],
    insufficient_evidence: true,
  });
}

export function validateFinalOutput(state: {
  finalText?: string;
  repairAttempts: number;
}): {
  parsedOutput?: KnowledgeReadAgentOutput;
  validationError?: string;
} {
  try {
    const parsed = parseKnowledgeReadAgentOutput(state.finalText ?? "");
    return {
      parsedOutput: {
        answer: parsed.answer,
        evidence_refs: parsed.evidenceRefs.map((ref) => ({
          file: ref.file,
          start_line: ref.startLine,
          end_line: ref.endLine,
          note: ref.note,
        })),
        insufficient_evidence: parsed.insufficientEvidence,
      },
      validationError: undefined,
    };
  } catch (error) {
    return {
      validationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseKnowledgeReadAgentOutput(
  text: string,
): Omit<KnowledgeReadResult, "toolCallsUsed" | "trace"> {
  // 参考 CmbCoworkAgent 的多层 JSON 提取策略
  const candidates = extractJsonCandidates(text);

  for (const candidate of candidates) {
    const repaired = repairJson(candidate);
    try {
      const parsed = normalizeKnowledgeReadJson(JSON.parse(repaired));
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
    } catch {
      // 继续尝试下一个候选
      continue;
    }
  }

  throw new Error(
    "Agent output is not valid JSON after all extraction attempts",
  );
}

function normalizeKnowledgeReadJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.evidence_refs)) return candidate;

  return {
    ...candidate,
    evidence_refs: candidate.evidence_refs.map((ref) =>
      normalizeEvidenceRefJson(ref),
    ),
  };
}

function normalizeEvidenceRefJson(value: unknown): unknown {
  if (typeof value === "string") {
    const match = value.trim().match(/^(.+?):(\d+)(?:\s*[-:]\s*(\d+))?$/);
    if (!match) {
      return {
        file: value,
        start_line: 1,
        end_line: 1,
        note: "Repository evidence",
      };
    }
    const start = Number(match[2]);
    const end = Number(match[3] ?? match[2]);
    return {
      file: match[1],
      start_line: start,
      end_line: Math.max(start, end),
      note: "Repository evidence",
    };
  }
  if (!value || typeof value !== "object") return value;
  const ref = value as Record<string, unknown>;
  const lineRange = parseLineRange(ref.lines);

  return {
    ...ref,
    file: ref.file ?? ref.path,
    start_line: ref.start_line ?? lineRange?.start,
    end_line: ref.end_line ?? lineRange?.end,
    note: ref.note ?? "Repository evidence",
  };
}

function parseLineRange(value: unknown): { start: number; end: number } | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { start: value, end: value };
  }
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(?:\s*[-:]\s*(\d+))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start <= 0 || end <= 0) return null;
  return { start, end: Math.max(start, end) };
}

/**
 * 从文本中提取所有可能的 JSON 候选（参考 CmbCoworkAgent）
 *
 * 提取策略：
 * 1. 直接尝试原始文本
 * 2. 从 markdown 代码块提取
 * 3. 使用平衡括号提取完整 JSON 对象
 */
function extractJsonCandidates(text: string): string[] {
  const results: string[] = [];
  const cleaned = stripThinkTags(text);

  // 1. 直接尝试原始文本
  if (cleaned.trim()) {
    results.push(cleaned.trim());
  }

  // 2. 从 markdown 代码块提取
  for (const match of cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    if (match[1]?.trim()) {
      results.push(match[1].trim());
    }
  }

  // 3. 使用平衡括号提取完整 JSON 对象
  results.push(...extractBalancedJsonObjects(cleaned));

  // 去重
  return Array.from(new Set(results.filter(Boolean)));
}

/**
 * 移除 <think>...</think> 标签（参考 CmbCoworkAgent）
 */
function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/^[\s\S]*?<\/think>\s*/i, "")
    .trim();
}

/**
 * 从文本中提取所有平衡的 JSON 对象（参考 CmbCoworkAgent）
 *
 * 这个函数会跟踪花括号的深度，正确处理字符串内的转义字符，
 * 提取所有完整的 JSON 对象。
 */
function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, index + 1).trim());
        start = -1;
      }
    }
  }

  return results;
}

/**
 * JSON 修复函数（参考 CmbCoworkAgent 和 parse-output.ts）
 */
function repairJson(text: string): string {
  let repaired = text;

  // 移除尾部逗号
  repaired = repaired.replace(/,\s*}/g, "}");
  repaired = repaired.replace(/,\s*]/g, "]");

  // 移除控制字符（保留换行和制表符）
  repaired = repaired.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  repaired = escapeRawWhitespaceInStrings(repaired);

  // 修复未加引号的键名（简单情况）
  // 例如：{name: "value"} → {"name": "value"}
  repaired = repaired.replace(
    /(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":',
  );

  return repaired;
}

function escapeRawWhitespaceInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (const char of text) {
    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      result += "\\r";
      continue;
    }
    if (inString && char === "\t") {
      result += "\\t";
      continue;
    }
    result += char;
  }

  return result;
}

function buildRepairPrompt(
  finalText: string | undefined,
  validationError: string | undefined,
): string {
  return [
    "Repair the previous output so it is valid JSON for this schema:",
    '{"answer":"string","evidence_refs":[{"file":"string","start_line":1,"end_line":1,"note":"string"}],"insufficient_evidence":false}',
    "",
    `Validation error: ${validationError ?? "unknown"}`,
    "",
    "Previous output:",
    finalText ?? "",
    "",
    "Return only JSON.",
  ].join("\n");
}

async function invokeGraphWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof KnowledgeReadValidationError) {
        throw error;
      }
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

interface KnowledgeReadRuntimeDeps {
  model?: {
    invoke(messages: unknown): Promise<AIMessage>;
  };
}

export async function runKnowledgeReadRuntime(
  input: KnowledgeReadRuntimeInput,
  deps: KnowledgeReadRuntimeDeps = {},
): Promise<KnowledgeReadResult> {
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

  const recordUnknownToolCall = (
    toolName: string,
    args: Record<string, unknown>,
  ): string => {
    const started = new Date();
    const callBudget = recordToolCall(budget);
    const content = callBudget.allowed
      ? `unknown tool: ${toolName}`
      : (callBudget.message ?? "tool call budget exceeded");
    const finished = new Date();

    trace.recordToolCall({
      toolName,
      args,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      returnedChars: content.length,
      acceptedBudgetChars: 0,
      truncated: false,
      error: "unknown tool",
    });

    return content;
  };

  const defaultModel = new ChatOpenAI({
    model: input.model,
    apiKey: input.apiKey,
    configuration: {
      baseURL: input.baseUrl,
    },
    temperature: 0,
  }).bindTools(tools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = deps.model ?? defaultModel;

  const userPrompt = [
    SYSTEM_PROMPT,
    input.initialContext ? `Initial context:\n${input.initialContext}` : "",
    `Instruction:\n${input.instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const graph = new StateGraph(GraphStateAnnotation)
    .addNode("model_decide", async (state) => {
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
    .addNode("tool_execute", async (state) => {
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
          content = recordUnknownToolCall(call.name, call.args ?? {});
        }
        toolMessages.push(
          new ToolMessage({
            content,
            tool_call_id: call.id ?? call.name,
          }),
        );
      }
      return {
        messages: toolMessages,
        budgetExceeded:
          budget.toolCallsUsed >= budget.limits.maxToolCalls ||
          budget.totalToolResultChars >= budget.limits.maxTotalToolResultChars,
      };
    })
    .addNode("budget_check", async (state) => state)
    .addNode("force_insufficient_output", async () => ({
      finalText: buildForcedInsufficientOutput(),
    }))
    .addNode("output_validate", async (state) => {
      // 调试：打印 LLM 返回的原始内容
      if (state.finalText) {
        console.debug(
          "[graph-runtime] LLM output (first 500 chars):",
          state.finalText.slice(0, 500),
        );
      }
      return validateFinalOutput(state);
    })
    .addNode("repair_output", async (state) => {
      const response = await model.invoke([
        new HumanMessage(
          buildRepairPrompt(state.finalText, state.validationError),
        ),
      ]);
      return {
        finalText: messageContentToText(response.content),
        validationError: undefined,
        repairAttempts: state.repairAttempts + 1,
      };
    })
    .addNode("failed", async (state) => {
      throw new KnowledgeReadValidationError(
        state.validationError ?? "Knowledge read output validation failed",
      );
    })
    .addEdge(START, "model_decide")
    .addConditionalEdges(
      "model_decide",
      (state) => {
        const last = state.messages[state.messages.length - 1];
        if (last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0) {
          return "tool_execute";
        }
        return "output_validate";
      },
      {
        tool_execute: "tool_execute",
        output_validate: "output_validate",
      },
    )
    .addEdge("tool_execute", "budget_check")
    .addConditionalEdges("budget_check", routeAfterBudgetCheck, {
      model_decide: "model_decide",
      force_insufficient_output: "force_insufficient_output",
      output_validate: "output_validate",
    })
    .addEdge("force_insufficient_output", "output_validate")
    .addConditionalEdges("output_validate", routeAfterValidation, {
      [END]: END,
      repair_output: "repair_output",
      failed: "failed",
    })
    .addEdge("repair_output", "output_validate")
    .addEdge("failed", END)
    .compile();

  const response = await invokeGraphWithRetry(() =>
    graph.invoke({
      messages: [new HumanMessage(userPrompt)],
      budgetExceeded: false,
      repairAttempts: 0,
    }),
  );

  if (!response.parsedOutput) {
    throw new Error(
      response.validationError ?? "Knowledge read output validation failed",
    );
  }

  const parsed = {
    answer: response.parsedOutput.answer,
    evidenceRefs: response.parsedOutput.evidence_refs.map((ref) => ({
      file: ref.file,
      startLine: ref.start_line,
      endLine: ref.end_line,
      note: ref.note,
    })),
    insufficientEvidence: response.parsedOutput.insufficient_evidence,
  };
  const finalizedTrace = trace.finalize();

  return {
    ...parsed,
    toolCallsUsed: budget.toolCallsUsed,
    trace: finalizedTrace,
  };
}
